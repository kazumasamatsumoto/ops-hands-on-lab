// CORS(オリジンをまたいだ呼び出しの許可)。
//
// storefront のページは http://www.lab.localhost:18080、api は http://api.lab.localhost:18080 で、
// ブラウザから見ると「別のお店(オリジン)」です。ブラウザは、別オリジンの API の返事を、
// その API が「この相手には見せてよい」(Access-Control-Allow-Origin)と言ったときだけ、ページの JS に渡します。
// たとえ: 受付で「このお客様(オリジン)にはお渡ししてよい」と書かれた名簿(CORS_ALLOWED_ORIGINS)に載っている人だけに荷物を渡す。
//
// 注意: CORS はブラウザを守るしくみで、curl などからの呼び出しは止めません(認可の代わりにはなりません)。
// (CCv2 では、corsfilter の設定(許可するオリジンの一覧)で同じことを決めます)
'use strict';

const allowed = new Set(
  (process.env.CORS_ALLOWED_ORIGINS ?? 'http://www.lab.localhost:18080')
    .split(/[\s,]+/)
    .map((s) => s.trim().replace(/\/+$/, ''))
    .filter(Boolean),
);

const ALLOW_HEADERS = 'Authorization, Content-Type, traceparent, tracestate, X-Request-Id';
const ALLOW_METHODS = 'GET, POST, PUT, PATCH, DELETE, OPTIONS';

function corsMiddleware(req, res, next) {
  const origin = req.get('origin');
  // 返事がオリジンによって変わることを、途中のキャッシュ(CDN)に知らせます。これが無いと、別の相手の返事が使い回されます。
  res.vary('Origin');
  if (!origin) return next(); // 同じオリジンや curl などは、そのまま通します
  const ok = allowed.has(origin);
  if (ok) {
    res.set('Access-Control-Allow-Origin', origin);
    res.set('Access-Control-Expose-Headers', 'X-Search-Provider');
  }
  // 下見(プリフライト): ブラウザが本番の呼び出しの前に「この呼び方をしてよいか」を OPTIONS で聞きに来ます。
  if (req.method === 'OPTIONS' && req.get('access-control-request-method')) {
    if (!ok) {
      req.log.warn({ origin }, 'CORS: 許可していないオリジンからの下見を断りました');
      res.status(403).json({ errors: [{ type: 'CorsError', message: `許可していないオリジンです: ${origin}` }] });
      return;
    }
    res.set('Access-Control-Allow-Methods', ALLOW_METHODS);
    res.set('Access-Control-Allow-Headers', ALLOW_HEADERS);
    res.set('Access-Control-Max-Age', '600');
    res.status(204).end();
    return;
  }
  if (!ok) req.log.info({ origin }, 'CORS: 許可していないオリジンなので Access-Control-Allow-Origin を付けません');
  next();
}

module.exports = { corsMiddleware, allowedOrigins: allowed };
