/**
 * サンプルストア storefront の Express サーバー(CCv2 の JS Storefront の SSR サーバーに当たります)。
 *
 * 役目は 4 つです。
 *   1. JS・CSS などのファイルを配る
 *   2. 画面の HTML を作る(SSR = サーバーで描画 / CSR = 空の HTML を返してブラウザで描画)
 *   3. ブラウザに「api の外向きの住所」を教える(HTML の <meta name="api-public-url">)
 *   4. 運用のための口を出す(/healthz = 生きているか、/metrics = 指標、JSON のログ、トレース)
 *
 * 環境変数(スイッチ)
 *   PORT              待ち受けるポート(既定 4000)
 *   RENDER_MODE       ssr | csr(既定 ssr)。csr にすると、どの画面もサーバーでは描画せず空の HTML を返します
 *   SSR_TIMEOUT_MS    SSR をあきらめるまでの時間(既定 3000)。超えたら空の HTML を返します(フォールバック)
 *   SSR_WINDOW_BUG    true でわざと SSR を壊します(サーバーで window を触るコードが動き 500 になる)
 *   API_INTERNAL_URL  サーバー(SSR 中)から見た api の住所(既定 http://api:3001)
 *   API_PUBLIC_URL    ブラウザから見た api の住所(既定 http://api.lab.localhost:18080)。画像の URL にも使います
 *   NG_ALLOWED_HOSTS  Host ヘッダとして受け付ける名前を足す(カンマ区切り。Angular の機能)
 *   OTEL_EXPORTER_OTLP_ENDPOINT  あるときだけトレースを送る(例: http://otel-collector:4318)
 */
// トレースの準備は、ほかより先に済ませます(server/otel.ts)
import { OTEL_ENABLED, SpanKind, SpanStatusCode, context, propagation, shutdownTracing, trace, tracer } from './server/otel';
import type { Context } from '@opentelemetry/api';
import { log } from './server/log';
import type { SsrRequestContext } from './server/app-hooks';
import { AngularNodeAppEngine, createNodeRequestHandler, isMainModule } from '@angular/ssr/node';
import express, { NextFunction, Request, Response } from 'express';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import client from 'prom-client';

// ---------------------------------------------------------------------------
// 設定
// ---------------------------------------------------------------------------
const RENDER_MODE: 'ssr' | 'csr' = (process.env['RENDER_MODE'] ?? 'ssr').toLowerCase() === 'csr' ? 'csr' : 'ssr';
const SSR_TIMEOUT_MS = Number(process.env['SSR_TIMEOUT_MS']) > 0 ? Number(process.env['SSR_TIMEOUT_MS']) : 3000;
const API_INTERNAL_URL = (process.env['API_INTERNAL_URL'] || 'http://api:3001').replace(/\/$/, '');
const API_PUBLIC_URL = (process.env['API_PUBLIC_URL'] || 'http://api.lab.localhost:18080').replace(/\/$/, '');
const SSR_WINDOW_BUG = process.env['SSR_WINDOW_BUG'] === 'true';

const browserDistFolder = join(import.meta.dirname, '../browser');

/**
 * CSR 用の「空の HTML」(殻 = シェル)。中身は <app-root> だけで、画面はブラウザの JS が作ります。
 * ビルドのときに Angular が browser/index.csr.html として出力します。
 */
let csrShellCache: string | undefined;
function csrShellTemplate(): string {
  csrShellCache ??= readFileSync(join(browserDistFolder, 'index.csr.html'), 'utf8');
  return csrShellCache;
}

function escapeAttr(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

/**
 * 返す HTML に 2 つの印を書き足します(SSR・CSR・フォールバックのどれでも同じ)。
 *   1. <html data-render-mode="ssr|csr|fallback"> … 誰が描画したか。画面の下の「描画モード」表示はこれを読みます
 *   2. <meta name="api-public-url" content="…">   … ブラウザが api を呼ぶときの住所(core/tokens.ts が読みます)
 *      JS のファイルに焼き込まず、HTML を返すたびに環境変数から入れるので、同じイメージを d1・s1・p1 で使えます。
 */
function decorateHtml(html: string, mode: 'ssr' | 'csr' | 'fallback'): string {
  const meta = `<meta name="api-public-url" content="${escapeAttr(API_PUBLIC_URL)}">`;
  return html.replace(/<html\b/i, `<html data-render-mode="${mode}"`).replace(/<head>/i, `<head>\n  ${meta}`);
}

// ---------------------------------------------------------------------------
// 指標(Prometheus が 5 秒ごとに GET /metrics で集めます)
// ---------------------------------------------------------------------------
client.collectDefaultMetrics(); // メモリ・CPU・イベントループの遅れなど、プロセスの基本の指標

const ssrRenderDuration = new client.Histogram({
  name: 'ssr_render_duration_seconds',
  help: 'SSR で HTML を作るのにかかった時間(秒)。フォールバックやエラーになったものも含む',
  labelNames: ['route'],
  buckets: [0.05, 0.1, 0.25, 0.5, 1, 2, 3, 5, 10],
});
const ssrFallbackTotal = new client.Counter({
  name: 'ssr_fallback_total',
  help: 'SSR が SSR_TIMEOUT_MS 以内に終わらず、CSR の空の HTML を返した回数',
});
const ssrErrorsTotal = new client.Counter({
  name: 'ssr_errors_total',
  help: 'SSR の途中で失敗して 500 を返した回数',
});
const httpRequestsTotal = new client.Counter({
  name: 'http_requests_total',
  help: 'storefront が受けたリクエストの数',
  labelNames: ['route', 'method', 'status'],
});
const httpRequestDuration = new client.Histogram({
  name: 'http_request_duration_seconds',
  help: 'storefront がリクエストに応えるまでの時間(秒)',
  labelNames: ['route', 'method'],
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2, 3, 5, 10],
});

/**
 * URL を「画面の種類」にまとめます(/p/100001 と /p/100002 を同じ /p/:code として数える)。
 * URL をそのままラベルにすると種類が増えすぎて Prometheus が重くなるためです。
 */
function routeOf(path: string): string {
  if (path === '/' || path === '/search' || path === '/login' || path === '/my-account/orders') return path;
  if (/^\/p\/[^/]+\/?$/.test(path)) return '/p/:code';
  if (/^\/c\/[^/]+\/?$/.test(path)) return '/c/:code';
  if (/^\/my-account\/orders\/[^/]+$/.test(path)) return '/my-account/orders/:code';
  if (path === '/metrics' || path === '/healthz') return path;
  if (/\.[a-z0-9]+$/i.test(path)) return 'static';
  return 'other';
}

// ---------------------------------------------------------------------------
// Express
// ---------------------------------------------------------------------------
const app = express();
app.disable('x-powered-by'); // 使っている製品名をわざわざ教えない
const angularApp = new AngularNodeAppEngine({
  // 前段(cdn-waf・ingress の nginx)が付ける X-Forwarded-* ヘッダを信じます。これを設定しないと Angular が安全のため CSR に切り替えます
  // x-forwarded-scheme は本格版の ingress-nginx が付けるヘッダです(中身は x-forwarded-proto と同じ http / https)。
  // ここに無いと、本格版だけ SSR されずに空の HTML(CSR)になります。
  trustProxyHeaders: ['x-forwarded-for', 'x-forwarded-host', 'x-forwarded-port', 'x-forwarded-proto', 'x-forwarded-scheme'],
});

// リクエストごとに、トレースの区間を作り(OTEL が有効なとき)、1 行ログを出し、指標を数えます
app.use((req: Request, res: Response, next: NextFunction) => {
  const start = process.hrtime.bigint();
  const route = routeOf(req.path);

  // 【トレース】画面のリクエストだけ区間(span)を作ります(JS・CSS や /metrics は数が多いので作りません)。
  // 前の段(ingress など)が traceparent ヘッダを付けてきたら、その続きとしてつなげます(propagation.extract)。
  let span: ReturnType<typeof tracer.startSpan> | undefined;
  let spanCtx: Context | undefined;
  if (OTEL_ENABLED && route !== 'static' && route !== '/metrics' && route !== '/healthz') {
    const parent = propagation.extract(context.active(), req.headers);
    span = tracer.startSpan(
      `${req.method} ${route}`,
      {
        kind: SpanKind.SERVER,
        attributes: { 'http.request.method': req.method, 'http.route': route, 'url.path': req.path },
      },
      parent,
    );
    spanCtx = trace.setSpan(parent, span);
    res.locals['otelContext'] = spanCtx;
    res.locals['traceId'] = span.spanContext().traceId;
  }

  res.on('finish', () => {
    const durationMs = Number(process.hrtime.bigint() - start) / 1e6;
    httpRequestsTotal.inc({ route, method: req.method, status: String(res.statusCode) });
    httpRequestDuration.observe({ route, method: req.method }, durationMs / 1000);
    if (span) {
      span.setAttribute('http.response.status_code', res.statusCode);
      span.setAttribute('ssr.render_mode', String(res.locals['renderMode'] ?? 'none'));
      if (res.statusCode >= 500) span.setStatus({ code: SpanStatusCode.ERROR });
      span.end();
    }
    // /metrics と /healthz は数秒ごとに機械が呼ぶので、ログが埋もれないよう出しません
    if (route === '/metrics' || route === '/healthz') return;
    log({
      level: res.statusCode >= 500 ? 'error' : 'info',
      msg: 'request',
      method: req.method,
      url: req.originalUrl,
      route,
      status: res.statusCode,
      durationMs: Math.round(durationMs * 10) / 10,
      renderMode: res.locals['renderMode'] ?? 'none',
      fallback: res.locals['fallback'] === true,
      trace_id: res.locals['traceId'],
      reqId: req.get('x-request-id'), // cdn-waf が付けたリクエスト番号(cdn-waf・ingress のログの request_id と同じ値)
    });
  });
  if (spanCtx) context.with(spanCtx, next);
  else next();
});

app.get('/healthz', (_req, res) => {
  res.json({ status: 'ok' });
});

app.get('/metrics', async (_req, res) => {
  res.set('Content-Type', client.register.contentType);
  res.send(await client.register.metrics());
});

// JS・CSS などのファイル。名前に内容のハッシュが入っているので 1 年キャッシュしてよい
app.use(
  express.static(browserDistFolder, {
    maxAge: '1y',
    index: false,
    redirect: false,
  }),
);

/** CSR の空の HTML を返します(RENDER_MODE=csr のときと、SSR が時間切れのとき) */
function sendCsrShell(res: Response, mode: 'csr' | 'fallback'): void {
  res.locals['renderMode'] = 'csr';
  res.locals['fallback'] = mode === 'fallback';
  res.set('Content-Type', 'text/html; charset=utf-8');
  res.set('X-Render-Mode', mode);
  res.set('Cache-Control', 'no-store'); // 時間切れの空の HTML を cdn-waf にキャッシュさせない
  res.status(200).send(decorateHtml(csrShellTemplate(), mode));
}

const TIMEOUT = Symbol('timeout');

// 画面(HTML)のリクエスト
app.use(async (req: Request, res: Response, next: NextFunction) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') return next();

  if (RENDER_MODE === 'csr') {
    sendCsrShell(res, 'csr');
    return;
  }

  const route = routeOf(req.path);
  const endTimer = ssrRenderDuration.startTimer({ route });
  // 【トレース】「Angular が HTML を作っていた時間」の区間。SSR 中の api 呼び出しは、この区間の子になります
  const parentCtx = res.locals['otelContext'] as Context | undefined;
  const renderSpan = parentCtx ? tracer.startSpan('ssr.render', { attributes: { 'http.route': route } }, parentCtx) : undefined;
  // Angular への申し送り(REQUEST_CONTEXT)。app.config.server.ts → server/app-hooks.ts が受け取ります
  const requestContext: SsrRequestContext = {
    otelContext: renderSpan && parentCtx ? trace.setSpan(parentCtx, renderSpan) : undefined,
    traceId: res.locals['traceId'],
  };
  let timer: NodeJS.Timeout | undefined;
  try {
    // SSR 本体。API の返事を待つので、API が遅いとここも遅くなります
    const render = angularApp.handle(req, requestContext).then(async (response) => {
      if (!response) return null;
      return { status: response.status, headers: response.headers, html: await response.text() };
    });
    const timeout = new Promise<typeof TIMEOUT>((resolve) => {
      timer = setTimeout(() => resolve(TIMEOUT), SSR_TIMEOUT_MS);
    });
    const result = await Promise.race([render, timeout]);

    if (result === TIMEOUT) {
      // 時間切れ: SSR はあきらめて空の HTML を返す。画面はブラウザが作る(利用者には少し遅く見えるが、真っ白にはならない)
      endTimer();
      ssrFallbackTotal.inc();
      renderSpan?.setAttribute('ssr.fallback', true);
      renderSpan?.end();
      log({ level: 'warn', event: 'ssr_fallback', url: req.originalUrl, route, timeoutMs: SSR_TIMEOUT_MS, trace_id: res.locals['traceId'] });
      render.catch(() => undefined); // あとから失敗しても、もう返事は済んでいるので無視します
      sendCsrShell(res, 'fallback');
      return;
    }
    endTimer();
    renderSpan?.end();
    if (!result) return next();

    res.locals['renderMode'] = 'ssr';
    res.locals['fallback'] = false;
    result.headers.forEach((value, key) => {
      if (key !== 'content-length') res.setHeader(key, value);
    });
    res.set('X-Render-Mode', 'ssr');
    res.status(result.status).send(decorateHtml(result.html, 'ssr'));
  } catch (err) {
    // SSR の途中で例外(たとえば SSR_WINDOW_BUG=true で「window is not defined」)
    endTimer();
    ssrErrorsTotal.inc();
    const message = err instanceof Error ? err.message : String(err);
    if (renderSpan) {
      renderSpan.recordException(err instanceof Error ? err : new Error(message));
      renderSpan.setStatus({ code: SpanStatusCode.ERROR, message });
      renderSpan.end();
    }
    log({ level: 'error', event: 'ssr_error', url: req.originalUrl, route, error: message, trace_id: res.locals['traceId'] });
    res.locals['renderMode'] = 'ssr';
    res.locals['fallback'] = false;
    res
      .status(500)
      .set('Content-Type', 'text/html; charset=utf-8')
      .set('X-Render-Mode', 'ssr')
      .send('<!doctype html><html lang="ja"><meta charset="utf-8"><title>エラー</title>' +
        '<h1>ただいま表示できません(500)</h1><p>サーバーで画面を作る途中で問題が起きました。</p></html>');
  } finally {
    clearTimeout(timer);
  }
});

// ---------------------------------------------------------------------------
// 起動
// ---------------------------------------------------------------------------
if (isMainModule(import.meta.url) || process.env['pm_id']) {
  const port = Number(process.env['PORT']) || 4000;
  const server = app.listen(port, (error) => {
    if (error) throw error;
    log({
      level: 'info',
      msg: 'storefront started',
      port,
      renderMode: RENDER_MODE,
      ssrTimeoutMs: SSR_TIMEOUT_MS,
      ssrWindowBug: SSR_WINDOW_BUG,
      apiInternalUrl: API_INTERNAL_URL,
      apiPublicUrl: API_PUBLIC_URL,
      otel: OTEL_ENABLED,
    });
  });

  // 止める合図(docker stop や Kubernetes のローリング更新)が来たら、受け付け中の処理を終えてから止まります
  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.on(signal, () => {
      log({ level: 'info', msg: `received ${signal}, shutting down` });
      // 送り残したトレースを送ってから止まります
      server.close(() => void shutdownTracing().finally(() => process.exit(0)));
      setTimeout(() => process.exit(0), 10_000).unref();
    });
  }
}

/** Angular CLI(ng serve やビルド時)が使う入口 */
export const reqHandler = createNodeRequestHandler(app);
