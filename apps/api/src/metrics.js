// Prometheus に渡す指標(メトリクス)を作るところです。
// 指標 = 体温計や体重計のように、あとで数えたり比べたりするための数字です。
'use strict';

const client = require('prom-client');
const { chaos, leakedMb } = require('./chaos');

const register = new client.Registry();

// Node.js の標準的な指標(メモリ使用量、イベントループの遅れなど)も一緒に出します。
client.collectDefaultMetrics({ register });

const httpRequestsTotal = new client.Counter({
  name: 'http_requests_total',
  help: 'HTTP リクエストの数(route・method・status ごと)',
  labelNames: ['route', 'method', 'status'],
  registers: [register],
});

const httpRequestDuration = new client.Histogram({
  name: 'http_request_duration_seconds',
  help: 'HTTP リクエストの処理時間(秒)',
  labelNames: ['route', 'method', 'status'],
  // 5ms〜10s。SLO の判定(例: 300ms 以内)に使えるよう細かめに刻みます。
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.2, 0.3, 0.5, 1, 2, 3, 5, 10],
  registers: [register],
});

// いまスイッチがどうなっているかも数字で出します(ダッシュボードで「今は壊している最中」と分かるように)。
new client.Gauge({
  name: 'lab_chaos_setting',
  help: 'カオススイッチの現在値(真偽値は 1/0)',
  labelNames: ['name'],
  registers: [register],
  collect() {
    for (const [name, value] of Object.entries(chaos)) {
      this.set({ name }, typeof value === 'boolean' ? Number(value) : value);
    }
  },
});

new client.Gauge({
  name: 'lab_leaked_megabytes',
  help: 'leakMb スイッチでため込んだメモリ(MB)',
  registers: [register],
  collect() {
    this.set(leakedMb());
  },
});

// 検索の実体(db / solr)ごとの件数と失敗。Solr が止まったときに「検索だけ」壊れているのが分かります。
const searchRequestsTotal = new client.Counter({
  name: 'search_requests_total',
  help: '商品検索の回数(provider = db|solr、result = ok|error)',
  labelNames: ['provider', 'result'],
  registers: [register],
});

// リクエストが終わったときに数えるミドルウェアです。
// route はパターン(例: /occ/v2/samplestore/products/:code)を使います。実際の商品コードを入れると種類が増えすぎるためです。
function metricsMiddleware(req, res, next) {
  const end = httpRequestDuration.startTimer();
  res.on('finish', () => {
    // ルートに届く前に返した答え(例: OCC の入口のカオスの errorRate で返した 500)は req.route がありません。
    // 'unmatched' にすると SLI の計算から外れてしまうので、ルーター(req.baseUrl)の下の「/*」として数えます。
    const route = req.route ? `${req.baseUrl}${req.route.path}` : req.baseUrl ? `${req.baseUrl}/*` : 'unmatched';
    const labels = { route, method: req.method, status: String(res.statusCode) };
    httpRequestsTotal.inc(labels);
    end(labels);
  });
  next();
}

module.exports = { client, register, metricsMiddleware, searchRequestsTotal };
