/**
 * サンプルストア web の Express サーバー。
 *
 * 役目は 3 つです。
 *   1. JS・CSS・画像などのファイルを配る
 *   2. 画面の HTML を作る(SSR = サーバーで描画 / CSR = 空の HTML を返してブラウザで描画)
 *   3. 運用のための口を出す(/healthz = 生きているか、/metrics = 指標)
 *
 * 環境変数(スイッチ)
 *   PORT              待ち受けるポート(既定 4000)
 *   RENDER_MODE       ssr | csr(既定 ssr)。csr にすると、どの画面もサーバーでは描画せず空の HTML を返します
 *   SSR_TIMEOUT_MS    SSR をあきらめるまでの時間(既定 3000)。超えたら空の HTML を返します(フォールバック)
 *   SSR_WINDOW_BUG    true でわざと SSR を壊します(サーバーで window を触るコードが動き 500 になる)
 *   API_INTERNAL_URL  サーバーから見た api の住所(既定 http://api:3001)
 *   NG_ALLOWED_HOSTS  Host ヘッダとして受け付ける名前を足す(カンマ区切り。Angular の機能)
 */
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

/** <html> に「誰が描画したか」の印を付けます。画面の下の「描画モード」表示はこれを読みます */
function markRenderMode(html: string, mode: 'ssr' | 'csr' | 'fallback'): string {
  return html.replace(/<html\b/i, `<html data-render-mode="${mode}"`);
}

// ---------------------------------------------------------------------------
// ログ(1 行 = 1 つの JSON。Loki などで項目ごとに絞り込めます)
// ---------------------------------------------------------------------------
function log(fields: Record<string, unknown>): void {
  process.stdout.write(JSON.stringify({ time: new Date().toISOString(), service: 'web', ...fields }) + '\n');
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
  help: 'web が受けたリクエストの数',
  labelNames: ['route', 'method', 'status'],
});
const httpRequestDuration = new client.Histogram({
  name: 'http_request_duration_seconds',
  help: 'web がリクエストに応えるまでの時間(秒)',
  labelNames: ['route', 'method'],
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2, 3, 5, 10],
});

/**
 * URL を「画面の種類」にまとめます(/products/1 と /products/2 を同じ /products/:id として数える)。
 * URL をそのままラベルにすると種類が増えすぎて Prometheus が重くなるためです。
 */
function routeOf(path: string): string {
  if (path === '/') return '/';
  if (path === '/products' || path === '/login' || path === '/me/orders') return path;
  if (/^\/products\/[^/]+$/.test(path)) return '/products/:id';
  if (/^\/me\/orders\/[^/]+$/.test(path)) return '/me/orders/:orderId';
  if (path === '/metrics' || path === '/healthz') return path;
  if (path.startsWith('/api/')) return '/api/*';
  if (/\.[a-z0-9]+$/i.test(path)) return 'static';
  return 'other';
}

// ---------------------------------------------------------------------------
// Express
// ---------------------------------------------------------------------------
const app = express();
app.disable('x-powered-by'); // 使っている製品名をわざわざ教えない
const angularApp = new AngularNodeAppEngine({
  // edge(nginx)が付ける X-Forwarded-* ヘッダを信じます。これを設定しないと Angular が安全のため CSR に切り替えます
  trustProxyHeaders: ['x-forwarded-for', 'x-forwarded-host', 'x-forwarded-port', 'x-forwarded-proto'],
});

// リクエストごとに 1 行ログを出し、指標を数えます
app.use((req: Request, res: Response, next: NextFunction) => {
  const start = process.hrtime.bigint();
  res.on('finish', () => {
    const durationMs = Number(process.hrtime.bigint() - start) / 1e6;
    const route = routeOf(req.path);
    httpRequestsTotal.inc({ route, method: req.method, status: String(res.statusCode) });
    httpRequestDuration.observe({ route, method: req.method }, durationMs / 1000);
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
    });
  });
  next();
});

app.get('/healthz', (_req, res) => {
  res.json({ status: 'ok' });
});

app.get('/metrics', async (_req, res) => {
  res.set('Content-Type', client.register.contentType);
  res.send(await client.register.metrics());
});

/**
 * /api/* の予備の中継。
 * ふだんは edge(nginx)が /api を api へ振り分けるので、ここには来ません。
 * edge を通さずに web(4000 番)を直接開いた演習のときだけ、ブラウザの /api 呼び出しを api へ渡します。
 */
app.use('/api', express.raw({ type: '*/*', limit: '1mb' }), async (req: Request, res: Response) => {
  res.locals['renderMode'] = 'proxy';
  const headers: Record<string, string> = {};
  for (const name of ['content-type', 'authorization', 'accept']) {
    const value = req.headers[name];
    if (typeof value === 'string') headers[name] = value;
  }
  try {
    const upstream = await fetch(API_INTERNAL_URL + req.originalUrl, {
      method: req.method,
      headers,
      body: req.method === 'GET' || req.method === 'HEAD' ? undefined : Buffer.isBuffer(req.body) && req.body.length > 0 ? new Uint8Array(req.body) : undefined,
      signal: AbortSignal.timeout(10_000),
    });
    res.status(upstream.status);
    const type = upstream.headers.get('content-type');
    if (type) res.set('Content-Type', type);
    res.send(Buffer.from(await upstream.arrayBuffer()));
  } catch {
    res.status(502).json({ error: 'api に届きませんでした' });
  }
});

// JS・CSS・画像などのファイル。名前に内容のハッシュが入っているので 1 年キャッシュしてよい
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
  res.set('Cache-Control', 'no-store'); // 時間切れの空の HTML を edge にキャッシュさせない
  res.status(200).send(markRenderMode(csrShellTemplate(), mode));
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
  let timer: NodeJS.Timeout | undefined;
  try {
    // SSR 本体。API の返事を待つので、API が遅いとここも遅くなります
    const render = angularApp.handle(req).then(async (response) => {
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
      log({ level: 'warn', event: 'ssr_fallback', url: req.originalUrl, route, timeoutMs: SSR_TIMEOUT_MS });
      render.catch(() => undefined); // あとから失敗しても、もう返事は済んでいるので無視します
      sendCsrShell(res, 'fallback');
      return;
    }
    endTimer();
    if (!result) return next();

    res.locals['renderMode'] = 'ssr';
    res.locals['fallback'] = false;
    result.headers.forEach((value, key) => {
      if (key !== 'content-length') res.setHeader(key, value);
    });
    res.set('X-Render-Mode', 'ssr');
    res.status(result.status).send(markRenderMode(result.html, 'ssr'));
  } catch (err) {
    // SSR の途中で例外(たとえば SSR_WINDOW_BUG=true で「window is not defined」)
    endTimer();
    ssrErrorsTotal.inc();
    const message = err instanceof Error ? err.message : String(err);
    log({ level: 'error', event: 'ssr_error', url: req.originalUrl, route, error: message });
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
      msg: 'web started',
      port,
      renderMode: RENDER_MODE,
      ssrTimeoutMs: SSR_TIMEOUT_MS,
      ssrWindowBug: SSR_WINDOW_BUG,
      apiInternalUrl: API_INTERNAL_URL,
    });
  });

  // 止める合図(docker stop や Kubernetes のローリング更新)が来たら、受け付け中の処理を終えてから止まります
  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.on(signal, () => {
      log({ level: 'info', msg: `received ${signal}, shutting down` });
      server.close(() => process.exit(0));
      setTimeout(() => process.exit(0), 10_000).unref();
    });
  }
}

/** Angular CLI(ng serve やビルド時)が使う入口 */
export const reqHandler = createNodeRequestHandler(app);
