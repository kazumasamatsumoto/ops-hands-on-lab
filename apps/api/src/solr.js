// Solr(検索サーバー)と HTTP で話すところです。専用のライブラリは使わず、Node の fetch だけで書いています。
// 「検索サーバーも、結局は HTTP で JSON をやり取りしているだけ」と見えるようにするためです。
//
// Solr = 全文検索のための別のサーバー。DB の「LIKE で 1 行ずつ探す」代わりに、
// あらかじめ「索引(インデックス)」を作っておき、そこを引いて速く探します。
// たとえ: 本の最後の「索引」。本文を 1 ページずつめくる(DB の LIKE)代わりに、索引で何ページかをすぐ見つけます。
// 索引は自動では新しくなりません。worker の searchIndexJob が 60 秒ごとに作り直します
// (だから、管理画面で価格を変えても、検索結果に出るまで少し遅れます)。
// CCv2 では、Solr は SAP が用意し、索引の作り直しは backgroundProcessing aspect のジョブが行います。
'use strict';

const SOLR_URL = (process.env.SOLR_URL ?? 'http://search:8983/solr/products').replace(/\/+$/, '');
const SOLR_TIMEOUT_MS = Number(process.env.SOLR_TIMEOUT_MS ?? 2000);

class SolrUnavailableError extends Error {}

async function solrFetch(path, init = {}) {
  const url = `${SOLR_URL}${path}`;
  let res;
  try {
    res = await fetch(url, { ...init, signal: AbortSignal.timeout(SOLR_TIMEOUT_MS) });
  } catch (err) {
    // つながらない・名前が引けない・時間切れ など。
    throw new SolrUnavailableError(`Solr に届きません (${SOLR_URL}): ${err.cause?.code ?? err.name}: ${err.message}`);
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new SolrUnavailableError(`Solr がエラーを返しました (${res.status}): ${body.slice(0, 300)}`);
  }
  return res.json();
}

// Solr の検索文法で特別な意味を持つ文字を無効にします(利用者の入力をそのまま「命令」として扱わないため)。
function escapeQuery(text) {
  return text.replace(/([+\-!(){}[\]^"~*?:\\/]|&&|\|\|)/g, '\\$1');
}

const SORTS = {
  relevance: 'score desc,code asc',
  'price-asc': 'price asc,code asc',
  'price-desc': 'price desc,code asc',
  'name-asc': 'name_sort asc,code asc',
};

async function search({ text, start, rows, sort }) {
  const params = new URLSearchParams({
    q: text ? escapeQuery(text) : '*:*',
    defType: 'edismax',
    // どの項目を探すか。name^3 は「名前で当たったら 3 倍重く見る」という意味です。
    qf: 'name^3 summary category_name',
    // 言葉が複数あるとき、すべてを含むものだけ(AND)にします。
    mm: '100%',
    start: String(start),
    rows: String(rows),
    sort: SORTS[sort] ?? SORTS.relevance,
    fl: 'code,name,summary,price,stock,category_code,category_name',
    wt: 'json',
  });
  const json = await solrFetch(`/select?${params}`);
  return { total: json.response.numFound, docs: json.response.docs };
}

// 索引を全部作り直します(worker の searchIndexJob から呼びます)。
// 1) 全件削除を送る(まだ確定しない) 2) 全件を送って確定(commit)。確定するまでは古い索引で検索できるので、途中で空になりません。
async function reindex(products) {
  await solrFetch('/update?commit=false', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ delete: { query: '*:*' } }),
  });
  const docs = products.map((p) => ({
    code: p.code,
    name: p.name,
    summary: p.summary,
    price: p.price,
    stock: p.stock,
    category_code: p.category_code,
    category_name: p.category_name,
  }));
  await solrFetch('/update?commit=true', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(docs),
  });
  return docs.length;
}

module.exports = { SOLR_URL, SolrUnavailableError, search, reindex };
