// データベース(PostgreSQL)への接続と、起動時のテーブル作成・見本データ投入です。
import crypto from 'node:crypto';
import pg from 'pg';

export const pool = new pg.Pool({
  host: process.env.PGHOST ?? 'db',
  port: Number(process.env.PGPORT ?? 5432),
  user: process.env.PGUSER ?? 'store',
  password: process.env.PGPASSWORD ?? 'store',
  database: process.env.PGDATABASE ?? 'store',
  max: Number(process.env.PG_POOL_MAX ?? 10),
  // 接続を待つのは 3 秒まで。DB が止まったときに API が固まり続けないようにします。
  connectionTimeoutMillis: 3000,
  statement_timeout: 5000,
});

// 待機中の接続が DB 側から切られたとき(DB の停止・再起動など)の知らせです。
// これを受け取らないと Node.js は「誰も受け取らないエラー」としてプロセスごと落ちてしまいます。
// 受け取ってログに残すだけにし、次のリクエストで接続を作り直させます(DB が戻れば /readyz も自然に 200 に戻ります)。
pool.on('error', (err) => {
  console.error(JSON.stringify({ level: 50, service: 'api', msg: 'DB との接続が切れました', err: err.message }));
});

// パスワードはそのまま保存せず、scrypt(わざと計算に時間がかかるハッシュ)で変換して保存します。
export function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(password, salt, 32).toString('hex');
  return `scrypt$${salt}$${hash}`;
}

export function verifyPassword(password, stored) {
  const [scheme, salt, hash] = String(stored).split('$');
  if (scheme !== 'scrypt' || !salt || !hash) return false;
  const candidate = crypto.scryptSync(password, salt, 32);
  const expected = Buffer.from(hash, 'hex');
  return candidate.length === expected.length && crypto.timingSafeEqual(candidate, expected);
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS products (
  id          SERIAL PRIMARY KEY,
  name        TEXT NOT NULL,
  description TEXT NOT NULL,
  category    TEXT NOT NULL,
  price       INTEGER NOT NULL,       -- 円(税込)
  stock       INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,
  username      TEXT NOT NULL UNIQUE,
  display_name  TEXT NOT NULL,
  password_hash TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS orders (
  id         SERIAL PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id),
  status     TEXT NOT NULL,
  total      INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL
);
CREATE TABLE IF NOT EXISTS order_items (
  order_id   INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES products(id),
  quantity   INTEGER NOT NULL,
  unit_price INTEGER NOT NULL,
  PRIMARY KEY (order_id, product_id)
);
`;

// 見本の商品 30 件。架空の文房具・生活雑貨です。
const PRODUCT_NAMES = [
  ['ノート A5 方眼', '文房具', 330],
  ['ノート B5 横罫', '文房具', 280],
  ['ゲルインクボールペン 0.5 黒', '文房具', 165],
  ['ゲルインクボールペン 0.5 赤', '文房具', 165],
  ['シャープペンシル 0.3', '文房具', 550],
  ['消しゴム 小', '文房具', 110],
  ['ふせん 75mm 角', '文房具', 220],
  ['クリアファイル 10 枚', '文房具', 330],
  ['ホチキス 小型', '文房具', 770],
  ['はさみ 事務用', '文房具', 660],
  ['マグカップ 白', 'キッチン', 990],
  ['マグカップ 紺', 'キッチン', 990],
  ['ステンレス水筒 500ml', 'キッチン', 2480],
  ['お弁当箱 2 段', 'キッチン', 1650],
  ['保存容器 3 個組', 'キッチン', 1100],
  ['木のカトラリーセット', 'キッチン', 1320],
  ['ふきん 5 枚組', 'キッチン', 550],
  ['ハンドタオル 無地', '生活雑貨', 440],
  ['バスタオル 厚手', '生活雑貨', 1980],
  ['エコバッグ 折りたたみ', '生活雑貨', 880],
  ['卓上ライト LED', '生活雑貨', 3980],
  ['壁掛け時計 シンプル', '生活雑貨', 2750],
  ['スリッパ 洗える', '生活雑貨', 1210],
  ['収納ボックス 布製', '生活雑貨', 1540],
  ['USB 充電ケーブル 1m', 'デジタル小物', 990],
  ['スマホスタンド', 'デジタル小物', 1100],
  ['ワイヤレスマウス', 'デジタル小物', 2200],
  ['キーボードカバー', 'デジタル小物', 770],
  ['ケーブルまとめバンド 10 本', 'デジタル小物', 330],
  ['ノート PC スタンド', 'デジタル小物', 3300],
];

// 見本の注文。[会員名, [[商品 ID, 個数], ...], 状態, 何日前]
const ORDERS = [
  ['alice', [[1, 2], [3, 5]], '発送済み', 30],
  ['alice', [[11, 1]], '発送済み', 12],
  ['alice', [[21, 1], [25, 2]], '準備中', 1],
  ['bob', [[13, 1]], '発送済み', 20],
  ['bob', [[27, 1], [29, 3]], '準備中', 2],
  ['carol', [[19, 2]], '発送済み', 15],
  ['carol', [[5, 1], [6, 3], [7, 2]], '発送済み', 7],
  ['carol', [[30, 1]], '準備中', 0],
];

const USERS = [
  ['alice', 'アリス'],
  ['bob', 'ボブ'],
  ['carol', 'キャロル'],
];

// テーブルを作り、空なら見本データを入れます。何度実行しても同じ結果になるように作っています。
export async function initDatabase(log) {
  const client = await pool.connect();
  try {
    // 複数の API が同時に起動しても 1 つだけが初期化するよう、アドバイザリロック(合図の旗)を取ります。
    await client.query('SELECT pg_advisory_lock(424242)');
    await client.query(SCHEMA);
    const { rows } = await client.query('SELECT count(*)::int AS n FROM products');
    if (rows[0].n > 0) {
      log.info({ products: rows[0].n }, 'DB はすでに初期化済みです');
      return;
    }
    await client.query('BEGIN');
    for (const [i, [name, category, price]] of PRODUCT_NAMES.entries()) {
      await client.query(
        'INSERT INTO products (name, description, category, price, stock) VALUES ($1, $2, $3, $4, $5)',
        [name, `${name}です。サンプルストアの見本商品です。`, category, price, 10 + ((i * 7) % 40)],
      );
    }
    // 見本の会員はパスワードがすべて "password" です(ラボ専用。本番では絶対にしません)。
    for (const [username, displayName] of USERS) {
      await client.query('INSERT INTO users (username, display_name, password_hash) VALUES ($1, $2, $3)', [
        username,
        displayName,
        hashPassword('password'),
      ]);
    }
    for (const [username, items, status, daysAgo] of ORDERS) {
      const prices = await client.query('SELECT id, price FROM products WHERE id = ANY($1)', [items.map((x) => x[0])]);
      const priceOf = new Map(prices.rows.map((r) => [r.id, r.price]));
      const total = items.reduce((sum, [pid, qty]) => sum + priceOf.get(pid) * qty, 0);
      const order = await client.query(
        `INSERT INTO orders (user_id, status, total, created_at)
         VALUES ((SELECT id FROM users WHERE username = $1), $2, $3, now() - make_interval(days => $4))
         RETURNING id`,
        [username, status, total, daysAgo],
      );
      for (const [pid, qty] of items) {
        await client.query('INSERT INTO order_items (order_id, product_id, quantity, unit_price) VALUES ($1, $2, $3, $4)', [
          order.rows[0].id,
          pid,
          qty,
          priceOf.get(pid),
        ]);
      }
    }
    await client.query('COMMIT');
    log.info({ products: PRODUCT_NAMES.length, users: USERS.length, orders: ORDERS.length }, '見本データを入れました');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    await client.query('SELECT pg_advisory_unlock(424242)').catch(() => {});
    client.release();
  }
}
