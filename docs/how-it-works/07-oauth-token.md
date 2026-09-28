---
title: 仕組み-7 OAuth のトークン(ログインの正体)
---

# 仕組み-7 OAuth のトークン(ログインの正体)

::: tip このページで分かること
- ログイン = 「パスワードグラントでアクセストークンをもらうこと」が、1 リクエストでどう動くか。
- 公開クライアント(`client_id=storefront`・秘密の鍵なし)の意味。
- トークンの有効期限(900 秒 = 15 分)と、ブラウザでの置き場所(メモリと sessionStorage)。
- 400・401・429 が返ってきたとき、それぞれ何が起きているか。
:::

## 1. 一言でいうと {#s1}

ログインすると、api の「認可サーバー」が **15 分だけ使える合言葉(アクセストークン)** をくれます。
以降、ログインした人だけの API には、毎回 `Authorization: Bearer <合言葉>` を付けて呼びます。api は合言葉を DB で照らし合わせて、「誰か」を決めます。

**たとえ: 遊園地のリストバンド**

- 入口で身分を見せて(名前とパスワード)、腕に巻くリストバンド(トークン)をもらう。
- 中のアトラクション(注文の API)は、名前もパスワードも聞かず、リストバンドだけを見る。
- リストバンドは 15 分で切れる。落として拾われても、被害は 15 分で終わる。
- リストバンドは「店の中の係(storefront)」ではなく、**お客さん本人(ブラウザ)** が持つ。

## 2. 1 リクエストの流れ {#s2}

```text
 ブラウザ(/login の画面で alice / password を入れて「ログイン」)
 ① POST http://api.lab.localhost:18080/authorizationserver/oauth/token
      Content-Type: application/x-www-form-urlencoded
      grant_type=password&client_id=storefront&username=alice&password=password
      → cdn-waf(ためない)→ ingress(IP ごとに 1 秒 1 回。続けて来ても 6 回目までは通し、7 回目から 429)→ api
 ② api(認可サーバーの役)
      grant_type は password か         違えば 400 unsupported_grant_type
      client_id は storefront か         違えば 401 invalid_client
      username と password があるか      無ければ 400 invalid_request
      users 表から alice を探し、パスワードの指紋(scrypt)を照らし合わせる
                                        違えば 400 invalid_grant(何度失敗してもロックしない)
      合っていれば 32 バイトの乱数でトークンを作る
      DB の oauth_access_tokens に「トークンの SHA-256・client_id・会員・期限(今 + 900 秒)」を保存
 ③ 返事  200  Cache-Control: no-store
      {"access_token":"…","token_type":"bearer","expires_in":900,"scope":"basic"}
 ④ ブラウザ  トークンをメモリと sessionStorage(キー samplestore.token)に置く。期限は「今 + 900 秒」
 ⑤ 注文を見る
      OPTIONS …/users/current/orders(下見)→ 204
      GET     …/users/current/orders   Authorization: Bearer <トークン>
 ⑥ api  トークンの SHA-256 を DB で探す(期限内のものだけ)→ 見つかった会員 = users/current
        見つからない・期限切れ → 401 InvalidTokenError
```

1. **ブラウザが直接 api に送ります。** storefront(SSR のサーバー)はパスワードを受け取りも確かめもしません。
2. **api が確かめます。** パスワードは DB にそのまま置かず、scrypt(わざと計算に時間がかかる変換)の結果だけを置いて照らし合わせます。
3. **トークンは中身の無いランダムな文字列** です(JWT のように中に情報を入れた物ではありません)。DB にはトークンそのものではなく SHA-256 の値を置くので、DB が漏れてもトークンとしては使えません。DB に置くので、api が何台あっても、どの台でも同じトークンが通ります。
4. **ブラウザの置き場所**: メモリと sessionStorage。タブを閉じると消えます。
5. **使うとき**: 注文など `/users/` の下の API にだけ `Authorization` を付けます。
6. **api は毎回 DB を引きます。** 期限(15 分)を過ぎた物は見つからない扱いになり、401 です。

::: info SSR の画面にログインの情報が入らないわけ
トークンはブラウザだけが持っていて、storefront のサーバーには届きません。そのため注文履歴の画面は、サーバーでは描かず、ブラウザが api を呼んで描きます。
サーバーのメモリは全員で共有なので、そこに人のトークンを置くと、別の人のリクエストに混ざる事故になりえます。
:::

## 3. 設定の読み方 {#s3}

### 3.1 認可サーバー {#s3-1}

ファイル: [apps/api/src/occ/oauth.js](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/apps/api/src/occ/oauth.js)

```js
const TOKEN_TTL_SECONDS = 900; // 15 分
const ALLOWED_CLIENTS = new Set(['storefront']);
```

- `TOKEN_TTL_SECONDS` … トークンの有効期限(秒)。
- `ALLOWED_CLIENTS` … 受け付けるクライアント(どのアプリからのログインか)。`storefront` だけです。

```js
  res.set('Cache-Control', 'no-store');
  ...
  if (body.grant_type !== 'password') {
    return oauthError(res, 400, 'unsupported_grant_type', ...);
  }
  if (!ALLOWED_CLIENTS.has(body.client_id)) {
    return oauthError(res, 401, 'invalid_client', ...);
  }
  ...
  if (!user || !verifyPassword(body.password, user.password_hash)) {
    return oauthError(res, 400, 'invalid_grant', '会員名かパスワードが違います');
  }
  const token = crypto.randomBytes(32).toString('base64url');
  await pool.query(
    `INSERT INTO oauth_access_tokens (token_hash, client_id, user_id, expires_at)
     VALUES ($1, $2, $3, now() + make_interval(secs => $4))`,
    [sha256(token), body.client_id, user.id, TOKEN_TTL_SECONDS],
  );
  res.json({ access_token: token, token_type: 'bearer', expires_in: TOKEN_TTL_SECONDS, scope: 'basic' });
```

- `Cache-Control: no-store` … トークンの返事は、途中のキャッシュ(CDN)に絶対に残させません。
- `grant_type` … トークンのもらい方の種類。ここでは「名前とパスワードを渡す」パスワードグラントだけです。パスワードグラントは古いやり方で、今の OAuth の決まりでは使わないことになっています(下の「よくある誤解」)。
- `invalid_grant` が 400 なのは、OAuth の決まりで「送られた資格(名前・パスワード)が正しくない」は 400 と決まっているためです。
- `randomBytes(32)` … 推測できない 32 バイトの乱数。`base64url` で URL に入れても壊れない文字にします。
- `expires_at` … DB の時計で「今 + 900 秒」。

```js
async function requireToken(req, res, next) {
  const header = req.get('authorization') ?? '';
  const token = /^bearer /i.test(header) ? header.slice(7).trim() : null;
  if (!token) { ... 401 UnauthorizedError ... }
  const { rows } = await pool.query(
    `SELECT u.id, u.uid, u.name FROM oauth_access_tokens t JOIN users u ON u.id = t.user_id
      WHERE t.token_hash = $1 AND t.expires_at > now()`,
    [sha256(token)],
  );
  if (rows.length === 0) { ... 401 InvalidTokenError ... }
  req.user = rows[0];
  next();
}
```

- `Bearer ` で始まるヘッダから、トークンの部分を取り出します。
- `expires_at > now()` … 期限内の物だけを探します。
- 見つかった会員を `req.user` に入れて、次の処理(注文の一覧など)に渡します。注文 1 件では、さらに「その注文の持ち主か」を確かめます(認可。[BE-1 の演習](/exercises/04-be-api-and-authz))。

### 3.2 ブラウザの置き場所 {#s3-2}

ファイル: [apps/web/src/app/core/auth.service.ts](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/apps/web/src/app/core/auth.service.ts)

```ts
const STORAGE_KEY = 'samplestore.token';
...
  setToken(token: string | null, expiresInSec = 900): void {
    this.expiresAt = token ? Date.now() + expiresInSec * 1000 : 0;
    this.token.set(token);
    if (!this.isBrowser) return;
    ...
      if (token) sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ token, expiresAt: this.expiresAt } satisfies Saved));
```

- メモリ(`signal`)に置き、ブラウザでは sessionStorage にも控えます(再読み込みしても残り、タブを閉じると消える)。
- localStorage には置きません(ずっと残り、盗まれたときの被害が大きいため)。
- `if (!this.isBrowser) return;` … サーバー(SSR)では保存しません。
- 期限を過ぎたトークンは送る前に捨てます(送っても 401 になるだけなので)。

### 3.3 ログインの回数制限 {#s3-3}

api は「何度失敗してもロックしない」作りなので、総当たり(パスワードを片端から試す攻撃)を遅くするのは ingress の回数制限です([ingress/default.conf.template](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/ingress/default.conf.template))。

```nginx
  location = /authorizationserver/oauth/token {
    limit_req zone=login burst=5 nodelay;
    proxy_pass $backend;
  }
```

- IP ごとに 1 秒 1 回です。`burst=5` は「決まりの 1 回に加えて、5 回までは待たせずに通す」という意味なので、一気に送ると 6 回目までは通り、7 回目から 429 になります([仕組み-2](./02-ingress-and-endpoints)・[セキュリティ-2 の演習](/exercises/18-sec-rate-limit-login))。

## 4. 確かめるコマンド {#s4}

::: code-group

```bash [Mac / Linux / WSL]
# トークンをもらう
curl -s http://api.lab.localhost:18080/authorizationserver/oauth/token \
  -d 'grant_type=password&client_id=storefront&username=alice&password=password'
# → {"access_token":"…","token_type":"bearer","expires_in":900,"scope":"basic"}

# 変数に入れて、注文を見る
TOKEN=$(curl -s http://api.lab.localhost:18080/authorizationserver/oauth/token \
  -d 'grant_type=password&client_id=storefront&username=alice&password=password' \
  | sed 's/.*"access_token":"\([^"]*\)".*/\1/')
curl -s -H "Authorization: Bearer $TOKEN" http://api.lab.localhost:18080/occ/v2/samplestore/users/current
# → {"uid":"alice","name":"…"}

# 失敗のいろいろ(状態コードと error を見る)
curl -s -w ' %{http_code}\n' http://api.lab.localhost:18080/authorizationserver/oauth/token \
  -d 'grant_type=password&client_id=storefront&username=alice&password=wrong'
# → {"error":"invalid_grant",…} 400
curl -s -w ' %{http_code}\n' http://api.lab.localhost:18080/authorizationserver/oauth/token \
  -d 'grant_type=password&client_id=other-app&username=alice&password=password'
# → {"error":"invalid_client",…} 401
curl -s -w ' %{http_code}\n' -H 'Authorization: Bearer nonsense' \
  http://api.lab.localhost:18080/occ/v2/samplestore/users/current/orders
# → {"errors":[{"type":"InvalidTokenError",…}]} 401

# DB にはトークンそのものではなく SHA-256 が入っている
docker compose exec db psql -U store -d store -c \
  "SELECT left(token_hash, 16) AS hash, client_id, expires_at FROM oauth_access_tokens ORDER BY expires_at DESC LIMIT 3;"

# ログアウト(トークンを無効にする)
curl -s http://api.lab.localhost:18080/authorizationserver/oauth/revoke -d "token=$TOKEN"
curl -s -o /dev/null -w '%{http_code}\n' -H "Authorization: Bearer $TOKEN" \
  http://api.lab.localhost:18080/occ/v2/samplestore/users/current/orders
# → 401
```

```powershell [PowerShell]
# トークンをもらう
curl.exe -s http://api.lab.localhost:18080/authorizationserver/oauth/token `
  -d 'grant_type=password&client_id=storefront&username=alice&password=password'
# → {"access_token":"…","token_type":"bearer","expires_in":900,"scope":"basic"}

# 変数に入れて、注文を見る(JSON は ConvertFrom-Json で読む)
$TOKEN = (curl.exe -s http://api.lab.localhost:18080/authorizationserver/oauth/token `
  -d 'grant_type=password&client_id=storefront&username=alice&password=password' | ConvertFrom-Json).access_token
curl.exe -s -H "Authorization: Bearer $TOKEN" http://api.lab.localhost:18080/occ/v2/samplestore/users/current
# → {"uid":"alice","name":"…"}

# 失敗のいろいろ(状態コードと error を見る)
curl.exe -s -w ' %{http_code}\n' http://api.lab.localhost:18080/authorizationserver/oauth/token `
  -d 'grant_type=password&client_id=storefront&username=alice&password=wrong'
# → {"error":"invalid_grant",…} 400
curl.exe -s -w ' %{http_code}\n' http://api.lab.localhost:18080/authorizationserver/oauth/token `
  -d 'grant_type=password&client_id=other-app&username=alice&password=password'
# → {"error":"invalid_client",…} 401
curl.exe -s -w ' %{http_code}\n' -H 'Authorization: Bearer nonsense' `
  http://api.lab.localhost:18080/occ/v2/samplestore/users/current/orders
# → {"errors":[{"type":"InvalidTokenError",…}]} 401

# DB にはトークンそのものではなく SHA-256 が入っている
docker compose exec db psql -U store -d store -c `
  "SELECT left(token_hash, 16) AS hash, client_id, expires_at FROM oauth_access_tokens ORDER BY expires_at DESC LIMIT 3;"

# ログアウト(トークンを無効にする)
curl.exe -s http://api.lab.localhost:18080/authorizationserver/oauth/revoke -d "token=$TOKEN"
curl.exe -s -o NUL -w '%{http_code}\n' -H "Authorization: Bearer $TOKEN" `
  http://api.lab.localhost:18080/occ/v2/samplestore/users/current/orders
# → 401
```

:::

ブラウザでは、http://www.lab.localhost:18080/login で `alice` / `password` を入れたあと、開発者ツールの **Application → Session Storage → http://www.lab.localhost:18080** に `samplestore.token` が入っているのを確かめます。タブを閉じて開き直すと消えています。

## 5. CCv2 / Composable Storefront ではどこに当たるか {#s5}

| ラボ | CCv2 / Composable Storefront で当たるもの |
| --- | --- |
| `POST /authorizationserver/oauth/token` | OAuth の認可サーバー(同じパス) |
| `client_id=storefront`(秘密の鍵なし) | 登録した OAuth のクライアント(Composable Storefront 用のクライアントを用意する)。ブラウザに置く値は秘密にならない前提で扱う |
| `ALLOWED_CLIENTS` | OAuth のクライアントの登録データ(ImpEx などで入れる) |
| `grant_type=password` | 以前の Composable Storefront の既定のログインの形(資格情報を送ってトークンをもらう)。新しい版(JDK 21 版の SAP Commerce Cloud と組み合わせる版)では、ログイン画面へ移って戻ってくる「認可コードフロー」に切り替える必要があります |
| `expires_in: 900` | クライアントごとのトークンの有効期限の設定 |
| `oauth_access_tokens` の表 | トークンの保存先(CCv2 でも DB に持つ。ただし JDK 21 版の認可サーバーのトークンは中身の入った JWT で、api 側は署名で確かめるので、ラボのように呼ばれるたびに DB を引くわけではありません) |
| sessionStorage の `samplestore.token` | Composable Storefront がブラウザに持つログイン状態(保存先は設定で変わる。案件で確かめる) |
| ingress の回数制限 | WAF・CDN やエンドポイントの手前での回数制限 |

## 6. よくある誤解 {#s6}

- **「ログインすると、サーバーがセッション(ログイン状態)を覚えている」** → ラボの api は、リクエストのたびにトークンを DB で照らし合わせるだけです。覚えているのは「トークンの指紋と期限」だけです。
- **「client_id は秘密の鍵」** → ブラウザで動くアプリに置いた値は、誰でも見られます。だから `storefront` は秘密の鍵(client_secret)を持たない「公開クライアント」として扱います。
- **「400 と 401 はどちらも『ログイン失敗』」** → 400 `invalid_grant` は「名前かパスワードが違う」、401 `invalid_client` は「そのアプリは登録されていない」、注文の API の 401 は「トークンが無い・無効・期限切れ」です。原因が違います。
- **「パスワードグラントは今でもふつうのやり方」** → いいえ。OAuth のセキュリティの決まり(RFC 9700)では「使ってはいけない」とされ、まとめ直し中の OAuth 2.1(まだ正式な RFC ではない草案)でも外されています。ラボは 1 リクエストで流れを見せるために使っているだけです。本番の設計では認可コードフロー(PKCE 付き)を選びます。
- **「トークンは長く使えるほうが便利」** → 盗まれたときに使われる時間も長くなります。ラボは 15 分にしています。
- **「ログインできたなら、他人の注文も番号を変えれば見られる」** → それは認可の穴(IDOR)です。トークンで「誰か」を決めたあと、「その注文の持ち主か」も確かめる必要があります。

## 7. 関係する演習と設計書 {#s7}

- 演習: [BE-1 API と認可の事故(他人の注文が見える)](/exercises/04-be-api-and-authz)・[セキュリティ-2 ログインの連打を止める](/exercises/18-sec-rate-limit-login)・[ネットワーク-2 CORS と IP 制限](/exercises/08-nw-cors-and-ip)
- 設計書: [BE 方式 4.2 認証(OAuth パスワードグラント)](/design/architecture/02-backend#s4-2)・[4.3 認可](/design/architecture/02-backend#s4-3)・[FE 方式 4.5 ログインの印の置き場所](/design/architecture/01-frontend#s4-5)・[セキュリティ方式 4.3 レート制限](/design/architecture/10-security#s4-3)・[4.6 秘密情報とパスワード](/design/architecture/10-security#s4-6)・[4.8 OAuth のクライアントとトークン](/design/architecture/10-security#s4-8)・[D-BE 注文 API と認可](/design/detail/D-BE-orders-api)
- 前後のページ: [仕組み-6 api(OCC)](./06-api-occ) ・ [仕組み-8 aspect と worker](./08-aspects-and-worker)
