---
title: 仕組み-6 api(OCC 風の REST API・fields・CORS)
---

# 仕組み-6 api(OCC 風の REST API・fields・CORS)

::: tip このページで分かること
- `/occ/v2/samplestore/...` という URL の読み方と、baseSiteId の意味。
- `fields=BASIC|DEFAULT|FULL` で返す量(バイト数)がどう変わるか。
- エラーの返し方(`{"errors":[{type,message}]}`)と、状態コードの使い分け。
- ブラウザから別オリジンの api を呼ぶときの CORS(下見 = プリフライトを含む)。
:::

## 1. 一言でいうと {#s1}

api は、**お店のデータを JSON で出し入れする窓口** です。URL の形は SAP Commerce の OCC(Omni Commerce Connect = お店のデータを外から使うための REST API)に合わせてあります。

**たとえ: 出前のメニューと受付**

- `/occ/v2/samplestore/products/100001` は「サンプルストア店の、商品の、100001 番」という **注文票の書き方** です。どの店(サイト)か → 何の種類か → どれか、の順に狭めていきます。
- `fields` は **並・上・特上**。特上(FULL)は中身が多いぶん、運ぶ量(バイト数)も時間も増えます。
- CORS は **受付の名簿**。別の建物(オリジン)から来た注文は、名簿に載っている建物からの物だけ、中身を渡します。

## 2. 1 リクエストの流れ {#s2}

ブラウザで検索したときの流れです(SSR 中なら ① と ② は無く、storefront から `http://api:3001` に直接来ます)。

```text
 ブラウザ(画面は http://www.lab.localhost:18080)
   GET http://api.lab.localhost:18080/occ/v2/samplestore/products/search?query=ペン&currentPage=0&pageSize=20&fields=DEFAULT
   Origin: http://www.lab.localhost:18080         ← 別オリジンなのでブラウザが自動で付ける
 ① cdn-waf   WAF・レート制限・キャッシュ(30 秒。Origin ごとに別々にためる)
 ② ingress   api.lab.localhost → api:3001
 ③ api
    ├ 共通の受付        アクセスログの準備・指標の計測を始める
    ├ CORS              Origin が CORS_ALLOWED_ORIGINS にある → Access-Control-Allow-Origin を付ける
    │                   いつも Vary: Origin を付ける
    ├ URL の振り分け     /occ/v2/samplestore の下の /products/search
    ├ カオスの関門       latencyMs・errorRate・leakMb(演習でわざと壊すとき)
    ├ 検索              SEARCH_PROVIDER=db → PostgreSQL の ILIKE / solr → Solr
    ├ 形を作る          fields の段階に合わせて項目を選ぶ(BASIC / DEFAULT / FULL)
    └ 返す              200 + JSON。X-Search-Provider: db
 ブラウザ   Access-Control-Allow-Origin が自分のオリジンと一致 → JS に JSON を渡す
```

ログインした人の注文を見るときは、ブラウザが **先に下見(プリフライト)** をします。

```text
 ① OPTIONS /occ/v2/samplestore/users/current/orders
      Origin: http://www.lab.localhost:18080
      Access-Control-Request-Method: GET
      Access-Control-Request-Headers: authorization
    ← 204  Access-Control-Allow-Origin: http://www.lab.localhost:18080
           Access-Control-Allow-Headers: Authorization, Content-Type, traceparent, tracestate, X-Request-Id
           Access-Control-Max-Age: 600(10 分は下見を省いてよい)
 ② GET /occ/v2/samplestore/users/current/orders
      Authorization: Bearer <トークン>
    ← 200  {"orders":[...]}   Cache-Control: no-store
```

- 商品・CMS の `GET` と、ログインの `POST`(フォームの形)は「単純なリクエスト」なので下見はありません。
- `Authorization` ヘッダを付けると「単純」ではなくなるので、ブラウザが下見をします。storefront が `Authorization` を `/users/` の下にだけ付けるのは、商品の呼び出しまで毎回下見が飛び、キャッシュも効かなくなるのを避けるためです。

## 3. 設定の読み方 {#s3}

### 3.1 URL の形と baseSiteId {#s3-1}

ファイル: [apps/api/src/aspects/api.js](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/apps/api/src/aspects/api.js)

```js
const BASE_SITE = 'samplestore';
...
  occ.get('/products/search', searchHandler);
  occ.get('/products/:code', async (req, res) => { ... });
  occ.get('/cms/pages', cmsPagesHandler);
  occ.get('/users/current/orders', requireToken, listHandler);
  occ.get('/users/current/orders/:code', requireToken, detailHandler);

  app.use(`/occ/v2/${BASE_SITE}`, occ);

  app.post('/authorizationserver/oauth/token', form, chaosMiddleware, tokenHandler);
  app.get('/medias/:file', mediaHandler);
```

- `BASE_SITE = 'samplestore'` … サイト ID(baseSiteId)。1 つの api で複数のお店(例: 日本向け・海外向け)を持てるので、URL に「どのお店か」を入れます。
- `occ.get(...)` … `/occ/v2/samplestore` より後ろのパスと、処理する関数の組です。`:code` は「ここに入った値を `code` として受け取る」という意味です。
- `requireToken` … 注文の前に「トークンを確かめる」関門を挟みます([仕組み-7](./07-oauth-token))。
- `users/current` … 「トークンの持ち主」のこと。URL に会員 ID を書かせず、トークンから本人を決めるのが安全な形です。

| メソッドとパス | 中身 | ログイン |
| --- | --- | --- |
| `GET /occ/v2/samplestore/products/search?query=&currentPage=0&pageSize=20&sort=&fields=` | 商品検索 | 不要 |
| `GET /occ/v2/samplestore/products/{code}?fields=` | 商品 1 件 | 不要 |
| `GET /occ/v2/samplestore/cms/pages?pageType=...` | 画面の設計図([仕組み-5](./05-headless-cms)) | 不要 |
| `GET /occ/v2/samplestore/users/current/orders` | 自分の注文の一覧 | 必要 |
| `GET /occ/v2/samplestore/users/current/orders/{code}` | 注文 1 件(自分の物でなければ 404) | 必要 |
| `POST /authorizationserver/oauth/token` | トークンの発行 | — |
| `GET /medias/{code}.svg` | 商品画像(`Cache-Control: public, max-age=86400`) | 不要 |

### 3.2 fields(返す量) {#s3-2}

ファイル: [apps/api/src/occ/format.js](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/apps/api/src/occ/format.js)

```js
function fieldsLevel(value) {
  const v = String(value ?? 'DEFAULT').toUpperCase();
  return LEVELS.has(v) ? v : 'DEFAULT';
}
...
function product(row, level) {
  const out = { code: row.code, name: row.name, url: `/p/${row.code}`, price: price(row.price) };
  if (level === 'BASIC') return out;
  Object.assign(out, { summary: row.summary, images: images(row.code, row.name), stock: stock(row.stock) });
  if (level === 'DEFAULT') return out;
  Object.assign(out, {
    description: row.description,
    categories: [...],
    classifications: row.classifications ?? [],
    purchasable: row.stock > 0,
  });
  return out;
}
```

- 指定が無い・知らない値なら `DEFAULT` です。
- BASIC で返したら終わり、DEFAULT ならいくつか足して終わり、FULL ならさらに足す、という「段を積む」書き方です。

| 値 | 返す項目 | 検索 20 件のおよその大きさ |
| --- | --- | --- |
| `BASIC` | `code`・`name`・`url`・`price` | 約 3KB |
| `DEFAULT`(既定) | BASIC + `summary`・`images`・`stock` | その間 |
| `FULL` | DEFAULT + `description`・`categories`・`classifications`・`purchasable` | 約 25KB |

storefront は、一覧とカルーセルでは `DEFAULT`、商品詳細では `FULL` を頼みます。**一覧で FULL を頼むと、使わない長い説明まで運ぶ** ので遅くなります。

### 3.3 エラーの形 {#s3-3}

ファイル: [apps/api/src/http-common.js](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/apps/api/src/http-common.js)

```js
function sendError(res, status, type, message) {
  res.status(status).json({ errors: [{ type, message }] });
}
```

- 失敗はいつも `{"errors":[{"type":"…","message":"…"}]}` の形です(OCC と同じ)。画面の側は `type` で分岐できます。
- Express 5 では、`async` の関数で投げた例外も最後の受け皿に届き、`500 InternalServerError` になります。SQL などの中身は外に見せず、ログにだけ残します。

| 状態コード | `type` の例 | いつ |
| --- | --- | --- |
| 400 | `ValidationError` | パラメータや JSON の形がおかしい |
| 401 | `UnauthorizedError`・`InvalidTokenError` | トークンが無い・無効・期限切れ |
| 403 | `CorsError` | 許していないオリジンからの下見(OPTIONS) |
| 404 | `UnknownIdentifierError`・`CMSItemNotFoundError`・`NotFoundError` | 商品・ページ・注文が無い、パスが無い |
| 500 | `InternalServerError`・`ChaosError` | サーバーの失敗(カオスの `errorRate` もこれ) |
| 503 | `SearchUnavailableError` | 検索サーバー(Solr)に届かない([仕組み-9](./09-search-solr)) |

### 3.4 CORS {#s3-4}

ファイル: [apps/api/src/occ/cors.js](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/apps/api/src/occ/cors.js)

```js
const allowed = new Set(
  (process.env.CORS_ALLOWED_ORIGINS ?? 'http://www.lab.localhost:18080')
    .split(/[\s,]+/)
    ...
);
...
function corsMiddleware(req, res, next) {
  const origin = req.get('origin');
  res.vary('Origin');
  if (!origin) return next();
  const ok = allowed.has(origin);
  if (ok) {
    res.set('Access-Control-Allow-Origin', origin);
    res.set('Access-Control-Expose-Headers', 'X-Search-Provider');
  }
  if (req.method === 'OPTIONS' && req.get('access-control-request-method')) {
    if (!ok) { ... res.status(403) ... }
    res.set('Access-Control-Allow-Methods', ALLOW_METHODS);
    res.set('Access-Control-Allow-Headers', ALLOW_HEADERS);
    res.set('Access-Control-Max-Age', '600');
    res.status(204).end();
    return;
  }
  next();
}
```

- `CORS_ALLOWED_ORIGINS` … 許すオリジンの一覧(カンマか空白で区切って複数)。既定は `http://www.lab.localhost:18080`。
- `res.vary('Origin')` … 「返事は Origin によって変わります」と途中のキャッシュ(cdn-waf)に知らせます。これが無いと、www 向けの `Access-Control-Allow-Origin` の付いた返事を、別のオリジンの人に使い回してしまいます。
- `if (!origin) return next()` … `Origin` が無い(同じオリジン・curl・SSR 中の storefront)なら、CORS は関係ないのでそのまま通します。
- `Access-Control-Allow-Origin` … 名簿に載っていれば、そのオリジンをそのまま返します(`*` にはしません)。
- `Access-Control-Expose-Headers` … JS に読ませてよい追加のヘッダ(検索の実体が分かる `X-Search-Provider`)。
- OPTIONS の下見 … 許していなければ 403。許していれば、使ってよいメソッドとヘッダを答え、600 秒(10 分)は下見を省いてよいと伝えます。

## 4. 確かめるコマンド {#s4}

```bash
# 商品 1 件(整形して見る)
curl -s http://api.lab.localhost:18080/occ/v2/samplestore/products/100001 | python3 -m json.tool | head -20

# fields で大きさが変わる(バイト数)
for f in BASIC DEFAULT FULL; do
  printf '%-8s ' $f
  curl -s -o /dev/null -w '%{size_download} bytes\n' \
    "http://api.lab.localhost:18080/occ/v2/samplestore/products/search?query=&pageSize=20&fields=$f"
done
# → BASIC は約 3KB、FULL は約 25KB

# 無い商品は 404 と決まった形のエラー
curl -s http://api.lab.localhost:18080/occ/v2/samplestore/products/NO-SUCH
# → {"errors":[{"type":"UnknownIdentifierError","message":"商品が見つかりません: NO-SUCH"}]}

# ログインが要る所にトークン無しで → 401
curl -s -o /dev/null -w '%{http_code}\n' http://api.lab.localhost:18080/occ/v2/samplestore/users/current/orders

# CORS: 許したオリジン → Access-Control-Allow-Origin が返る
curl -sI -H 'Origin: http://www.lab.localhost:18080' \
  http://api.lab.localhost:18080/occ/v2/samplestore/products/100001 | grep -iE 'access-control|vary'
# → Vary: Origin
#   Access-Control-Allow-Origin: http://www.lab.localhost:18080
#   Access-Control-Expose-Headers: X-Search-Provider

# CORS: 知らないオリジン → Access-Control-Allow-Origin が付かない(ブラウザは JS に渡さない)
curl -sI -H 'Origin: http://evil.example' \
  http://api.lab.localhost:18080/occ/v2/samplestore/products/100001 | grep -i access-control
# → (何も出ない)

# 下見(プリフライト)のまね
curl -s -o /dev/null -w '%{http_code}\n' -X OPTIONS \
  -H 'Origin: http://www.lab.localhost:18080' \
  -H 'Access-Control-Request-Method: GET' \
  -H 'Access-Control-Request-Headers: authorization' \
  http://api.lab.localhost:18080/occ/v2/samplestore/users/current/orders
# → 204(知らないオリジンにすると 403)
```

ブラウザでは、ログインして注文履歴を開き、開発者ツールの Network で `orders` が 2 行(`OPTIONS` の preflight と `GET`)出ることを確かめます。

## 5. CCv2 / Composable Storefront ではどこに当たるか {#s5}

| ラボ | CCv2 / Composable Storefront で当たるもの |
| --- | --- |
| api(ASPECT=api) | api aspect(OCC の REST API を出す役) |
| `/occ/v2/samplestore/...` | OCC の URL(`/occ/v2/{baseSiteId}/...`) |
| `BASE_SITE = 'samplestore'` | baseSiteId(Composable Storefront の設定の「どのサイトか」) |
| `fields=BASIC\|DEFAULT\|FULL` | OCC の `fields` パラメータ(段階の名前のほか、項目を 1 つずつ指定することもできる) |
| `{"errors":[{type,message}]}` | OCC のエラーの返し方 |
| `CORS_ALLOWED_ORIGINS` | corsfilter の設定(OCC 用の許可するオリジンの一覧をプロパティで持つ) |
| `/medias/...` | メディア(画像)の URL。CDN でためる |
| `users/current` | ログイン中の本人を表す OCC の書き方 |

## 6. よくある誤解 {#s6}

- **「CORS を許せば、api が守られる」** → 逆です。CORS は「ブラウザの JS に中身を渡してよいか」の決まりで、許すほど緩くなります。curl や攻撃者のサーバーからの呼び出しは、CORS では止まりません。
- **「`Access-Control-Allow-Origin: *` にしておけば楽」** → 誰のページからでも JS で読めるようになります。ラボは名簿に載ったオリジンだけを返します。
- **「エラーでも 200 を返して、本文に失敗と書けばよい」** → キャッシュ・監視(5xx の割合)・画面の分岐が全部狂います。状態コードで失敗の種類を伝えます。
- **「FULL で取っておけば、あとで困らない」** → 件数が多い一覧では、使わない項目の分だけ遅く重くなります。画面ごとに必要な段階を選びます。
- **「プリフライトの 204 は失敗」** → 204 は「中身の無い成功」です。下見が通った合図で、本番の `GET` がこのあとに続きます。

## 7. 関係する演習と設計書 {#s7}

- 演習: [BE-1 API と認可の事故](/exercises/04-be-api-and-authz)・[ネットワーク-2 CORS と IP 制限](/exercises/08-nw-cors-and-ip)・[性能-1 負荷試験で限界を見る](/exercises/12-perf-load-test)
- 設計書: [BE 方式 4.1 API の形(OCC 風)](/design/architecture/02-backend#s4-1)・[4.5 エラーの返し方](/design/architecture/02-backend#s4-5)・[ネットワーク方式 4.5 CORS](/design/architecture/04-network#s4-5)・[性能方式 4.7 返す量を減らす(fields)](/design/architecture/07-performance#s4-7)・[D-BE 注文 API と認可](/design/detail/D-BE-orders-api)
- 前後のページ: [仕組み-5 ヘッドレス CMS](./05-headless-cms) ・ [仕組み-7 OAuth のトークン](./07-oauth-token)
