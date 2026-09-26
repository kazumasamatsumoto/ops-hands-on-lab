// 入口です。環境変数 ASPECT で、このプロセスの役割を決めます(同じイメージを 3 通りに使う)。
//   ASPECT=api                  … 外から呼ばれる REST API(OCC 風)・OAuth・画像(CCv2 の api aspect)
//   ASPECT=backoffice           … 社内向けの管理画面(CCv2 の backoffice aspect)
//   ASPECT=backgroundProcessing … 定期ジョブ(CCv2 の backgroundProcessing aspect)
// たとえ: 同じ制服の店員が、名札(ASPECT)でレジ係・事務係・倉庫係に分かれる。中身(イメージ)は同じなので、配り方が 1 通りで済みます。
'use strict';

const { log } = require('./log');
const { waitForDatabase } = require('./db');
const { listen, markReady } = require('./http-common');

const ASPECTS = new Set(['api', 'backoffice', 'backgroundProcessing']);
const aspect = process.env.ASPECT ?? 'api';
const PORT = Number(process.env.PORT ?? 3001);

async function main() {
  if (!ASPECTS.has(aspect)) {
    log.fatal({ aspect }, 'ASPECT は api・backoffice・backgroundProcessing のどれかにしてください');
    process.exit(1);
  }
  const mod = require(aspect === 'api' ? './aspects/api' : aspect === 'backoffice' ? './aspects/backoffice' : './aspects/worker');
  // 先に待ち受けを始めます(/healthz はすぐ 200、/readyz は準備ができるまで 503)。
  listen(mod.build(), PORT, { otel: Boolean(process.env.OTEL_EXPORTER_OTLP_ENDPOINT) }, async () => mod.stopJobs?.());
  // api は表を作って見本データを入れ、ほかは api がそれを終えるまで待ちます。
  await waitForDatabase(aspect);
  mod.startJobs?.();
  markReady();
  log.info('準備ができました');
}

main().catch((err) => {
  log.fatal({ err: err.message }, '起動に失敗しました');
  process.exit(1);
});
