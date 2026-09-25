// Prometheus に渡す指標(メトリクス)を作るところです。
// 指標 = 体温計や体重計のように、あとで数えたり比べたりするための数字です。
import client from 'prom-client';
import { chaos, leakedMb } from './chaos.js';

export const register = new client.Registry();

// Node.js の標準的な指標(メモリ使用量、イベントループの遅れなど)も一緒に出します。
client.collectDefaultMetrics({ register });

export const httpRequestsTotal = new client.Counter({
  name: 'http_requests_total',
  help: 'HTTP リクエストの数(route・method・status ごと)',
  labelNames: ['route', 'method', 'status'],
  registers: [register],
});

export const httpRequestDuration = new client.Histogram({
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

// リクエストが終わったときに数えるミドルウェアです。
// route はパターン(例: /api/products/:id)を使います。実際の ID を入れると種類が増えすぎるためです。
export function metricsMiddleware(req, res, next) {
  const end = httpRequestDuration.startTimer();
  res.on('finish', () => {
    const route = req.route ? `${req.baseUrl}${req.route.path}` : 'unmatched';
    const labels = { route, method: req.method, status: String(res.statusCode) };
    httpRequestsTotal.inc(labels);
    end(labels);
  });
  next();
}
