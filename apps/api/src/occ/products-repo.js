// 商品を DB から読むところです(検索以外)。
'use strict';

const { pool } = require('../db');

const COLUMNS = `p.code, p.name, p.summary, p.description, p.price, p.stock, p.classifications,
  p.category_code, c.name AS category_name`;
const FROM = 'FROM products p JOIN categories c ON c.code = p.category_code';

async function findProduct(code) {
  const { rows } = await pool.query(`SELECT ${COLUMNS} ${FROM} WHERE p.code = $1`, [code]);
  return rows[0] ?? null;
}

// 指定した順番を保ったまま、何件かまとめて読みます。
async function findProducts(codes) {
  if (codes.length === 0) return [];
  const { rows } = await pool.query(`SELECT ${COLUMNS} ${FROM} WHERE p.code = ANY($1)`, [codes]);
  const byCode = new Map(rows.map((r) => [r.code, r]));
  return codes.map((c) => byCode.get(c)).filter(Boolean);
}

async function findCategory(code) {
  const { rows } = await pool.query('SELECT code, name, description FROM categories WHERE code = $1', [code]);
  return rows[0] ?? null;
}

async function productCodesInCategory(categoryCode, { exclude = null, limit = 50 } = {}) {
  const { rows } = await pool.query(
    'SELECT code FROM products WHERE category_code = $1 AND code IS DISTINCT FROM $2 ORDER BY code LIMIT $3',
    [categoryCode, exclude, limit],
  );
  return rows.map((r) => r.code);
}

module.exports = { COLUMNS, FROM, findProduct, findProducts, findCategory, productCodesInCategory };
