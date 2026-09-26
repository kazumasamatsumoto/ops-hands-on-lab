// OAuth の「認可サーバー」の役です。POST /authorizationserver/oauth/token
//
// パスワードグラント: 利用者の名前とパスワードを送ると、アクセストークン(15 分有効の合言葉)が返ります。
// 注意: パスワードグラントは、仕組みを見やすくするためにこのラボで使っている「古い方式」です。
//   OAuth のセキュリティの推奨(RFC 9700)では使わないこととされ、OAuth 2.1 の案からも外れています。
//   実案件(SAP Commerce Cloud 2211-jdk21 と Composable Storefront)では認可コードフロー(PKCE 付き)を使います。
// 以降の API は `Authorization: Bearer <トークン>` を付けて呼びます。
// たとえ: 遊園地の入口で身分を見せて(ログイン)、腕に巻くリストバンド(トークン)をもらう。中のアトラクションはバンドだけ見る。
//
// クライアント(client_id)= 「どのアプリからのログインか」。ここでは storefront だけを受け付けます。
// storefront はブラウザで動く「公開クライアント」なので秘密の鍵(client_secret)は持ちません。
// (CCv2 でも、OAuth のクライアントを登録し、storefront 用のクライアントからトークンを取ります)
//
// トークンは中身の無いランダムな文字列です。DB にはその SHA-256 の値と、持ち主・期限だけを保存します。
'use strict';

const crypto = require('node:crypto');
const { pool, verifyPassword } = require('../db');

const TOKEN_TTL_SECONDS = 900; // 15 分
const ALLOWED_CLIENTS = new Set(['storefront']);

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

function oauthError(res, status, error, description) {
  res.status(status).json({ error, error_description: description });
}

async function tokenHandler(req, res) {
  // トークンの応答は途中のキャッシュ(CDN など)に絶対に残させません。
  res.set('Cache-Control', 'no-store');
  res.set('Pragma', 'no-cache');
  const body = req.body ?? {};
  if (body.grant_type !== 'password') {
    return oauthError(res, 400, 'unsupported_grant_type', 'grant_type は password だけに対応しています');
  }
  if (!ALLOWED_CLIENTS.has(body.client_id)) {
    return oauthError(res, 401, 'invalid_client', '登録されていないクライアントです');
  }
  if (typeof body.username !== 'string' || typeof body.password !== 'string' || !body.username) {
    return oauthError(res, 400, 'invalid_request', 'username と password を送ってください');
  }
  const { rows } = await pool.query('SELECT id, uid, password_hash FROM users WHERE uid = $1', [body.username]);
  const user = rows[0];
  // 何度失敗してもロックはしません。ログインの回数制限は入口の ingress が受け持ちます
  // (軽量版は ingress/default.conf.template の limit_req zone=login、本格版は Ingress api-ratelimit-1 の注釈 limit-rps。IP ごとに 1 秒 1 回・ため 5 回があるので続けて 6 回までは通る)。
  if (!user || !verifyPassword(body.password, user.password_hash)) {
    req.log.warn({ username: body.username, clientId: body.client_id }, 'ログイン失敗');
    return oauthError(res, 400, 'invalid_grant', '会員名かパスワードが違います');
  }
  const token = crypto.randomBytes(32).toString('base64url');
  await pool.query(
    `INSERT INTO oauth_access_tokens (token_hash, client_id, user_id, expires_at)
     VALUES ($1, $2, $3, now() + make_interval(secs => $4))`,
    [sha256(token), body.client_id, user.id, TOKEN_TTL_SECONDS],
  );
  // 期限切れのトークンを少しずつ片付けます(表がふくらみ続けないように)。
  await pool.query("DELETE FROM oauth_access_tokens WHERE expires_at < now() - interval '1 hour'");
  req.log.info({ username: user.uid, clientId: body.client_id }, 'トークンを発行しました');
  res.json({ access_token: token, token_type: 'bearer', expires_in: TOKEN_TTL_SECONDS, scope: 'basic' });
}

// POST /authorizationserver/oauth/revoke(ログアウト用。token=... を送ると、そのトークンを無効にします)
async function revokeHandler(req, res) {
  const token = req.body?.token;
  if (typeof token === 'string' && token) {
    await pool.query('DELETE FROM oauth_access_tokens WHERE token_hash = $1', [sha256(token)]);
  }
  res.set('Cache-Control', 'no-store');
  res.json({});
}

// Authorization: Bearer <トークン> を確かめます。無い・知らない・期限切れなら 401。
async function requireToken(req, res, next) {
  const header = req.get('authorization') ?? '';
  const token = /^bearer /i.test(header) ? header.slice(7).trim() : null;
  if (!token) {
    res.status(401).json({ errors: [{ type: 'UnauthorizedError', message: 'ログインが必要です(Authorization: Bearer <トークン>)' }] });
    return;
  }
  const { rows } = await pool.query(
    `SELECT u.id, u.uid, u.name FROM oauth_access_tokens t JOIN users u ON u.id = t.user_id
      WHERE t.token_hash = $1 AND t.expires_at > now()`,
    [sha256(token)],
  );
  if (rows.length === 0) {
    res.status(401).json({ errors: [{ type: 'InvalidTokenError', message: 'トークンが無効か、期限切れです' }] });
    return;
  }
  req.user = rows[0];
  next();
}

module.exports = { tokenHandler, revokeHandler, requireToken, TOKEN_TTL_SECONDS };
