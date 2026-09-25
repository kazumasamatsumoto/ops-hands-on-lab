# D-BE 注文 API と認可

版: 1.0 / 親: [BE 方式](/design/architecture/02-backend) / 対象: `POST /api/login`・`GET /api/me/orders`・`GET /api/orders/:orderId`

::: tip 3 行まとめ(この文書で決めたこと)
- ログインで JWT(HS256、15 分)を渡し、注文の API は `Authorization: Bearer` の JWT を必須にする。
- 注文詳細は「持ち主 = JWT の利用者」のときだけ返す。違えば、存在しないときと同じ 404。
- 演習用の `idorBug=true` はこの確かめを外す(他人の注文が見える)。そのときは警告のログを必ず出す。
:::

## 0. 親の方式設計書 {#s0}
| 項目 | 内容 |
| --- | --- |
| 親 | [BE 方式](/design/architecture/02-backend) |
| 引き継ぐ決定 | 4.1 API の形、4.2 認証、4.3 認可、4.5 エラーの返し方 |
| またがる層 | [FE 方式 4.5](/design/architecture/01-frontend#s4-5)(JWT の置き場所)、[セキュリティ方式 4.3](/design/architecture/10-security#s4-3)(ログインの回数制限)、[QA 方式 4.1](/design/architecture/06-qa#s4-1)(権限のテスト) |

## 1. 目的と範囲 {#s1}
- **目的**: 会員が自分の注文だけを見られるようにする。
- **含む**: 3 つの API の入出力、認証と認可の手順、エラー、ログ。
- **含まない**: 注文の作成・キャンセル。

## 2. 前提 {#s2}
| 前提 | 内容 |
| --- | --- |
| データ | `orders`(id・user_id・status・total・created_at)、`order_items`(order_id・product_id・quantity・unit_price)、`users`(id・username・display_name・password_hash) |
| 見本 | alice 3 件、bob 2 件、carol 3 件の注文(計 8 件)。番号は作られた順 |
| 実物 | [db.js](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/apps/api/src/db.js#L38-L67)・[server.js](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/apps/api/src/server.js#L129-L214) |

## 3. 全体像 {#s3}
```text
POST /api/login {username, password}
  → 会員を探す → scrypt で比べる → OK: JWT(sub=会員 ID, username, 15 分)/ NG: 401
GET /api/orders/:orderId  (Authorization: Bearer <JWT>)
  → JWT を確かめる(無い・壊れ・期限切れ → 401)
  → 番号が正の整数か(違う → 400)
  → 注文を読む(無い → 404)
  → 持ち主 = JWT の sub か(違う → 404)… idorBug=true のときだけ飛ばす
  → 200 注文
```

## 4. 仕様 {#s4}
### 4.1 POST /api/login {#s4-1}
| 項目 | 内容 |
| --- | --- |
| 入力 | `{"username": "alice", "password": "password"}`(本文は 100kb まで) |
| 成功 200 | `{"token": "<JWT>", "tokenType": "Bearer", "expiresIn": 900, "user": {"id", "username", "displayName"}}` |
| 400 | username か password が文字列でない |
| 401 | 会員が無い、またはパスワードが違う(どちらかは教えない)。ログに `ログイン失敗` と会員名(warn) |
| ロック | しない(回数の制限は edge で IP ごとに 1 秒 1 回・バースト 5) |

### 4.2 GET /api/me/orders {#s4-2}
| 項目 | 内容 |
| --- | --- |
| 認証 | 必須 |
| 動き | JWT の利用者の注文を、新しい順に並べて返す |
| 成功 200 | 注文の配列(4.3 と同じ形) |

### 4.3 GET /api/orders/:orderId {#s4-3}
| 状態 | 条件 | 本文 |
| --- | --- | --- |
| 200 | 持ち主が本人 | `{"id", "userId", "username", "status", "total", "createdAt", "items": [{"productId", "name", "qty", "price"}]}` |
| 400 | 番号が正の整数でない | `{"error":"bad_request","message":"注文 ID は正の整数です"}` |
| 401 | JWT が無い・壊れている・期限切れ | `{"error":"unauthorized", ...}` |
| 404 | 注文が無い、**または持ち主が別の人** | `{"error":"not_found","message":"注文が見つかりません"}`(同じ本文) |

実物: [server.js L190-L214](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/apps/api/src/server.js#L190-L214)

### 4.4 認証の確かめ方 {#s4-4}
| 項目 | 内容 |
| --- | --- |
| 形 | `Authorization: Bearer <JWT>` |
| 署名 | HS256 のみ受け付ける(他の方式を指定したトークンは拒否) |
| 鍵 | 環境変数 `JWT_SECRET`(ラボは見本の値) |
| 期限 | 900 秒(15 分) |
| 実物 | [server.js L64-L88](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/apps/api/src/server.js#L64-L88) |

### 4.5 演習用のスイッチ `idorBug` {#s4-5}
| 項目 | 内容 |
| --- | --- |
| 切り替え | `tools/chaos.sh set idorBug=true`(起動時は `CHAOS_IDOR_BUG`) |
| 動き | 持ち主の確かめを飛ばして、他人の注文も 200 で返す |
| ログ | 他人の注文を返すたびに `chaos: 他人の注文を返します`(warn、見た人・持ち主・番号つき) |
| 戻す | `tools/chaos.sh reset` |

## 5. 目標と確認方法 {#s5}
| 項目 | 目標 | 確かめ方 |
| --- | --- | --- |
| 本人の注文 | 200 | alice でログインし、alice の注文番号を開く |
| 他人の注文 | 404(見える件数 0) | bob でログインし、alice の注文番号を開く |
| 未ログイン | 401 | JWT を付けずに開く |
| 期限 | 15 分で 401 | `expiresIn` が 900 |

## 6. 関連する文書 {#s6}
- [D-SEC-01 WAF とレート制限](/design/detail/D-SEC-01-waf-and-rate-limit)(ログインの回数制限)
- [D-QA-04 E2E テスト](/design/detail/D-QA-04-e2e)(権限の確認)

## 7. 未決事項 {#s7}
| # | 内容 |
| --- | --- |
| 1 | 注文番号が連番なので、推測されやすい。番号を推測しにくい形(ランダムな ID)にするか |
| 2 | ログアウトしたトークンを期限前に使えなくする仕組み |

## 8. レビュー観点 {#s8}
- [ ] 本人のデータを返すすべての API で、持ち主を確かめているか
- [ ] 持ち主でないとき、「無い」ときと同じ応答か
- [ ] ログイン失敗の理由(会員が無いのか、パスワードが違うのか)を教えていないか
- [ ] トークンの方式(HS256)を固定しているか
- [ ] 他人のデータを返したことがログに残るか

## この設計を体験する演習 {#exercises}
- [BE-1 API と認可の事故(他人の注文が見える)](/exercises/04-be-api-and-authz)
- [セキュリティ-2 ログインの連打を止める](/exercises/18-sec-rate-limit-login)
