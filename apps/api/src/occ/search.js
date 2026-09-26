// GET /occ/v2/samplestore/products/search
// 検索の実体は SEARCH_PROVIDER で切り替えます。
//   db   : PostgreSQL の ILIKE(部分一致)で探す。軽量版の既定。
//   solr : Solr の索引を引く。本格版。索引は worker が 60 秒ごとに作り直す。
// どちらでも、返す JSON の形は同じです(storefront は、裏がどちらかを知らなくてよい)。
'use strict';

const { pool } = require('../db');
const { chaos } = require('../chaos');
const solr = require('../solr');
const { searchRequestsTotal } = require('../metrics');
const { COLUMNS, FROM, findProducts } = require('./products-repo');
const format = require('./format');

const PROVIDER = (process.env.SEARCH_PROVIDER ?? 'db').toLowerCase() === 'solr' ? 'solr' : 'db';

const SORT_NAMES = [
  ['relevance', 'おすすめ順'],
  ['price-asc', '価格の安い順'],
  ['price-desc', '価格の高い順'],
  ['name-asc', '名前順'],
];

// query は OCC と同じく「言葉:並び順:...」の形でも受けます(例: ペン:relevance)。先頭の言葉だけを使います。
function parseQuery(raw) {
  const q = typeof raw === 'string' ? raw : '';
  const m = q.match(/^(.*?):(relevance|price-asc|price-desc|name-asc)(:.*)?$/);
  return m ? { text: m[1].trim(), sortFromQuery: m[2] } : { text: q.trim(), sortFromQuery: null };
}

// LIKE で特別な意味を持つ % と _ を、ただの文字として扱わせます。
const likeEscape = (s) => s.replace(/[\\%_]/g, '\\$&');

const DB_ORDER = {
  relevance: 'p.code',
  'price-asc': 'p.price, p.code',
  'price-desc': 'p.price DESC, p.code',
  'name-asc': 'p.name, p.code',
};

async function searchDb({ text, start, rows, sort }, log) {
  if (chaos.sqliBug && text) {
    // 【わざと危険な書き方】検索語をそのまま SQL の文字列に連結しています。
    // query に ' OR '1'='1 などを入れると、SQL の意味そのものが書き換わります(SQL インジェクション)。
    const where = `WHERE p.name ILIKE '%${text}%'`;
    const sql = `SELECT ${COLUMNS} ${FROM} ${where} ORDER BY ${DB_ORDER[sort]} LIMIT ${rows} OFFSET ${start}`;
    log.warn({ chaos: 'sqliBug', sql }, 'chaos: 文字列連結の SQL を実行します');
    const count = await pool.query(`SELECT count(*)::int AS n ${FROM} ${where}`);
    const result = await pool.query(sql);
    return { total: count.rows[0].n, docs: result.rows };
  }
  // 正しい書き方: 値は $1 の「置き場所」に入れて渡します(プレースホルダ)。SQL の意味は変わりません。
  // 言葉が複数(空白区切り)なら、すべてを含むもの(AND)。名前・短い説明・分類名のどれかに含まれれば当たり。
  const terms = text.split(/\s+/).filter(Boolean).slice(0, 5);
  const params = terms.map((t) => `%${likeEscape(t)}%`);
  const where = terms.length
    ? 'WHERE ' + terms.map((_, i) => `(p.name ILIKE $${i + 1} OR p.summary ILIKE $${i + 1} OR c.name ILIKE $${i + 1})`).join(' AND ')
    : '';
  const count = await pool.query(`SELECT count(*)::int AS n ${FROM} ${where}`, params);
  const result = await pool.query(
    `SELECT ${COLUMNS} ${FROM} ${where} ORDER BY ${DB_ORDER[sort]} LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, rows, start],
  );
  return { total: count.rows[0].n, docs: result.rows };
}

async function searchHandler(req, res) {
  const level = format.fieldsLevel(req.query.fields);
  const { text, sortFromQuery } = parseQuery(req.query.query);
  const pageSize = Math.min(Math.max(parseInt(req.query.pageSize, 10) || 20, 1), 100);
  const currentPage = Math.max(parseInt(req.query.currentPage, 10) || 0, 0);
  const sortParam = String(req.query.sort ?? sortFromQuery ?? 'relevance');
  const sort = SORT_NAMES.some(([code]) => code === sortParam) ? sortParam : 'relevance';
  const q = { text, start: currentPage * pageSize, rows: pageSize, sort };

  // sqliBug は「検索の query に効く」スイッチなので、solr のときでも DB の危ない書き方を通します(演習がどちらの版でもできるように)。
  const provider = chaos.sqliBug && text ? 'db' : PROVIDER;
  let found;
  try {
    found = provider === 'solr' ? await solr.search(q) : await searchDb(q, req.log);
    searchRequestsTotal.inc({ provider, result: 'ok' });
  } catch (err) {
    searchRequestsTotal.inc({ provider, result: 'error' });
    if (err instanceof solr.SolrUnavailableError) {
      req.log.error({ provider, err: err.message }, '検索サーバーに届かないため、検索を 503 にします');
      res.status(503).json({
        errors: [{ type: 'SearchUnavailableError', message: '検索サーバー(Solr)に届かないため、いまは検索できません。しばらくしてからもう一度お試しください。' }],
      });
      return;
    }
    throw err;
  }

  // Solr の索引には FULL の項目(長い説明など)を入れていないので、FULL のときだけ DB から読み足します。
  let docs = found.docs;
  if (level === 'FULL' && provider === 'solr') {
    docs = await findProducts(docs.map((d) => d.code));
  }

  res.set('X-Search-Provider', provider);
  res.json({
    freeTextSearch: text,
    products: docs.map((row) => format.product(row, level)),
    pagination: {
      currentPage,
      pageSize,
      totalPages: Math.ceil(found.total / pageSize),
      totalResults: found.total,
      sort,
    },
    sorts: SORT_NAMES.map(([code, name]) => ({ code, name, selected: code === sort })),
  });
}

module.exports = { searchHandler, PROVIDER };
