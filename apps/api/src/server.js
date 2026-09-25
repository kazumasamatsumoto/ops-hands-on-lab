// サンプルストアの API サーバーです。
// 商品・ログイン(JWT)・注文を返し、わざと壊すスイッチ(chaos.js)を持っています。
import express from 'express';
import jwt from 'jsonwebtoken';
import pino from 'pino';
import { chaos, chaosMiddleware, leakedMb, updateChaos } from './chaos.js';
import { initDatabase, pool, verifyPassword } from './db.js';
import { metricsMiddleware, register } from './metrics.js';

// ログは JSON で標準出力へ。Docker がそれを受け取り、Alloy が Loki へ運びます。
const log = pino({ level: process.env.LOG_LEVEL ?? 'info', base: { service: 'api' } });

const PORT = Number(process.env.PORT ?? 3001);
// JWT に署名する鍵です。ラボ用の固定値なので、本番では必ず秘密の値を環境変数で渡します。
const JWT_SECRET = process.env.JWT_SECRET ?? 'lab-only-not-a-real-secret';
const JWT_TTL_SECONDS = 15 * 60; // 有効期限 15 分

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', true); // edge(nginx)の後ろにいるので、X-Forwarded-For を信じます
app.use(express.json({ limit: '100kb' }));

// リクエストごとに 1 行のアクセスログを出します。
app.use((req, res, next) => {
  const started = process.hrtime.bigint();
  req.log = log.child({ reqId: req.get('x-request-id') ?? undefined });
  res.on('finish', () => {
    if (req.path === '/metrics' || req.path === '/healthz' || req.path === '/readyz') return; // 収集の定期アクセスはうるさいので省きます
    const durationMs = Number(process.hrtime.bigint() - started) / 1e6;
    const route = req.route ? `${req.baseUrl}${req.route.path}` : 'unmatched';
    const level = res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info';
    req.log[level](
      { method: req.method, path: req.originalUrl, route, status: res.statusCode, durationMs: Math.round(durationMs), ip: req.ip },
      'request',
    );
  });
  next();
});
app.use(metricsMiddleware);

// ---------- 見守り用 ----------

// 生きているか(プロセスが応答できるか)。DB は見ません。
app.get('/healthz', (req, res) => {
  res.json({ status: 'ok' });
});

// 準備できているか(DB に届くか)。届かなければ 503 を返し、振り分け先から外してもらいます。
app.get('/readyz', async (req, res) => {
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

// ---------- 認証 ----------

function signToken(user) {
  return jwt.sign({ sub: String(user.id), username: user.username }, JWT_SECRET, {
    algorithm: 'HS256',
    expiresIn: JWT_TTL_SECONDS,
  });
}

// Authorization: Bearer <JWT> を確かめます。無い・壊れている・期限切れなら 401。
function requireAuth(req, res, next) {
  const header = req.get('authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) {
    res.status(401).json({ error: 'unauthorized', message: 'ログインが必要です' });
    return;
  }
  try {
    const payload = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] });
    req.user = { id: Number(payload.sub), username: payload.username };
    next();
  } catch {
    res.status(401).json({ error: 'unauthorized', message: 'トークンが無効か、期限切れです' });
  }
}

// ---------- 商品 ----------

const PRODUCT_COLUMNS = 'id, name, description, category, price, stock';

// GET /api/products?q=検索語
app.get('/api/products', chaosMiddleware, async (req, res) => {
  const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  let result;
  if (!q) {
    result = await pool.query(`SELECT ${PRODUCT_COLUMNS} FROM products ORDER BY id`);
  } else if (chaos.sqliBug) {
    // 【わざと危険な書き方】検索語をそのまま SQL の文字列に連結しています。
    // q に ' OR '1'='1 などを入れると、SQL の意味そのものが書き換わります(SQL インジェクション)。
    const sql = `SELECT ${PRODUCT_COLUMNS} FROM products WHERE name ILIKE '%${q}%' ORDER BY id`;
    req.log.warn({ chaos: 'sqliBug', sql }, 'chaos: 文字列連結の SQL を実行します');
    result = await pool.query(sql);
  } else {
    // 正しい書き方: 値は $1 の「置き場所」に入れて渡します(プレースホルダ)。SQL の意味は変わりません。
    result = await pool.query(`SELECT ${PRODUCT_COLUMNS} FROM products WHERE name ILIKE $1 ORDER BY id`, [`%${q}%`]);
  }
  // 一覧は配列のまま返します(web の画面がこの形を前提にしています)。
  res.json(result.rows);
});

// GET /api/products/:id
app.get('/api/products/:id', chaosMiddleware, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: 'bad_request', message: '商品 ID は正の整数です' });
    return;
  }
  const { rows } = await pool.query(`SELECT ${PRODUCT_COLUMNS} FROM products WHERE id = $1`, [id]);
  if (rows.length === 0) {
    res.status(404).json({ error: 'not_found', message: '商品が見つかりません' });
    return;
  }
  res.json(rows[0]);
});

// ---------- ログイン ----------

// POST /api/login { "username": "alice", "password": "password" }
// 何度失敗してもロックはしません(回数の制限は edge のレート制限で見せるため)。
app.post('/api/login', chaosMiddleware, async (req, res) => {
  const { username, password } = req.body ?? {};
  if (typeof username !== 'string' || typeof password !== 'string') {
    res.status(400).json({ error: 'bad_request', message: 'username と password を送ってください' });
    return;
  }
  const { rows } = await pool.query('SELECT id, username, display_name, password_hash FROM users WHERE username = $1', [
    username,
  ]);
  const user = rows[0];
  if (!user || !verifyPassword(password, user.password_hash)) {
    req.log.warn({ username }, 'ログイン失敗');
    res.status(401).json({ error: 'invalid_credentials', message: '会員名かパスワードが違います' });
    return;
  }
  res.json({
    token: signToken(user),
    tokenType: 'Bearer',
    expiresIn: JWT_TTL_SECONDS,
    user: { id: user.id, username: user.username, displayName: user.display_name },
  });
});

// ---------- 注文 ----------

async function loadOrder(orderId) {
  const { rows } = await pool.query(
    `SELECT o.id, o.user_id, u.username, o.status, o.total, o.created_at
       FROM orders o JOIN users u ON u.id = o.user_id WHERE o.id = $1`,
    [orderId],
  );
  if (rows.length === 0) return null;
  const items = await pool.query(
    `SELECT i.product_id AS "productId", p.name, i.quantity AS qty, i.unit_price AS price
       FROM order_items i JOIN products p ON p.id = i.product_id WHERE i.order_id = $1 ORDER BY i.product_id`,
    [orderId],
  );
  const o = rows[0];
  return {
    id: o.id,
    userId: o.user_id,
    username: o.username,
    status: o.status,
    total: o.total,
    createdAt: o.created_at,
    items: items.rows,
  };
}

// GET /api/me/orders(自分の注文一覧。JWT 必須)
app.get('/api/me/orders', chaosMiddleware, requireAuth, async (req, res) => {
  const { rows } = await pool.query('SELECT id FROM orders WHERE user_id = $1 ORDER BY created_at DESC', [req.user.id]);
  const items = [];
  for (const row of rows) items.push(await loadOrder(row.id));
  res.json(items);
});

// GET /api/orders/:orderId(注文詳細。JWT 必須)
app.get('/api/orders/:orderId', chaosMiddleware, requireAuth, async (req, res) => {
  const orderId = Number(req.params.orderId);
  if (!Number.isInteger(orderId) || orderId <= 0) {
    res.status(400).json({ error: 'bad_request', message: '注文 ID は正の整数です' });
    return;
  }
  const order = await loadOrder(orderId);
  if (!order) {
    res.status(404).json({ error: 'not_found', message: '注文が見つかりません' });
    return;
  }
  if (chaos.idorBug) {
    // 【わざと危険な書き方】ログインしているかは見るが、「その注文の持ち主か」を確かめていません。
    // 注文 ID を 1 つずつ変えるだけで、他人の注文(住所や買った物)が見えてしまいます(IDOR)。
    if (order.userId !== req.user.id) {
      req.log.warn({ chaos: 'idorBug', viewer: req.user.username, owner: order.username, orderId }, 'chaos: 他人の注文を返します');
    }
  } else if (order.userId !== req.user.id) {
    // 正しい書き方: 持ち主でなければ「存在しない」と同じ 404 を返します(他人の注文があること自体を教えない)。
    res.status(404).json({ error: 'not_found', message: '注文が見つかりません' });
    return;
  }
  res.json(order);
});

// ---------- 管理(カオススイッチ) ----------
// /admin/* は edge で社内(ラボでは Docker の内部ネットワーク)からだけ通すようにしています。

app.get('/admin/chaos', (req, res) => {
  res.json({ ...chaos, leakedMb: Math.round(leakedMb()) });
});

// POST /admin/chaos { "latencyMs": 1500 } のように、変えたいものだけ送ります。{ "reset": true } で全部元に戻します。
app.post('/admin/chaos', (req, res) => {
  const { errors } = updateChaos(req.body);
  if (errors.length > 0) {
    res.status(400).json({ error: 'bad_request', messages: errors });
    return;
  }
  req.log.warn({ chaos: { ...chaos } }, 'カオススイッチを変更しました');
  res.json({ ...chaos, leakedMb: Math.round(leakedMb()) });
});

// ---------- 最後の受け皿 ----------

app.use((req, res) => {
  res.status(404).json({ error: 'not_found', message: 'そのパスはありません' });
});

// Express 5 では async の関数で投げた例外もここに届きます。中身(SQL など)は外に見せません。
app.use((err, req, res, _next) => {
  if (err.type === 'entity.parse.failed') {
    res.status(400).json({ error: 'bad_request', message: 'JSON の形が正しくありません' });
    return;
  }
  req.log.error({ err: { message: err.message, code: err.code } }, 'エラーが起きました');
  res.status(500).json({ error: 'internal_error', message: 'サーバーでエラーが起きました' });
});

// ---------- 起動 ----------

async function waitForDatabase() {
  // DB がまだ起動中のことがあるので、つながるまで少し待ってから初期化します。
  for (let attempt = 1; ; attempt++) {
    try {
      await initDatabase(log);
      return;
    } catch (err) {
      if (attempt >= 30) throw err;
      log.warn({ attempt, err: err.message }, 'DB を待っています');
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }
}

await waitForDatabase();
const server = app.listen(PORT, () => {
  log.info({ port: PORT, chaos }, 'api を起動しました');
});

// docker compose stop などで止めるとき、受付中のリクエストを片付けてから終わります(穏やかな停止)。
for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => {
    log.info({ signal }, '停止します');
    server.close(() => pool.end().finally(() => process.exit(0)));
    setTimeout(() => process.exit(0), 10_000).unref();
  });
}
