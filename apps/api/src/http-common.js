// どの aspect でも同じ「土台」: アクセスログ・指標・見守り用の入口・エラーの受け皿・穏やかな停止。
'use strict';

const express = require('express');
const { log, currentTraceIds } = require('./log');
const { pool } = require('./db');
const { register, metricsMiddleware } = require('./metrics');

const QUIET = new Set(['/metrics', '/healthz', '/readyz']);

// 起動の準備(DB の初期化や、表ができるのを待つこと)が終わったか。終わるまで /readyz は 503 です。
let started = false;
function markReady() {
  started = true;
}

// 失敗の返し方を 1 つにそろえます: { errors: [ { type, message } ] }(OCC と同じ形)。
function sendError(res, status, type, message) {
  res.status(status).json({ errors: [{ type, message }] });
}

function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', true); // cdn-waf と ingress の後ろにいるので、X-Forwarded-For を信じます

  // リクエストごとに 1 行のアクセスログを出します。
  app.use((req, res, next) => {
    const started = process.hrtime.bigint();
    // trace_id は受付の時点で覚えておきます(終わりの合図のときには、道筋の区切りがもう閉じていることがあるため)。
    const ids = currentTraceIds();
    req.log = log.child({ reqId: req.get('x-request-id') ?? undefined });
    res.on('finish', () => {
      if (QUIET.has(req.path)) return; // 収集やプローブの定期アクセスはうるさいので省きます
      const durationMs = Number(process.hrtime.bigint() - started) / 1e6;
      const route = req.route ? `${req.baseUrl}${req.route.path}` : 'unmatched';
      const level = res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info';
      req.log[level](
        {
          ...(ids ?? {}),
          method: req.method,
          path: req.originalUrl,
          route,
          status: res.statusCode,
          durationMs: Math.round(durationMs),
          ip: req.ip,
        },
        'request',
      );
    });
    next();
  });
  app.use(metricsMiddleware);

  // 生きているか(プロセスが応答できるか)。DB は見ません。
  app.get('/healthz', (req, res) => {
    res.json({ status: 'ok' });
  });

  // 準備できているか(DB に届くか)。届かなければ 503 を返し、振り分け先から外してもらいます。
  app.get('/readyz', async (req, res) => {
    if (!started) {
      res.status(503).json({ status: 'not_ready', reason: 'starting' });
      return;
    }
    try {
      await pool.query('SELECT 1');
      res.json({ status: 'ready' });
    } catch (err) {
      req.log.warn({ err: err.message }, 'readyz: DB に届きません');
      res.status(503).json({ status: 'not_ready', reason: 'db_unreachable' });
    }
  });

  app.get('/metrics', async (req, res) => {
    res.set('Content-Type', register.contentType);
    res.send(await register.metrics());
  });

  return app;
}

// ルートを全部付けたあとに呼びます: 見つからない・エラーの受け皿。
function finishApp(app) {
  app.use((req, res) => {
    sendError(res, 404, 'NotFoundError', 'そのパスはありません');
  });
  // Express 5 では async の関数で投げた例外もここに届きます。中身(SQL など)は外に見せません。
  app.use((err, req, res, _next) => {
    if (err.type === 'entity.parse.failed') {
      sendError(res, 400, 'ValidationError', 'JSON の形が正しくありません');
      return;
    }
    req.log.error({ err: { message: err.message, code: err.code } }, 'エラーが起きました');
    if (res.headersSent) return;
    sendError(res, 500, 'InternalServerError', 'サーバーでエラーが起きました');
  });
}

// 待ち受けを始め、止める合図(SIGTERM)で穏やかに止まるようにします。
// 穏やかな停止: 受付中のリクエストを片付け、DB の接続を返し、送り残したトレースを送ってから終わります。
function listen(app, port, info, onStop = async () => {}) {
  const server = app.listen(port, () => {
    log.info({ port, ...info }, '起動しました');
  });
  let stopping = false;
  for (const signal of ['SIGTERM', 'SIGINT']) {
    process.on(signal, () => {
      if (stopping) return;
      stopping = true;
      log.info({ signal }, '停止します');
      setTimeout(() => process.exit(0), 10_000).unref();
      server.close(async () => {
        await onStop().catch(() => {});
        await pool.end().catch(() => {});
        await globalThis.__labOtelShutdown?.().catch(() => {});
        process.exit(0);
      });
    });
  }
  return server;
}

module.exports = { createApp, finishApp, listen, sendError, markReady };
