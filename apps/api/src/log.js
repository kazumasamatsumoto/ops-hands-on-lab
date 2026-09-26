// ログの出し方をそろえるところです。JSON で 1 行ずつ標準出力に出します。
// Docker(または Kubernetes)がそれを受け取り、Alloy が Loki へ運びます。
//
// トレースが動いているときは、各行に trace_id を入れます。
// Grafana でログの trace_id を押すと、同じリクエストの道筋(Tempo)に飛べるようにするためです。
'use strict';

const pino = require('pino');
const { trace } = require('@opentelemetry/api');

const aspect = process.env.ASPECT ?? 'api';

function currentTraceIds() {
  const span = trace.getActiveSpan();
  if (!span) return null;
  const ctx = span.spanContext();
  return { trace_id: ctx.traceId, span_id: ctx.spanId };
}

const log = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  base: { service: `samplestore-${aspect}`, aspect },
  // mixin: ログを 1 行出すたびに呼ばれ、返した項目がその行に足されます。
  mixin() {
    return currentTraceIds() ?? {};
  },
});

module.exports = { log, currentTraceIds };
