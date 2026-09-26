/**
 * OpenTelemetry(トレース)の準備。環境変数 OTEL_EXPORTER_OTLP_ENDPOINT があるときだけ動きます。
 *
 * トレース = 1 つのリクエストが、どの部品を通って、それぞれ何ミリ秒かかったかの記録です。
 * 区間(span)を入れ子にして表します。storefront では次の 3 種類を作ります。
 *
 *   GET /p/:code            … storefront がブラウザから受けたリクエスト(server.ts)
 *     └ ssr.render          … Angular が HTML を作っていた時間(server.ts)
 *         ├ GET /occ/v2/samplestore/cms/pages          … SSR 中の api 呼び出し(app-hooks.ts)
 *         └ GET /occ/v2/samplestore/products/{code}
 *              └ (ここから先は api が作る区間。traceparent ヘッダでつながります)
 *
 * 送り先: OTEL_EXPORTER_OTLP_ENDPOINT(例: http://otel-collector:4318)の /v1/traces に、OTLP(HTTP)で送ります。
 * サービス名: samplestore-storefront(OTEL_SERVICE_NAME で上書きできます)。
 *
 * 自動計測(http・express を勝手に計測する仕組み)は使わず、区間は自分で作っています。
 * このアプリはビルドで 1 つのファイルにまとめられるため、ライブラリを後から差し替える自動計測が効きにくいからです。
 */
import { SpanKind, SpanStatusCode, context, propagation, trace } from '@opentelemetry/api';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { BatchSpanProcessor, NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import { ATTR_SERVICE_NAME } from '@opentelemetry/semantic-conventions';

export const OTEL_ENABLED = Boolean(process.env['OTEL_EXPORTER_OTLP_ENDPOINT']);

let provider: NodeTracerProvider | undefined;
if (OTEL_ENABLED) {
  provider = new NodeTracerProvider({
    resource: resourceFromAttributes({
      [ATTR_SERVICE_NAME]: process.env['OTEL_SERVICE_NAME'] || 'samplestore-storefront',
    }),
    // 区間は少しずつまとめて送ります(1 つずつ送ると、それ自体が負荷になるため)
    spanProcessors: [new BatchSpanProcessor(new OTLPTraceExporter())],
  });
  // register() で「今どの区間の中にいるか」を覚える仕組みと、traceparent ヘッダの読み書き(W3C 形式)が有効になります
  provider.register();
}

/** OTEL が無効のときは、何もしない(記録しない)区間を返す tracer になります */
export const tracer = trace.getTracer('samplestore-storefront');

export async function shutdownTracing(): Promise<void> {
  await provider?.shutdown().catch(() => undefined);
}

export { SpanKind, SpanStatusCode, context, propagation, trace };
