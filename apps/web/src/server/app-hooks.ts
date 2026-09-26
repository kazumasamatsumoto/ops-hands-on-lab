/**
 * Angular のアプリの中(SSR 中)で使う、サーバーだけの道具。app.config.server.ts から使います。
 *
 * server.ts は 1 リクエストごとに angularApp.handle(req, 申し送り) を呼び、
 * 「このリクエストのトレースの区間」を申し送り(REQUEST_CONTEXT)として Angular に渡します。
 * ここではそれを受け取って、
 *   - api 呼び出しごとに子の区間を作り、traceparent ヘッダを返す(createApiCallTracer)
 *   - 警告のログに trace_id を入れる(createWarnLogger)
 * をします。
 */
import { Context, SpanKind, SpanStatusCode, propagation, trace } from '@opentelemetry/api';
import type { ApiCallTracer, WarnLogger } from '../app/core/tokens';
import { log } from './log';

// server/otel.ts は server.ts 側で読み込み済みです。ここでは「登録済みの仕組み」を @opentelemetry/api から借りるだけにします
// (Angular のアプリはビルドで別の束になるので、otel.ts をここでも読むと、準備が 2 回走ってしまうため)。
const OTEL_ENABLED = Boolean(process.env['OTEL_EXPORTER_OTLP_ENDPOINT']);
const tracer = trace.getTracer('samplestore-storefront');

/** server.ts から Angular へ渡す申し送り(REQUEST_CONTEXT)の形 */
export interface SsrRequestContext {
  otelContext?: Context;
  traceId?: string;
}

/** これより遅い api 呼び出しはログに出します(ミリ秒) */
const SLOW_API_MS = 1000;

/**
 * 区間の名前にする「呼び先の種類」。商品コードや注文番号は {code} にまとめます
 * (名前の種類が増えすぎると、Tempo での集計が役に立たなくなるため)。
 */
function apiRouteOf(path: string): string {
  return path
    .replace(/\/products\/(?!search$)[^/]+$/, '/products/{code}')
    .replace(/\/orders\/[^/]+$/, '/orders/{code}');
}

export function createApiCallTracer(rc: SsrRequestContext | null, apiInternalUrl: string): ApiCallTracer {
  return (method, url) => {
    const started = performance.now();
    const name = `${method} ${apiRouteOf(url)}`;
    const parent = rc?.otelContext;
    const span =
      OTEL_ENABLED && parent
        ? tracer.startSpan(
            name,
            {
              kind: SpanKind.CLIENT,
              attributes: { 'http.request.method': method, 'url.full': apiInternalUrl + url },
            },
            parent,
          )
        : undefined;
    // traceparent ヘッダ(例: 00-<trace_id 32 桁>-<この区間の id 16 桁>-01)を作ります
    const headers: Record<string, string> = {};
    if (span && parent) propagation.inject(trace.setSpan(parent, span), headers);

    return {
      headers,
      end(status: number) {
        const durationMs = Math.round((performance.now() - started) * 10) / 10;
        if (span) {
          span.setAttribute('http.response.status_code', status);
          if (status === 0 || status >= 500) span.setStatus({ code: SpanStatusCode.ERROR });
          span.end();
        }
        // 失敗と遅い呼び出しだけログに出します(全部出すとログが api 呼び出しで埋まるため)
        if (status === 0 || status >= 400 || durationMs >= SLOW_API_MS) {
          log({
            level: status === 0 || status >= 500 ? 'warn' : 'info',
            event: 'ssr_api_call',
            method,
            api: apiRouteOf(url),
            status,
            durationMs,
            trace_id: rc?.traceId,
          });
        }
      },
    };
  };
}

export function createWarnLogger(rc: SsrRequestContext | null, url: string | undefined): WarnLogger {
  return (event, fields) => log({ level: 'warn', event, url, ...fields, trace_id: rc?.traceId });
}
