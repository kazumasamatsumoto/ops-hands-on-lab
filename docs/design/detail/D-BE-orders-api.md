# D-BE 注文 API と認可

版: 2.0 / 親: [BE 方式](/design/architecture/02-backend) / 対象: `POST /authorizationserver/oauth/token`・`GET /occ/v2/samplestore/users/current/orders`・`GET /occ/v2/samplestore/users/current/orders/{code}`

::: tip 3 行まとめ(この文書で決めたこと)
- ログインは OAuth のパスワードグラントです。公開クライアント `storefront` から名前とパスワードを送ると、15 分(900 秒)有効のアクセストークンが返ります。注文の API は `Authorization: Bearer <トークン>` を必須にします。
- URL に会員 ID を書かせず `users/current`(トークンの持ち主)で本人を決めます。注文 1 件は「持ち主 = トークンの持ち主」のときだけ返し、違えば、存在しないときと同じ 404 にします。
- 注文とトークンの返事には `Cache-Control: no-store` を付け、前段にためさせません。演習用の `idorBug=true` はこの確かめを外し(他人の注文が見える)、そのときは警告のログを必ず出します。
:::

## 0. 親の方式設計書 {#s0}
| 項目 | 内容 |
| --- | --- |
| 親 | [BE 方式](/design/architecture/02-backend) |
| 引き継ぐ決定 | 4.1 API の形(OCC 風)、4.2 認証、4.3 認可、4.5 エラーの返し方 |
| またがる層 | [FE 方式 4.5](/design/architecture/01-frontend#s4-5)(トークンの置き場所)、[セキュリティ方式 4.3](/design/architecture/10-security#s4-3)(ログインの回数制限)・[4.8](/design/architecture/10-security#s4-8)(OAuth)、[ネットワーク方式 4.5](/design/architecture/04-network#s4-5)(CORS)、[QA 方式 4.1](/design/architecture/06-qa#s4-1)(権限のテスト) |

## 1. 目的と範囲 {#s1}
- **目的**: 会員が自分の注文だけを見られるようにする。
- **含む**: トークンの発行・取り消し、2 つの注文 API の入出力、認証と認可の手順、CORS、エラー、ログ。
- **含まない**: 注文の作成・キャンセル。トークンの自動延長(リフレッシュ)。

## 2. 前提 {#s2}
| 前提 | 内容 |
| --- | --- |
| 動く場所 | api aspect(`ASPECT=api`)。外からは `http://api.lab.localhost:18080`(cdn-waf → ingress → api)。CCv2 の api aspect と OAuth の認可サーバーに当たります |
| データ | `users`(id・uid・name・password_hash)、`orders`(code・user_id・status・total・placed)、`order_entries`(order_code・entry_number・product_code・quantity・base_price)、`oauth_access_tokens`(token_hash・client_id・user_id・expires_at) |
| 見本 | 会員 `alice`・`bob`・`carol`(パスワード `password`)。注文 8 件 `00001001`〜`00001008`(alice 3・bob 2・carol 3) |
| 実物 | [oauth.js](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/apps/api/src/occ/oauth.js)・[orders.js](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/apps/api/src/occ/orders.js)・[cors.js](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/apps/api/src/occ/cors.js)・[aspects/api.js](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/apps/api/src/aspects/api.js)・[db.js](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/apps/api/src/db.js) |

## 3. 全体像 {#s3}
```text
POST /authorizationserver/oauth/token   (application/x-www-form-urlencoded)
  grant_type=password&client_id=storefront&username=alice&password=password
  → grant_type が password か(違う → 400 unsupported_grant_type)
  → client_id が storefront か(違う → 401 invalid_client)
  → 会員を探す → scrypt で比べる(違う → 400 invalid_grant)
  → ランダムな 32 バイトのトークンを作り、SHA-256 の値と期限(15 分)だけを DB に保存
  → 200 {access_token, token_type:"bearer", expires_in:900, scope:"basic"}

GET /occ/v2/samplestore/users/current/orders/{code}   (Authorization: Bearer <トークン>)
  → トークンの SHA-256 で DB を引く(無い・知らない・期限切れ → 401)
  → 注文を読む(無い → 404)
  → 持ち主 = トークンの持ち主か(違う → 404)… idorBug=true のときだけ飛ばす
  → 200 注文
```

ブラウザ(`http://www.lab.localhost:18080` の画面)から呼ぶと、api は別のオリジンです。`Authorization` ヘッダを付けるので、ブラウザは本番の前に `OPTIONS` の下見(プリフライト)を送ります(4.5)。

## 4. 仕様 {#s4}
### 4.1 POST /authorizationserver/oauth/token {#s4-1}
| 項目 | 内容 |
| --- | --- |
| 入力 | フォームの形(`application/x-www-form-urlencoded`、10kb まで)。`grant_type=password`・`client_id=storefront`・`username`・`password` |
| 成功 200 | `{"access_token":"…","token_type":"bearer","expires_in":900,"scope":"basic"}`。`Cache-Control: no-store`・`Pragma: no-cache` |
| 400 `unsupported_grant_type` | `grant_type` が `password` でない |
| 401 `invalid_client` | 登録されていないクライアント(`storefront` 以外)。`storefront` はブラウザで動く公開クライアントなので `client_secret` は持たない |
| 400 `invalid_request` | `username` か `password` が無い |
| 400 `invalid_grant` | 会員が無い、またはパスワードが違う(どちらかは教えない)。ログに `ログイン失敗` と会員名(warn) |
| ロック | しない。回数の制限は ingress で IP ごとに 1 秒 1 回・バースト 5(超えたら 429)([D-SEC-01](/design/detail/D-SEC-01-waf-and-rate-limit)) |
| 取り消し | `POST /authorizationserver/oauth/revoke`(`token=...`)。そのトークンを DB から消す(ログアウト用) |

エラーの形は OAuth の決まりに合わせ `{"error":"invalid_grant","error_description":"…"}` です。

### 4.2 GET /occ/v2/samplestore/users/current/orders {#s4-2}
| 項目 | 内容 |
| --- | --- |
| 認証 | 必須(`Authorization: Bearer <トークン>`) |
| 動き | トークンの持ち主の注文を、新しい順に並べて返す |
| 成功 200 | `{"orders":[…], "pagination":{currentPage, pageSize, totalPages, totalResults}}`。注文の形は 4.3 と同じ |
| ヘッダ | `Cache-Control: no-store` |

### 4.3 GET /occ/v2/samplestore/users/current/orders/{code} {#s4-3}
| 状態 | 条件 | 本文 |
| --- | --- | --- |
| 200 | 持ち主が本人 | `{"code","placed","status","statusDisplay","total":{currencyIso,value,formattedValue},"user":{uid,name},"entries":[{"entryNumber","product":{code,name,url},"quantity","basePrice","totalPrice"}]}` |
| 401 | トークンが無い(`UnauthorizedError`)・知らない・期限切れ(`InvalidTokenError`) | `{"errors":[{"type":"UnauthorizedError" または "InvalidTokenError","message":"…"}]}` |
| 404 | 注文が無い、**または持ち主が別の人** | `{"errors":[{"type":"UnknownIdentifierError","message":"注文が見つかりません"}]}`(同じ本文) |

返事にはどの場合も `Cache-Control: no-store` を付けます。cdn-waf は `Authorization` があるリクエストを最初からためませんが、ヘッダでも二重に止めます。

### 4.4 認証の確かめ方 {#s4-4}
| 項目 | 内容 |
| --- | --- |
| 形 | `Authorization: Bearer <トークン>`(大文字小文字は問わない) |
| トークンの中身 | 中身の無いランダムな文字列(JWT ではない)。署名の鍵は要らない |
| 保存 | DB には SHA-256 の値・クライアント・持ち主・期限だけ。トークンそのものは保存しない(DB が漏れても使えない) |
| 期限 | 900 秒(15 分)。期限切れから 1 時間たった行は、トークンを発行するたびに少しずつ消す |
| 台数 | 保存先が DB なので、api を何台にしても同じトークンが通る |
| 置き場所(storefront) | ブラウザのメモリと sessionStorage(タブを閉じると消える)。サーバーには置かない |

### 4.5 演習用のスイッチ `idorBug` {#s4-5}
| 項目 | 内容 |
| --- | --- |
| 切り替え | `tools/chaos.sh set idorBug=true`(起動時は `CHAOS_IDOR_BUG`) |
| 動き | ログインしているかは見るが、持ち主の確かめを飛ばして他人の注文も 200 で返す |
| ログ | 他人の注文を返すたびに `chaos: 他人の注文を返します`(warn、見た人・持ち主・番号つき) |
| 戻す | `tools/chaos.sh reset` |

### 4.6 CORS(ブラウザから呼ぶとき) {#s4-6}
| 項目 | 内容 |
| --- | --- |
| 許すオリジン | `CORS_ALLOWED_ORIGINS`(既定 `http://www.lab.localhost:18080`)。CCv2 の corsfilter の設定に当たる |
| 下見(OPTIONS) | 許すオリジンなら 204 と `Access-Control-Allow-Methods`・`Access-Control-Allow-Headers: Authorization, Content-Type, traceparent, tracestate, X-Request-Id`・`Access-Control-Max-Age: 600`。許さないオリジンなら 403 `CorsError` |
| 本番の返事 | 許すオリジンのときだけ `Access-Control-Allow-Origin` を返す。`Vary: Origin` は常に付ける |
| 注意 | CORS はブラウザを守る仕組みで、curl などからの呼び出しは止めない。認可の代わりにはならない |

## 5. 目標と確認方法 {#s5}
| 項目 | 目標 | 確かめ方 |
| --- | --- | --- |
| 本人の注文 | 200 | alice のトークンで `/users/current/orders/00001001` |
| 他人の注文 | 404(見える件数 0) | bob のトークンで `/users/current/orders/00001001`(E2E の authz.spec.ts) |
| 未ログイン | 401 | トークンを付けずに開く |
| 期限 | 15 分で 401 | `expires_in` が 900 |
| 他のクライアント | 401 `invalid_client` | `client_id=other` で発行を頼む |
| CORS | www からは読め、別のオリジンからは読めない | `curl -sI -X OPTIONS -H 'Origin: http://www.lab.localhost:18080' -H 'Access-Control-Request-Method: GET' -H 'Access-Control-Request-Headers: authorization' http://api.lab.localhost:18080/occ/v2/samplestore/users/current/orders` が 204、`Origin: http://evil.example` なら 403 |

```bash
TOKEN=$(curl -s http://api.lab.localhost:18080/authorizationserver/oauth/token \
  -d 'grant_type=password&client_id=storefront&username=alice&password=password' | sed 's/.*"access_token":"\([^"]*\)".*/\1/')
curl -s -H "Authorization: Bearer $TOKEN" http://api.lab.localhost:18080/occ/v2/samplestore/users/current/orders
```

## 6. 関連する文書 {#s6}
- [D-SEC-01 WAF とレート制限](/design/detail/D-SEC-01-waf-and-rate-limit)(ログインの回数制限)
- [D-NW-01 cdn-waf と ingress の経路とキャッシュ](/design/detail/D-NW-01-edge-route)(注文とトークンはためない)
- [D-QA-04 E2E テスト](/design/detail/D-QA-04-e2e)(権限の確認)
- 仕組みの説明: [api(OCC・fields・CORS)](/how-it-works/06-api-occ)・[OAuth のトークン](/how-it-works/07-oauth-token)

## 7. 未決事項 {#s7}
| # | 内容 |
| --- | --- |
| 1 | 注文番号が連番なので、推測されやすい。番号を推測しにくい形(ランダムな ID)にするか |
| 2 | パスワードグラントは、利用者のパスワードをアプリが直接受け取る方式。OAuth 2.0 のセキュリティの最新の指針(RFC 9700)は使わないよう求めており、策定中の OAuth 2.1 では仕様から外されている。ラボでは仕組みを見やすくするために使っているだけで、本番の新しい作りでは認可コード(+ PKCE)の方式に切り替えるか |
| 3 | 15 分で切れたとき、利用者にもう一度ログインさせるか、リフレッシュトークンで延ばすか |

## 8. レビュー観点 {#s8}
- [ ] 本人のデータを返すすべての API で、持ち主を確かめているか(URL の ID ではなくトークンで本人を決めているか)
- [ ] 持ち主でないとき、「無い」ときと同じ応答か
- [ ] ログイン失敗の理由(会員が無いのか、パスワードが違うのか)を教えていないか
- [ ] トークンの返事と、本人のデータの返事に `no-store` が付いているか
- [ ] CORS の許可先が「全部」になっていないか
- [ ] 他人のデータを返したことがログに残るか

## この設計を体験する演習 {#exercises}
- [BE-1 API と認可の事故(他人の注文が見える)](/exercises/04-be-api-and-authz)
- [ネットワーク-2 CORS と IP 制限](/exercises/08-nw-cors-and-ip)
- [セキュリティ-2 ログインの連打を止める](/exercises/18-sec-rate-limit-login)
