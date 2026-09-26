// 注文(ログインした人だけ)。
//   GET /occ/v2/samplestore/users/current/orders        自分の注文の一覧
//   GET /occ/v2/samplestore/users/current/orders/{code} 注文 1 件(自分の注文でなければ 404)
// 「current」= トークンの持ち主のこと。URL に会員 ID を書かせず、トークンから本人を決めるのが安全な形です。
'use strict';

const { pool } = require('../db');
const { chaos } = require('../chaos');
const { sendError } = require('../http-common');
const { STATUS_DISPLAY } = require('../seed-data');
const format = require('./format');

async function loadOrders(where, params) {
  const orders = await pool.query(
    `SELECT o.code, o.user_id, u.uid, u.name AS user_name, o.status, o.total, o.placed
       FROM orders o JOIN users u ON u.id = o.user_id WHERE ${where} ORDER BY o.placed DESC`,
    params,
  );
  if (orders.rows.length === 0) return [];
  const entries = await pool.query(
    `SELECT e.order_code, e.entry_number, e.product_code, p.name, e.quantity, e.base_price
       FROM order_entries e JOIN products p ON p.code = e.product_code
      WHERE e.order_code = ANY($1) ORDER BY e.order_code, e.entry_number`,
    [orders.rows.map((o) => o.code)],
  );
  return orders.rows.map((o) => ({
    code: o.code,
    placed: o.placed.toISOString(),
    status: o.status,
    statusDisplay: STATUS_DISPLAY[o.status] ?? o.status,
    total: format.price(o.total),
    user: { uid: o.uid, name: o.user_name },
    userId: o.user_id,
    entries: entries.rows
      .filter((e) => e.order_code === o.code)
      .map((e) => ({
        entryNumber: e.entry_number,
        product: { code: e.product_code, name: e.name, url: `/p/${e.product_code}` },
        quantity: e.quantity,
        basePrice: format.price(e.base_price),
        totalPrice: format.price(e.base_price * e.quantity),
      })),
  }));
}

const publicOrder = ({ userId, ...rest }) => rest;

async function listHandler(req, res) {
  const orders = await loadOrders('o.user_id = $1', [req.user.id]);
  res.set('Cache-Control', 'no-store');
  res.json({
    orders: orders.map(publicOrder),
    pagination: { currentPage: 0, pageSize: orders.length, totalPages: 1, totalResults: orders.length },
  });
}

async function detailHandler(req, res) {
  res.set('Cache-Control', 'no-store');
  const [order] = await loadOrders('o.code = $1', [String(req.params.code)]);
  if (!order) return sendError(res, 404, 'UnknownIdentifierError', '注文が見つかりません');
  if (chaos.idorBug) {
    // 【わざと危険な書き方】ログインしているかは見るが、「その注文の持ち主か」を確かめていません。
    // 注文番号を 1 つずつ変えるだけで、他人の注文(買った物など)が見えてしまいます(IDOR)。
    if (order.userId !== req.user.id) {
      req.log.warn({ chaos: 'idorBug', viewer: req.user.uid, owner: order.user.uid, order: order.code }, 'chaos: 他人の注文を返します');
    }
  } else if (order.userId !== req.user.id) {
    // 正しい書き方: 持ち主でなければ「存在しない」と同じ 404 を返します(他人の注文があること自体を教えない)。
    return sendError(res, 404, 'UnknownIdentifierError', '注文が見つかりません');
  }
  res.json(publicOrder(order));
}

module.exports = { listHandler, detailHandler };
