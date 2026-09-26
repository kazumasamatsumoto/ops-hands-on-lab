// データベース(PostgreSQL)への接続と、起動時のテーブル作成・見本データ投入です。
// 表を作るのは ASPECT=api のときだけです。backoffice と worker は、表ができるまで待ちます
// (CCv2 でも、DB の初期化・更新はデプロイのときに一度だけ行い、各 aspect はそれを使うだけです)。
'use strict';

const crypto = require('node:crypto');
const pg = require('pg');
const { log } = require('./log');
const seed = require('./seed-data');

const pool = new pg.Pool({
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
  log.error({ err: err.message }, 'DB との接続が切れました');
});

// パスワードはそのまま保存せず、scrypt(わざと計算に時間がかかるハッシュ)で変換して保存します。
function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(password, salt, 32).toString('hex');
  return `scrypt$${salt}$${hash}`;
}

function verifyPassword(password, stored) {
  const [scheme, salt, hash] = String(stored).split('$');
  if (scheme !== 'scrypt' || !salt || !hash) return false;
  const candidate = crypto.scryptSync(password, salt, 32);
  const expected = Buffer.from(hash, 'hex');
  return candidate.length === expected.length && crypto.timingSafeEqual(candidate, expected);
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS categories (
  code        TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  description TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS products (
  code            TEXT PRIMARY KEY,          -- 商品コード(例: 100001)
  name            TEXT NOT NULL,
  summary         TEXT NOT NULL,             -- 一覧に出す短い説明
  description     TEXT NOT NULL,             -- 詳細に出す長い説明(fields=FULL のときだけ返す)
  category_code   TEXT NOT NULL REFERENCES categories(code),
  price           INTEGER NOT NULL,          -- 円(税込)
  stock           INTEGER NOT NULL,
  classifications JSONB NOT NULL DEFAULT '[]',
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,
  uid           TEXT NOT NULL UNIQUE,        -- ログイン名(alice など)
  name          TEXT NOT NULL,
  password_hash TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS orders (
  code    TEXT PRIMARY KEY,                  -- 注文番号(例: 00001001)
  user_id INTEGER NOT NULL REFERENCES users(id),
  status  TEXT NOT NULL,
  total   INTEGER NOT NULL,
  placed  TIMESTAMPTZ NOT NULL
);
CREATE TABLE IF NOT EXISTS order_entries (
  order_code   TEXT NOT NULL REFERENCES orders(code) ON DELETE CASCADE,
  entry_number INTEGER NOT NULL,
  product_code TEXT NOT NULL REFERENCES products(code),
  quantity     INTEGER NOT NULL,
  base_price   INTEGER NOT NULL,
  PRIMARY KEY (order_code, entry_number)
);
-- OAuth のアクセストークン。トークンそのものではなく、SHA-256 の値だけを保存します(DB が漏れても使えないように)。
-- DB に置くので、api を何台に増やしても、どの台でも同じトークンが通ります。
CREATE TABLE IF NOT EXISTS oauth_access_tokens (
  token_hash TEXT PRIMARY KEY,
  client_id  TEXT NOT NULL,
  user_id    INTEGER NOT NULL REFERENCES users(id),
  expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS oauth_access_tokens_expires ON oauth_access_tokens (expires_at);
CREATE TABLE IF NOT EXISTS cms_pages (
  uid       TEXT PRIMARY KEY,
  label     TEXT,
  page_type TEXT NOT NULL,
  name      TEXT NOT NULL,
  template  TEXT NOT NULL,
  title     TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS cms_components (
  uid        TEXT PRIMARY KEY,
  type_code  TEXT NOT NULL,
  name       TEXT NOT NULL,
  attrs      JSONB NOT NULL DEFAULT '{}',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS cms_slots (
  page_uid TEXT NOT NULL REFERENCES cms_pages(uid) ON DELETE CASCADE,
  slot_id  TEXT NOT NULL,
  position TEXT NOT NULL,
  sort     INTEGER NOT NULL,
  PRIMARY KEY (page_uid, slot_id)
);
CREATE TABLE IF NOT EXISTS cms_slot_components (
  page_uid      TEXT NOT NULL,
  slot_id       TEXT NOT NULL,
  sort          INTEGER NOT NULL,
  component_uid TEXT NOT NULL REFERENCES cms_components(uid),
  PRIMARY KEY (page_uid, slot_id, sort),
  FOREIGN KEY (page_uid, slot_id) REFERENCES cms_slots(page_uid, slot_id) ON DELETE CASCADE
);
-- 管理画面(backoffice)のログイン状態。DB に置くので backoffice を何台にしても同じように使えます。
CREATE TABLE IF NOT EXISTS backoffice_sessions (
  id         TEXT PRIMARY KEY,
  csrf       TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL
);
`;

// 第 1 版の表(products に code 列が無い)が残っていたら消します。`docker compose down` で -v を付け忘れても動くように。
async function dropFirstEditionTables(client) {
  const { rows } = await client.query(
    `SELECT
       EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'products') AS has_products,
       EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'products' AND column_name = 'code') AS has_code`,
  );
  if (rows[0].has_products && !rows[0].has_code) {
    log.warn('第 1 版の表が残っていたので作り直します');
    await client.query('DROP TABLE IF EXISTS order_items, orders, users, products CASCADE');
  }
}

async function insertSeed(client) {
  for (const [code, name, description] of seed.CATEGORIES) {
    await client.query('INSERT INTO categories (code, name, description) VALUES ($1, $2, $3)', [code, name, description]);
  }
  const categoryName = new Map(seed.CATEGORIES.map(([code, name]) => [code, name]));
  for (const [i, [name, category, price, summary, material, size]] of seed.PRODUCTS.entries()) {
    const description =
      `${summary}\n` +
      `${categoryName.get(category)}の定番として、サンプル株式会社が選んだ商品です。` +
      `素材は${material}、大きさは${size}です。` +
      'お届けは注文の 2〜4 日後です。これは体験ラボ用の架空の商品で、実際には販売していません。';
    const classifications = [
      {
        code: 'basic',
        name: '基本の仕様',
        features: [
          { code: 'material', name: '素材', featureValues: [{ value: material }] },
          { code: 'size', name: '大きさ', featureValues: [{ value: size }] },
          { code: 'origin', name: '企画', featureValues: [{ value: 'サンプル株式会社' }] },
        ],
      },
    ];
    await client.query(
      `INSERT INTO products (code, name, summary, description, category_code, price, stock, classifications)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [seed.productCode(i + 1), name, summary, description, category, price, (i * 7) % 40, JSON.stringify(classifications)],
    );
  }
  // 見本の会員はパスワードがすべて "password" です(ラボ専用。本番では絶対にしません)。
  for (const [uid, name] of seed.USERS) {
    await client.query('INSERT INTO users (uid, name, password_hash) VALUES ($1, $2, $3)', [uid, name, hashPassword('password')]);
  }
  for (const [n, [uid, items, status, daysAgo]] of seed.ORDERS.entries()) {
    const code = String(1001 + n).padStart(8, '0');
    const codes = items.map(([p]) => seed.productCode(p));
    const prices = await client.query('SELECT code, price FROM products WHERE code = ANY($1)', [codes]);
    const priceOf = new Map(prices.rows.map((r) => [r.code, r.price]));
    const total = items.reduce((sum, [p, qty]) => sum + priceOf.get(seed.productCode(p)) * qty, 0);
    await client.query(
      `INSERT INTO orders (code, user_id, status, total, placed)
       VALUES ($1, (SELECT id FROM users WHERE uid = $2), $3, $4, now() - make_interval(days => $5))`,
      [code, uid, status, total, daysAgo],
    );
    for (const [entry, [p, qty]] of items.entries()) {
      await client.query(
        'INSERT INTO order_entries (order_code, entry_number, product_code, quantity, base_price) VALUES ($1, $2, $3, $4, $5)',
        [code, entry, seed.productCode(p), qty, priceOf.get(seed.productCode(p))],
      );
    }
  }
  for (const [uid, typeCode, name, attrs] of seed.COMPONENTS) {
    await client.query('INSERT INTO cms_components (uid, type_code, name, attrs) VALUES ($1, $2, $3, $4)', [
      uid,
      typeCode,
      name,
      JSON.stringify(attrs),
    ]);
  }
  for (const [uid, label, pageType, name, template, title, slots] of seed.PAGES) {
    await client.query('INSERT INTO cms_pages (uid, label, page_type, name, template, title) VALUES ($1, $2, $3, $4, $5, $6)', [
      uid,
      label,
      pageType,
      name,
      template,
      title,
    ]);
    for (const [s, [slotId, position, components]] of slots.entries()) {
      await client.query('INSERT INTO cms_slots (page_uid, slot_id, position, sort) VALUES ($1, $2, $3, $4)', [uid, slotId, position, s]);
      for (const [c, componentUid] of components.entries()) {
        await client.query('INSERT INTO cms_slot_components (page_uid, slot_id, sort, component_uid) VALUES ($1, $2, $3, $4)', [
          uid,
          slotId,
          c,
          componentUid,
        ]);
      }
    }
  }
}

// テーブルを作り、空なら見本データを入れます。何度実行しても同じ結果になるように作っています。
async function initDatabase() {
  const client = await pool.connect();
  try {
    // 複数の api が同時に起動しても 1 つだけが初期化するよう、アドバイザリロック(合図の旗)を取ります。
    await client.query('SELECT pg_advisory_lock(424242)');
    await dropFirstEditionTables(client);
    await client.query(SCHEMA);
    const { rows } = await client.query('SELECT count(*)::int AS n FROM products');
    if (rows[0].n > 0) {
      log.info({ products: rows[0].n }, 'DB はすでに初期化済みです');
      return;
    }
    await client.query('BEGIN');
    await insertSeed(client);
    await client.query('COMMIT');
    log.info(
      { products: seed.PRODUCTS.length, users: seed.USERS.length, orders: seed.ORDERS.length, cmsPages: seed.PAGES.length },
      '見本データを入れました',
    );
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    await client.query('SELECT pg_advisory_unlock(424242)').catch(() => {});
    client.release();
  }
}

// api 以外の aspect 用: api が表を作り終えるまで待ちます(最後に入れる表 cms_slot_components を目印にします)。
async function schemaReady() {
  const { rows } = await pool.query(
    `SELECT to_regclass('public.backoffice_sessions') IS NOT NULL AS ok,
            (SELECT count(*) FROM information_schema.tables WHERE table_name = 'cms_slot_components') > 0 AS cms`,
  );
  if (!rows[0].ok || !rows[0].cms) return false;
  const seeded = await pool.query('SELECT count(*)::int AS n FROM cms_slot_components');
  return seeded.rows[0].n > 0;
}

// DB を待つ(api は初期化まで、他は表ができるまで)。最大およそ 2 分。
async function waitForDatabase(aspect) {
  for (let attempt = 1; ; attempt++) {
    try {
      if (aspect === 'api') {
        await initDatabase();
        return;
      }
      if (await schemaReady()) return;
      throw new Error('api がまだ表を作っていません');
    } catch (err) {
      if (attempt >= 60) throw err;
      log.warn({ attempt, err: err.message }, 'DB の準備を待っています');
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }
}

module.exports = { pool, hashPassword, verifyPassword, initDatabase, waitForDatabase };
