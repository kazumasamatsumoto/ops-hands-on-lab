// ASPECT=backoffice — 社内の人が使う管理画面です。CCv2 の backoffice aspect に当たります。
// ingress で社内 IP からだけ届くようにします(外のお客さまには見せない)。
//
// サーバーで HTML を作って返す、昔ながらの画面です(JS のフレームワークは使いません)。
// できること: 商品の価格・在庫の変更、トップのバナーの見出し・本文の変更。
// 変更は api と同じ DB に入るので、storefront にも出ます。ただし cdn-waf がキャッシュしている間は古いまま見えます
// (キャッシュの演習)。SEARCH_PROVIDER=solr のときは、検索結果の価格は worker が索引を作り直すまで古いままです。
//
// 守りのしくみ:
//   - ログイン状態は、推測できない乱数のクッキー(bo_session)で持ち、中身は DB に置きます。
//   - フォームには毎回 CSRF トークン(合言葉)を埋め込み、送られてきたものと照らし合わせます。
//     CSRF = 別のサイトに置かれた罠のフォームから、ログイン中の管理者の権限で勝手に送信させる攻撃。
//     たとえ: 銀行の窓口で、本人が書いた用紙か確かめるための「整理券番号」。罠のサイトはこの番号を知りません。
'use strict';

const crypto = require('node:crypto');
const express = require('express');
const { createApp, finishApp } = require('../http-common');
const { pool } = require('../db');
const { mountChaosAdmin } = require('../chaos');

const ADMIN_USER = 'admin';
// ラボ専用の既定値です。本番では必ずシークレットの置き場所から渡します。
const ADMIN_PASSWORD = process.env.BACKOFFICE_PASSWORD ?? 'admin';
const SESSION_HOURS = 8;
const COOKIE_BASE = 'Path=/backoffice; HttpOnly; SameSite=Strict';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const random = () => crypto.randomBytes(24).toString('base64url');
const yen = new Intl.NumberFormat('ja-JP', { style: 'currency', currency: 'JPY' });

function safeEqual(a, b) {
  const x = Buffer.from(String(a ?? ''));
  const y = Buffer.from(String(b ?? ''));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

function cookies(req) {
  const out = {};
  for (const part of (req.get('cookie') ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function page(title, body) {
  return `<!doctype html>
<html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} | サンプルストア 管理画面</title>
<style>
body{font-family:system-ui,sans-serif;margin:0;background:#f5f5f4;color:#1c1917}
header{background:#292524;color:#fff;padding:12px 20px;display:flex;justify-content:space-between;align-items:center}
header form{margin:0} main{padding:20px;max-width:1100px;margin:auto}
section{background:#fff;border:1px solid #e7e5e4;border-radius:8px;padding:16px 20px;margin-bottom:20px}
table{border-collapse:collapse;width:100%} th,td{border-bottom:1px solid #e7e5e4;padding:6px 8px;text-align:left;font-size:14px}
input[type=number]{width:90px} input[type=text],textarea{width:100%;box-sizing:border-box} textarea{height:70px}
.msg{background:#dcfce7;border:1px solid #86efac;padding:8px 12px;border-radius:6px}
.err{background:#fee2e2;border:1px solid #fca5a5;padding:8px 12px;border-radius:6px}
.note{color:#57534e;font-size:13px} button{cursor:pointer}
</style></head><body>${body}</body></html>`;
}

function sendHtml(res, status, html) {
  res.status(status);
  res.set('Content-Type', 'text/html; charset=utf-8');
  // 管理画面は途中のキャッシュに残さず、ほかのサイトの枠(iframe)の中に表示させません。
  res.set('Cache-Control', 'no-store');
  res.set('X-Frame-Options', 'DENY');
  res.set('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'");
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('Referrer-Policy', 'same-origin');
  res.send(html);
}

async function loadSession(req) {
  const id = cookies(req).bo_session;
  if (!id) return null;
  const { rows } = await pool.query('SELECT id, csrf FROM backoffice_sessions WHERE id = $1 AND expires_at > now()', [id]);
  return rows[0] ?? null;
}

// ログインしていなければログイン画面へ。フォームの送信(POST)なら CSRF トークンも確かめます。
async function requireSession(req, res, next) {
  const session = await loadSession(req);
  if (!session) return res.redirect(303, '/backoffice/login');
  if (req.method === 'POST' && !safeEqual(req.body?._csrf, session.csrf)) {
    req.log.warn('CSRF トークンが合わないので断りました');
    return sendHtml(res, 403, page('拒否', '<main><p class="err">フォームの合言葉(CSRF トークン)が合いません。画面を開き直してください。</p></main>'));
  }
  req.session = session;
  next();
}

function loginPage(csrf, error) {
  return page(
    'ログイン',
    `<header><strong>サンプルストア 管理画面</strong></header><main><section style="max-width:360px;margin:40px auto">
<h1 style="font-size:20px">ログイン</h1>
${error ? `<p class="err">${esc(error)}</p>` : ''}
<form method="post" action="/backoffice/login">
<input type="hidden" name="_csrf" value="${esc(csrf)}">
<p><label>ユーザー名<br><input type="text" name="username" autocomplete="username" required></label></p>
<p><label>パスワード<br><input type="password" name="password" autocomplete="current-password" required></label></p>
<p><button type="submit">ログイン</button></p>
</form><p class="note">ラボ用のアカウント: admin / admin</p></section></main>`,
  );
}

function renderLogin(res, error) {
  // ログイン前の CSRF 対策: 同じ乱数をクッキーとフォームの両方に入れ、送られてきた 2 つが一致するかを見ます(二重送信クッキー)。
  const csrf = random();
  res.append('Set-Cookie', `bo_login_csrf=${csrf}; ${COOKIE_BASE}; Max-Age=600`);
  sendHtml(res, error ? 401 : 200, loginPage(csrf, error));
}

async function dashboard(req, res) {
  const products = await pool.query(
    `SELECT p.code, p.name, c.name AS category, p.price, p.stock, p.updated_at
       FROM products p JOIN categories c ON c.code = p.category_code ORDER BY p.code`,
  );
  const banner = await pool.query("SELECT attrs, updated_at FROM cms_components WHERE uid = 'HomepageSplashBanner'");
  const b = banner.rows[0]?.attrs ?? {};
  const csrf = esc(req.session.csrf);
  const msg = { product: '商品を保存しました。', banner: 'バナーを保存しました。' }[req.query.saved];
  const err = req.query.error ? '入力が正しくありません(価格・在庫は 0 以上の整数、見出しは 1〜60 文字、本文は 0〜300 文字)。' : '';
  const rows = products.rows
    .map(
      (p) => `<tr><td>${esc(p.code)}</td><td>${esc(p.name)}</td><td>${esc(p.category)}</td>
<td><form method="post" action="/backoffice/products/${esc(p.code)}" style="display:flex;gap:6px;align-items:center">
<input type="hidden" name="_csrf" value="${csrf}">
<label>価格(円) <input type="number" name="price" min="0" step="1" value="${p.price}" required></label>
<label>在庫 <input type="number" name="stock" min="0" step="1" value="${p.stock}" required></label>
<button type="submit">保存</button></form></td>
<td class="note">${esc(yen.format(p.price))}<br>${esc(p.updated_at.toISOString().slice(0, 19).replace('T', ' '))}</td></tr>`,
    )
    .join('');
  sendHtml(
    res,
    200,
    page(
      '管理画面',
      `<header><strong>サンプルストア 管理画面</strong>
<form method="post" action="/backoffice/logout"><input type="hidden" name="_csrf" value="${csrf}"><button type="submit">ログアウト</button></form></header>
<main>
${msg ? `<p class="msg">${esc(msg)}</p>` : ''}${err ? `<p class="err">${esc(err)}</p>` : ''}
<section><h2 style="font-size:18px">トップページのバナー</h2>
<form method="post" action="/backoffice/banner">
<input type="hidden" name="_csrf" value="${csrf}">
<p><label>見出し<br><input type="text" name="headline" maxlength="60" value="${esc(b.headline)}" required></label></p>
<p><label>本文<br><textarea name="content" maxlength="300">${esc(b.content)}</textarea></label></p>
<p><button type="submit">バナーを保存</button></p>
</form>
<p class="note">保存すると、api の cms/pages(トップページ)の SimpleBannerComponent に入ります。お店の画面に出るのは、cdn-waf のキャッシュが切れてからです。</p>
</section>
<section><h2 style="font-size:18px">商品(${products.rows.length} 件)</h2>
<p class="note">価格・在庫を変えて「保存」を押します。検索が Solr のときは、検索結果に出る値は worker が索引を作り直すまで(最大 60 秒)古いままです。</p>
<table><thead><tr><th>商品コード</th><th>商品名</th><th>分類</th><th>価格・在庫</th><th>今の価格 / 更新日時(UTC)</th></tr></thead>
<tbody>${rows}</tbody></table></section>
</main>`,
    ),
  );
}

const intIn = (v, min, max) => /^\d{1,9}$/.test(String(v ?? '')) && Number(v) >= min && Number(v) <= max;

function build() {
  const app = createApp();
  const form = express.urlencoded({ extended: false, limit: '20kb' });
  app.use(express.json({ limit: '10kb' }));

  // 「/」は管理画面へ。(/backoffice は /backoffice/ と同じ扱いになります)
  app.get('/', (req, res) => res.redirect(302, '/backoffice/'));

  app.get('/backoffice/login', (req, res) => renderLogin(res));

  app.post('/backoffice/login', form, async (req, res) => {
    const body = req.body ?? {};
    const cookieCsrf = cookies(req).bo_login_csrf;
    if (!cookieCsrf || !safeEqual(body._csrf, cookieCsrf)) {
      req.log.warn('ログイン画面の CSRF トークンが合いません');
      return renderLogin(res, '画面の有効期限が切れました。もう一度ログインしてください。');
    }
    // 名前とパスワードは、どちらが違ったかを教えません(総当たりの手がかりを減らすため)。
    const ok = safeEqual(body.username, ADMIN_USER) & safeEqual(body.password, ADMIN_PASSWORD);
    if (!ok) {
      req.log.warn({ username: body.username }, '管理画面のログイン失敗');
      return renderLogin(res, 'ユーザー名かパスワードが違います。');
    }
    const id = random();
    await pool.query(
      `INSERT INTO backoffice_sessions (id, csrf, expires_at) VALUES ($1, $2, now() + make_interval(hours => $3))`,
      [id, random(), SESSION_HOURS],
    );
    await pool.query('DELETE FROM backoffice_sessions WHERE expires_at < now()');
    req.log.info({ username: ADMIN_USER }, '管理画面にログインしました');
    res.append('Set-Cookie', `bo_session=${id}; ${COOKIE_BASE}; Max-Age=${SESSION_HOURS * 3600}`);
    res.append('Set-Cookie', `bo_login_csrf=; ${COOKIE_BASE}; Max-Age=0`);
    res.redirect(303, '/backoffice/');
  });

  app.post('/backoffice/logout', form, requireSession, async (req, res) => {
    await pool.query('DELETE FROM backoffice_sessions WHERE id = $1', [req.session.id]);
    res.append('Set-Cookie', `bo_session=; ${COOKIE_BASE}; Max-Age=0`);
    res.redirect(303, '/backoffice/login');
  });

  app.get('/backoffice/', requireSession, dashboard);

  app.post('/backoffice/products/:code', form, requireSession, async (req, res) => {
    const { price, stock } = req.body ?? {};
    if (!intIn(price, 0, 10_000_000) || !intIn(stock, 0, 1_000_000)) return res.redirect(303, '/backoffice/?error=1');
    const { rowCount } = await pool.query('UPDATE products SET price = $2, stock = $3, updated_at = now() WHERE code = $1', [
      String(req.params.code),
      Number(price),
      Number(stock),
    ]);
    if (rowCount === 0) return res.redirect(303, '/backoffice/?error=1');
    req.log.info({ product: req.params.code, price: Number(price), stock: Number(stock) }, '管理画面で商品を変更しました');
    res.redirect(303, '/backoffice/?saved=product');
  });

  app.post('/backoffice/banner', form, requireSession, async (req, res) => {
    const headline = String(req.body?.headline ?? '').trim();
    const content = String(req.body?.content ?? '').trim();
    if (headline.length < 1 || headline.length > 60 || content.length > 300) return res.redirect(303, '/backoffice/?error=1');
    await pool.query(
      `UPDATE cms_components
          SET attrs = jsonb_set(attrs || jsonb_build_object('headline', $1::text, 'content', $2::text), '{media,altText}', to_jsonb($1::text)),
              updated_at = now()
        WHERE uid = 'HomepageSplashBanner'`,
      [headline, content],
    );
    req.log.info({ headline }, '管理画面でバナーを変更しました');
    res.redirect(303, '/backoffice/?saved=banner');
  });

  mountChaosAdmin(app);
  finishApp(app);
  return app;
}

module.exports = { build };
