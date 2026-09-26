// OpenTelemetry(トレース)の準備です。`node --require ./src/otel.js` で、アプリ本体より先に読み込みます。
//
// トレース = 1 つのリクエストが「どの部品で・何ミリ秒かかったか」を順に記録した道筋です。
// たとえ: 宅配便の追跡番号。受付 → 仕分け → 配達 と、どこを通ったかが 1 つの番号でたどれます。
//
// なぜ先に読み込むのか: http・express・pg の「自動計測」は、それらの部品が読み込まれる瞬間に
// 中身を包み込んで(差し込んで)計測します。アプリが先に読み込んでしまうと包めません。
//
// 送り先 OTEL_EXPORTER_OTLP_ENDPOINT(例: http://otel-collector:4318)が無いときは何もしません。
// 軽量版はトレースを使わないので、この場合は余計な処理が一切動きません。
// (CCv2 では、この役を APM の Dynatrace が受け持ちます)
'use strict';

const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;

if (endpoint) {
  const { NodeSDK } = require('@opentelemetry/sdk-node');
  const { OTLPTraceExporter } = require('@opentelemetry/exporter-trace-otlp-http');
  const { HttpInstrumentation } = require('@opentelemetry/instrumentation-http');
  const { ExpressInstrumentation, ExpressLayerType } = require('@opentelemetry/instrumentation-express');
  const { PgInstrumentation } = require('@opentelemetry/instrumentation-pg');
  const { UndiciInstrumentation } = require('@opentelemetry/instrumentation-undici');
  const { resourceFromAttributes } = require('@opentelemetry/resources');
  const { ATTR_SERVICE_NAME } = require('@opentelemetry/semantic-conventions');

  const aspect = process.env.ASPECT ?? 'api';
  // 見守り用の定期アクセス(Prometheus の収集やプローブ)はトレースにすると数が多すぎるので外します。
  const quietPaths = new Set(['/metrics', '/healthz', '/readyz']);

  const sdk = new NodeSDK({
    resource: resourceFromAttributes({
      [ATTR_SERVICE_NAME]: process.env.OTEL_SERVICE_NAME ?? `samplestore-${aspect}`,
    }),
    // 送り先は環境変数 OTEL_EXPORTER_OTLP_ENDPOINT から読まれ、末尾に /v1/traces が付きます(OTLP/HTTP)。
    traceExporter: new OTLPTraceExporter(),
    instrumentations: [
      new HttpInstrumentation({
        ignoreIncomingRequestHook: (req) => quietPaths.has((req.url ?? '').split('?')[0]),
      }),
      // Express の「ミドルウェア 1 つずつ」の区切りは数が多く読みにくいので省き、ルートと処理本体だけ残します。
      new ExpressInstrumentation({ ignoreLayersType: [ExpressLayerType.MIDDLEWARE] }),
      new PgInstrumentation(),
      // Node の fetch(Solr への問い合わせに使う)も道筋に載せます。
      new UndiciInstrumentation(),
    ],
  });
  sdk.start();
  // 停止時に、まだ送っていないトレースを送り切るための関数をアプリ側から呼べるようにします。
  globalThis.__labOtelShutdown = () => sdk.shutdown();
}
