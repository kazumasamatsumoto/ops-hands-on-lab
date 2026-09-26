// ASPECT=backgroundProcessing — 画面を持たず、決まった時間ごとに仕事(定期ジョブ)をする役です。
// CCv2 の backgroundProcessing aspect に当たります(CronJob はここで動きます)。
// 外に出すのは /healthz と /metrics だけ(/admin/chaos は中からだけ)。
//
// ジョブ:
//   stockImportJob : 在庫を少し変える。基幹システム(倉庫)からの在庫の取り込みの代わり。
//   searchIndexJob : Solr の索引を全件作り直す。SEARCH_PROVIDER=db のときは何もせず「成功」を記録。
//
// 見張り方: ジョブが止まったり失敗し続けたりすると、画面は動いていても在庫や検索が古くなります(気付きにくい障害)。
// そこで cronjob_last_success_timestamp_seconds(最後に成功した時刻)を出し、
// 「5 分以上成功していない」をアラートにします。
'use strict';

const express = require('express');
const { trace, SpanStatusCode } = require('@opentelemetry/api');
const { chaos, mountChaosAdmin } = require('../chaos');
const { createApp, finishApp } = require('../http-common');
const { client, register } = require('../metrics');
const { pool } = require('../db');
const { log } = require('../log');
const solr = require('../solr');
const { COLUMNS, FROM } = require('../occ/products-repo');
const { PROVIDER } = require('../occ/search');

const INTERVAL_SECONDS = Math.max(Number(process.env.CRON_INTERVAL_SECONDS ?? 60) || 60, 1);

const runs = new client.Counter({
  name: 'cronjob_runs_total',
  help: '定期ジョブを動かした回数(job = ジョブ名、result = success|failure)',
  labelNames: ['job', 'result'],
  registers: [register],
});
const lastSuccess = new client.Gauge({
  name: 'cronjob_last_success_timestamp_seconds',
  help: '定期ジョブが最後に成功した時刻(UNIX 秒)。起動した時刻から始まります',
  labelNames: ['job'],
  registers: [register],
});
const duration = new client.Histogram({
  name: 'cronjob_duration_seconds',
  help: '定期ジョブ 1 回にかかった時間(秒)',
  labelNames: ['job'],
  buckets: [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30],
  registers: [register],
});

const JOBS = {
  // 在庫の取り込みの代わり: ランダムな 5 商品の在庫を -3〜+5 だけ動かします。
  async stockImportJob() {
    const { rows } = await pool.query(
      `UPDATE products SET stock = GREATEST(0, stock + floor(random() * 9)::int - 3), updated_at = now()
        WHERE code IN (SELECT code FROM products ORDER BY random() LIMIT 5)
        RETURNING code, stock`,
    );
    return { updated: rows.length };
  },
  async searchIndexJob() {
    if (PROVIDER !== 'solr') return { skipped: 'SEARCH_PROVIDER=db なので索引は作りません' };
    const { rows } = await pool.query(`SELECT ${COLUMNS} ${FROM} ORDER BY p.code`);
    const indexed = await solr.reindex(rows);
    return { indexed, solr: solr.SOLR_URL };
  },
};

const running = new Set();

// ジョブ 1 回を、トレースの 1 本の道筋にします(中の DB や Solr への問い合わせが、その下にぶら下がります)。
// トレースを送っていないときは、何もしない「空の道筋」になるだけです。
const tracer = trace.getTracer('samplestore-worker');

function runJob(name) {
  return tracer.startActiveSpan(`job ${name}`, (span) => runJobInSpan(name, span).finally(() => span.end()));
}

async function runJobInSpan(name, span) {
  if (running.has(name)) {
    log.warn({ job: name }, '前の回がまだ終わっていないので、今回は飛ばします');
    return;
  }
  running.add(name);
  const end = duration.startTimer({ job: name });
  try {
    if (chaos.cronFail) throw new Error('わざと失敗させています(CHAOS_CRON_FAIL)');
    const detail = await JOBS[name]();
    runs.inc({ job: name, result: 'success' });
    lastSuccess.set({ job: name }, Date.now() / 1000);
    log.info({ job: name, result: 'success', ...detail }, 'ジョブが成功しました');
  } catch (err) {
    runs.inc({ job: name, result: 'failure' });
    span.recordException(err);
    span.setStatus({ code: SpanStatusCode.ERROR, message: err.message });
    log.error({ job: name, result: 'failure', err: err.message }, 'ジョブが失敗しました');
  } finally {
    end();
    running.delete(name);
  }
}

const timers = [];

function startJobs() {
  const now = Date.now() / 1000;
  for (const name of Object.keys(JOBS)) {
    // 0 回の行も最初から出しておきます(グラフやアラートの式で「まだ無い」を扱わなくて済むように)。
    runs.inc({ job: name, result: 'success' }, 0);
    runs.inc({ job: name, result: 'failure' }, 0);
    lastSuccess.set({ job: name }, now);
    setTimeout(() => runJob(name), 1000).unref();
    timers.push(setInterval(() => runJob(name), INTERVAL_SECONDS * 1000));
  }
  log.info({ jobs: Object.keys(JOBS), intervalSeconds: INTERVAL_SECONDS, searchProvider: PROVIDER }, '定期ジョブを始めました');
}

function stopJobs() {
  for (const t of timers) clearInterval(t);
}

function build() {
  const app = createApp();
  app.use(express.json({ limit: '10kb' }));
  mountChaosAdmin(app);
  finishApp(app);
  return app;
}

module.exports = { build, startJobs, stopJobs };
