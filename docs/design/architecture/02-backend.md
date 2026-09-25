# BE 方式設計書(ラボ)

版: 1.0 / 親: [全体方式](/design/architecture/00-overall) / 対象: api(Node.js 24 + Express 5 + PostgreSQL 17)

::: tip 3 行まとめ(この文書で決めたこと)
- ログインは JWT(有効 15 分)。注文は「ログインしているか」だけでなく「**その注文の持ち主か**」を毎回確かめ、違えば 404 を返す。
- SQL は値をプレースホルダで渡す。エラーの中身(SQL など)は外に見せない。
- 「生きているか」(`/healthz`)と「仕事を受けられるか」(`/readyz`、DB を見る)を分け、止める合図には受付中の処理を終えてから止まる。
:::

## 0. 位置づけ {#s0}
全体方式の「わざと壊すスイッチを組み込む」「ログと指標の形をそろえる」を受けて、API の作り方を決めます。
配下: [D-BE 注文 API と認可](/design/detail/D-BE-orders-api)。

## 1. 目的と範囲 {#s1}
- **含む**: API の一覧と形、認証、認可、SQL の書き方、エラーの返し方、ヘルスチェック、DB 接続、停止の仕方。
- **含まない**: 注文の作成・決済(ラボには無い)、バッチ。

## 2. 前提 {#s2}
| 前提 | 内容 |
| --- | --- |
| 部品 | Node.js 24、Express 5、pg、prom-client、pino(JSON ログ)、jsonwebtoken |
| データ | 起動時にテーブルを作り、空なら見本データを入れる(商品 30 件、会員 `alice`・`bob`・`carol`、注文 8 件)。何度起動しても同じ結果 |
| 前段 | edge の後ろにいる(`trust proxy` を有効にして、送り元の IP を `X-Forwarded-For` から取る) |

## 3. 全体像 {#s3}
| メソッドとパス | 役目 | ログイン | 壊すスイッチの影響 |
| --- | --- | --- | --- |
| `GET /api/products`(`?q=`) | 商品一覧・検索 | 不要 | latencyMs・errorRate・leakMb・sqliBug |
| `GET /api/products/:id` | 商品詳細 | 不要 | latencyMs・errorRate・leakMb |
| `POST /api/login` | ログイン → JWT | 不要 | latencyMs・errorRate・leakMb |
| `GET /api/me/orders` | 自分の注文一覧 | 必要 | latencyMs・errorRate・leakMb |
| `GET /api/orders/:orderId` | 注文詳細 | 必要 | 上の 3 つ + idorBug |
| `GET /healthz`・`GET /readyz`・`GET /metrics` | 見守り用 | 不要 | 受けない |
| `GET・POST /admin/chaos` | 壊すスイッチ | 不要(edge で社内からだけ) | — |

## 4. 決定事項 {#s4}
### 4.1 API の形 {#s4-1}
| 項目 | 内容 |
| --- | --- |
| 決定 | 入出力は JSON。受け取る JSON は 100kb まで。ID は正の整数でなければ 400。見つからなければ 404。エラーは `{ error, message }` の形 |
| 理由 | 画面側が「何が返るか」を決めて作れる。巨大な入力でサーバーが固まるのを防ぐ |
| 却下した案 | 形を決めずに返す: 画面側が想定しない形で壊れる |
| 実物 | [server.js](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/apps/api/src/server.js#L114-L127) |

### 4.2 認証 {#s4-2}
| 項目 | 内容 |
| --- | --- |
| 決定 | `POST /api/login` が成功したら JWT(HS256、有効 15 分)を返す。以降は `Authorization: Bearer <JWT>` で送る。無い・壊れている・期限切れは 401。失敗が続いてもロックはしない(回数の制限は edge のレート制限で行う) |
| 理由 | 有効期限を短くして、盗まれたときの被害の時間を限る。ロックは「他人の会員名で失敗を重ねて締め出す」嫌がらせにも使われるので、ラボでは入口の回数制限で見せる |
| 却下した案 | 期限なしのトークン: 盗まれたら永遠に使える |
| 実物 | [server.js](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/apps/api/src/server.js#L66-L88) |

### 4.3 認可 {#s4-3}
| 項目 | 内容 |
| --- | --- |
| 決定 | 注文詳細は、ログインしていることに加えて、**注文の持ち主と JWT の利用者が同じか**を確かめる。違えば「存在しない」と同じ 404 を返す(他人の注文があること自体を教えない) |
| 理由 | 番号を 1 つずつ変えるだけで他人の注文が見える事故(IDOR)を防ぐ。403 を返すと「その番号の注文はある」と教えてしまう |
| 却下した案 | 画面にリンクを出さないだけ: API を直接呼べば見えてしまう。画面の出し分けは守りに数えない |
| 実物 | [server.js](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/apps/api/src/server.js#L190-L214)(`idorBug=true` で確かめを外せる) |

### 4.4 SQL の書き方 {#s4-4}
| 項目 | 内容 |
| --- | --- |
| 決定 | 値は必ずプレースホルダ(`$1`)で渡す。文字列の連結で SQL を作らない |
| 理由 | 入力が SQL の命令として読まれない(SQL インジェクションを防ぐ) |
| 却下した案 | 入力の特殊文字を自分で消す: 抜けが出る。WAF に任せる: WAF は入口の網で、すり抜けもある。アプリの書き方が本命 |
| 実物 | [server.js](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/apps/api/src/server.js#L94-L112)(`sqliBug=true` で連結に切り替わる) |

### 4.5 エラーの返し方 {#s4-5}
| 項目 | 内容 |
| --- | --- |
| 決定 | 予期しない例外は、ログに `message` と `code` を残し、利用者には `{"error":"internal_error"}` だけを返す。製品名を教える `X-Powered-By` も消す |
| 理由 | SQL 文やファイルの場所は攻撃の手がかりになる |
| 実物 | [server.js](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/apps/api/src/server.js#L240-L248) |

### 4.6 ヘルスチェック {#s4-6}
| 項目 | 内容 |
| --- | --- |
| 決定 | `/healthz` はプロセスが応えられるかだけを見る(DB を見ない)。`/readyz` は DB に `SELECT 1` を送り、届かなければ 503 |
| 理由 | DB が落ちただけで api を再起動しても直らない。「再起動する基準」と「客を送らない基準」を分ける |
| 実物 | [server.js](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/apps/api/src/server.js#L43-L57) |

### 4.7 DB への接続 {#s4-7}
| 項目 | 内容 |
| --- | --- |
| 決定 | 接続は最大 10 本(`PG_POOL_MAX`)。接続を待つのは 3 秒まで、1 つの SQL は 5 秒まで。パスワードは scrypt でハッシュにして保存 |
| 理由 | DB が遅いときに API の待ち行列が伸び続けて固まるのを防ぐ |
| 実物 | [db.js](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/apps/api/src/db.js#L5-L36) |

### 4.8 穏やかな停止 {#s4-8}
| 項目 | 内容 |
| --- | --- |
| 決定 | `SIGTERM` を受けたら新しい接続を断り、受付中の処理を終えて DB の接続を閉じてから止まる。最大 10 秒で打ち切る |
| 理由 | 入れ替え(ローリング更新)のたびに処理中のリクエストを失敗させない |
| 実物 | [server.js](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/apps/api/src/server.js#L271-L278) |

## 5. 目標 {#s5}
| 項目 | 目標 | 根拠 |
| --- | --- | --- |
| 成功率 | 1 か月 99.9%(5xx 以外 ÷ 全体) | [SRE 方式 4.2](/design/architecture/05-sre#s4-2) |
| トークンの寿命 | 15 分 = 900 秒 | `JWT_TTL_SECONDS = 15 * 60` |
| 他人の注文 | 見える件数 0(持ち主でなければ 404) | [D-BE 注文 API](/design/detail/D-BE-orders-api) |

## 6. 配下の詳細設計書 {#s6}
- [D-BE 注文 API と認可](/design/detail/D-BE-orders-api)

## 7. 未決事項 {#s7}
| # | 内容 |
| --- | --- |
| 1 | トークンの取り消し(ログアウトしたトークンを期限前に無効にする仕組み)を入れるか |
| 2 | 同じ会員名への失敗が続いたときの通知(ロックではなく、本人へのお知らせ) |

## 8. レビュー観点 {#s8}
- [ ] 本人のデータを返す API すべてで、持ち主を確かめているか(ログイン確認だけで終わっていないか)
- [ ] 持ち主でないとき、403 ではなく 404 を返しているか(存在を教えない)
- [ ] 文字列の連結で SQL を作っている所が無いか
- [ ] 500 の応答に SQL やスタックトレースが出ていないか
- [ ] `/healthz` が DB を見ていないか(見ていると DB 障害で全台が再起動する)

## この設計を体験する演習 {#exercises}
- [BE-1 API と認可の事故(他人の注文が見える)](/exercises/04-be-api-and-authz)
- [セキュリティ-1 WAF が攻撃を止める](/exercises/17-sec-waf)(SQL インジェクション)
- [インフラ-1 止めずに版を上げる](/exercises/05-infra-rolling-update)(ヘルスチェックと穏やかな停止)
