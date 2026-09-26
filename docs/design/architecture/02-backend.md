# BE 方式設計書(ラボ)

版: 2.0 / 親: [全体方式](/design/architecture/00-overall) / 対象: api・backoffice・worker(Node.js 24 + Express 5 + PostgreSQL 17。1 つのイメージを `ASPECT` で使い分ける)

::: tip 3 行まとめ(この文書で決めたこと)
- 1 つのイメージを `ASPECT=api|backoffice|backgroundProcessing` で 3 役に分ける(CCv2 の aspect と同じ考え方)。外から呼ばれる API は OCC 風の `/occ/v2/samplestore/...`、ログインは OAuth のパスワードグラント(15 分のトークン)。
- 注文は「ログインしているか」だけでなく「**その注文の持ち主か**」を毎回確かめ、違えば 404 を返す。SQL は値をプレースホルダで渡し、エラーの中身は外に見せない。
- 定期ジョブ(在庫の取り込み・検索の索引の作り直し)は worker だけで動かし、最後の成功時刻を指標に出す。検索の実体は `SEARCH_PROVIDER=db|solr` で切り替える。
:::

## 0. 位置づけ {#s0}
全体方式の「CCv2 + ヘッドレスの形に寄せる」「わざと壊すスイッチを組み込む」「ログと指標の形をそろえる」を受けて、サーバー側の作り方を決めます。
配下: [D-BE 注文 API と認可](/design/detail/D-BE-orders-api)。

## 1. 目的と範囲 {#s1}
- **含む**: aspect の分け方、API の一覧と形(OCC 風・`fields`)、認証(OAuth)、認可、SQL の書き方、エラーの返し方、ヘルスチェック、DB 接続、停止の仕方、定期ジョブ、検索の実体、CORS の許可先。
- **含まない**: 注文の作成・カート・決済(ラボには無い)、複数のお店(baseSiteId は `samplestore` だけ)。

## 2. 前提 {#s2}
| 前提 | 内容 |
| --- | --- |
| 部品 | Node.js 24、Express 5、pg、prom-client、pino(JSON ログ)、OpenTelemetry(送り先があるときだけ) |
| データ | 表の作成と見本データの投入は `ASPECT=api` だけが行う(商品 30 件 `100001`〜`100030`、会員 `alice`・`bob`・`carol`、注文 8 件 `00001001`〜`00001008`、CMS のページ)。backoffice と worker は表ができるまで 2 秒ごとに待つ |
| 前段 | cdn-waf → ingress の後ろにいる(`trust proxy` を有効にして、送り元の IP を `X-Forwarded-For` から取る) |
| 住所 | 3 役ともポート 3001。外に出すのは ingress 経由の api(`api.lab.localhost`)と backoffice(`backoffice.lab.localhost`)だけ。worker は出さない |

## 3. 全体像 {#s3}
| メソッドとパス(ASPECT=api) | 役目 | ログイン | 壊すスイッチの影響 |
| --- | --- | --- | --- |
| `GET /occ/v2/samplestore/products/search?query=&currentPage=&pageSize=&sort=&fields=` | 商品検索 | 不要 | latencyMs・errorRate・leakMb・sqliBug |
| `GET /occ/v2/samplestore/products/{code}?fields=` | 商品 1 件 | 不要 | latencyMs・errorRate・leakMb |
| `GET /occ/v2/samplestore/cms/pages?pageType=...` | 画面の部品の並び(CMS) | 不要 | latencyMs・errorRate・leakMb |
| `POST /authorizationserver/oauth/token` | トークンの発行 | — | latencyMs・errorRate・leakMb |
| `POST /authorizationserver/oauth/revoke` | トークンの取り消し | — | 受けない |
| `GET /occ/v2/samplestore/users/current/orders` | 自分の注文一覧 | 必要 | latencyMs・errorRate・leakMb |
| `GET /occ/v2/samplestore/users/current/orders/{code}` | 注文 1 件 | 必要 | 上の 3 つ + idorBug |
| `GET /medias/{code}.svg` | 商品画像・バナー | 不要 | 受けない |
| `GET /healthz`・`GET /readyz`・`GET /metrics` | 見守り用 | 不要(`/readyz`・`/metrics` は ingress で外から閉じる) | 受けない |
| `GET・POST /admin/chaos` | 壊すスイッチ | 不要(ingress で外から閉じる) | — |

| ASPECT | 役割 | CCv2 で当たるもの | 外への出口 |
| --- | --- | --- | --- |
| `api` | 上の表 | api aspect | `api.lab.localhost` |
| `backoffice` | 管理画面 `/backoffice/`(価格・在庫・トップのバナー) | backoffice aspect | `backoffice.lab.localhost`(社内 IP だけ) |
| `backgroundProcessing` | 定期ジョブ `stockImportJob`・`searchIndexJob` | backgroundProcessing aspect | なし(`/healthz`・`/metrics` だけ中から) |

## 4. 決定事項 {#s4}
### 4.1 API の形(OCC 風) {#s4-1}
| 項目 | 内容 |
| --- | --- |
| 決定 | パスはすべて `/occ/v2/{baseSiteId}/...`、baseSiteId は `samplestore`。`fields` で返す量を 3 段階に分ける: `BASIC`(`code`・`name`・`url`・`price`)、`DEFAULT`(既定。+ `summary`・`images`・`stock`)、`FULL`(+ `description`・`categories`・`classifications`・`purchasable`)。失敗は OCC と同じ `{"errors":[{"type","message"}]}`(例: 無い商品は 404 `UnknownIdentifierError`)。受け取る JSON は 100kb まで、形が壊れていれば 400 `ValidationError` |
| 理由 | storefront や演習が、実案件の OCC と同じ URL・同じ形で呼べる。一覧は少なく、詳細は多く、と画面ごとに運ぶ量を選べる。巨大な入力でサーバーが固まるのを防ぐ |
| 却下した案 | 画面ごとに専用の API を作る: 画面が増えるたびに API も増え、ヘッドレスの「API は画面を知らない」が崩れる。常に全部返す: 一覧が重くなる([性能方式 4.7](/design/architecture/07-performance#s4-7)) |
| 実物 | [aspects/api.js](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/apps/api/src/aspects/api.js)・[occ/format.js](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/apps/api/src/occ/format.js)・[http-common.js](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/apps/api/src/http-common.js)(`sendError`) |

### 4.2 認証(OAuth パスワードグラント) {#s4-2}
| 項目 | 内容 |
| --- | --- |
| 決定 | `POST /authorizationserver/oauth/token` に `grant_type=password&client_id=storefront&username=&password=`(フォームの形)を送ると、`{access_token, token_type:"bearer", expires_in:900}` を返す。受けるクライアントは `storefront`(秘密の鍵を持たない公開クライアント)だけ。トークンは中身の無いランダムな文字列で、DB には SHA-256 の値・持ち主・期限だけを置く。以降は `Authorization: Bearer <トークン>`。無い・知らない・期限切れは 401。失敗が続いてもロックはしない(回数の制限は ingress で行う) |
| 理由 | 期限を 15 分にして、盗まれたときの被害の時間を限る。DB にハッシュだけを置くので、DB が漏れてもそのまま使えるトークンは出ない。api を何台にしても同じトークンが通る。ロックは「他人の会員名で失敗を重ねて締め出す」嫌がらせにも使われる |
| 却下した案 | 期限なしのトークン: 盗まれたら永遠に使える。署名付きの自己完結トークン(JWT): 取り消し(ログアウト)が難しく、署名鍵の管理も要る |
| 実物 | [occ/oauth.js](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/apps/api/src/occ/oauth.js) |

### 4.3 認可 {#s4-3}
| 項目 | 内容 |
| --- | --- |
| 決定 | 本人のデータは URL に会員 ID を書かせず、`users/current`(トークンの持ち主)で表す。注文 1 件は、ログインしていることに加えて、**注文の持ち主とトークンの持ち主が同じか**を確かめる。違えば「存在しない」と同じ 404 を返す |
| 理由 | 番号を 1 つずつ変えるだけで他人の注文が見える事故(IDOR)を防ぐ。403 を返すと「その番号の注文はある」と教えてしまう |
| 却下した案 | 画面にリンクを出さないだけ: API を直接呼べば見えてしまう。画面の出し分けは守りに数えない |
| 実物 | [occ/orders.js](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/apps/api/src/occ/orders.js)(`idorBug=true` で確かめを外せる) |

### 4.4 SQL の書き方 {#s4-4}
| 項目 | 内容 |
| --- | --- |
| 決定 | 値は必ずプレースホルダ(`$1`)で渡す。文字列の連結で SQL を作らない。検索の `LIKE` では `%` と `_` をただの文字として扱う |
| 理由 | 入力が SQL の命令として読まれない(SQL インジェクションを防ぐ) |
| 却下した案 | 入力の特殊文字を自分で消す: 抜けが出る。WAF に任せる: WAF は入口の網で、すり抜けもある。アプリの書き方が本命 |
| 実物 | [occ/search.js](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/apps/api/src/occ/search.js)(`sqliBug=true` で連結に切り替わる。`SEARCH_PROVIDER=solr` のときも DB の危ない検索になる) |

### 4.5 エラーの返し方 {#s4-5}
| 項目 | 内容 |
| --- | --- |
| 決定 | 予期しない例外は、ログに `message` と `code` を残し、利用者には `{"errors":[{"type":"InternalServerError", ...}]}` だけを返す。どのルートにも当たらなければ 404 `NotFoundError`。製品名を教える `X-Powered-By` も消す |
| 理由 | SQL 文やファイルの場所は攻撃の手がかりになる |
| 実物 | [http-common.js](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/apps/api/src/http-common.js)(`finishApp`) |

### 4.6 ヘルスチェック {#s4-6}
| 項目 | 内容 |
| --- | --- |
| 決定 | 3 役とも同じ。`/healthz` はプロセスが応えられるかだけを見る(DB を見ない)。`/readyz` は起動の準備(表の作成・待ち合わせ)が終わり、DB に `SELECT 1` が届くときだけ 200、それ以外は 503 |
| 理由 | DB が落ちただけで api を再起動しても直らない。「再起動する基準」と「客を送らない基準」を分ける |
| 実物 | [http-common.js](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/apps/api/src/http-common.js)・[main.js](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/apps/api/src/main.js) |

### 4.7 DB への接続 {#s4-7}
| 項目 | 内容 |
| --- | --- |
| 決定 | 接続は 1 プロセス最大 10 本(`PG_POOL_MAX`)。接続を待つのは 3 秒まで、1 つの SQL は 5 秒まで。待機中の接続が切れても落ちずにログに残し、次のリクエストで作り直す。会員のパスワードは scrypt でハッシュにして保存 |
| 理由 | DB が遅いときに API の待ち行列が伸び続けて固まるのを防ぐ。api・backoffice・worker の台数 × 10 本が DB の上限を超えないように見積もる |
| 実物 | [db.js](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/apps/api/src/db.js) |

### 4.8 穏やかな停止 {#s4-8}
| 項目 | 内容 |
| --- | --- |
| 決定 | `SIGTERM` を受けたら新しい接続を断り、受付中の処理を終え、定期ジョブのタイマーを止め、DB の接続を閉じ、送り残したトレースを送ってから止まる。最大 10 秒で打ち切る |
| 理由 | 入れ替え(ローリング更新)のたびに処理中のリクエストを失敗させない |
| 実物 | [http-common.js](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/apps/api/src/http-common.js)(`listen`) |

### 4.9 aspect で役割を分ける {#s4-9}
| 項目 | 内容 |
| --- | --- |
| 決定 | 1 つのイメージ(`lab/api:local`)を、環境変数 `ASPECT` で `api`・`backoffice`・`backgroundProcessing` の 3 役に分けて動かす。台数・メモリ・外への出口は役ごとに決める(manifest.json の `aspects[]`。p1 では api 2 台、backoffice 1 台、worker 1 台) |
| 理由 | 外から大量に呼ばれる api、社内だけの backoffice、画面を持たない定期ジョブは、混み方も守り方も違う。役を分けると、api だけ増やす・backoffice だけ社内に絞る・ジョブが api の応答を邪魔しない、ができる。イメージは 1 つなので、ビルドと配り方は 1 通りで済む |
| 却下した案 | 1 つのプロセスで全部やる: 定期ジョブの重さが API の応答に響き、管理画面も外に出てしまう。役ごとに別のアプリにする: 共通のコード(DB・ログ・指標)を 3 か所で持つことになる |
| 実物 | [main.js](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/apps/api/src/main.js)・[aspects/](https://github.com/kazumasamatsumoto/ops-hands-on-lab/tree/main/apps/api/src/aspects)・[manifest.json](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/manifest.json) |

### 4.10 定期ジョブ(worker) {#s4-10}
| 項目 | 内容 |
| --- | --- |
| 決定 | 定期ジョブは worker(`ASPECT=backgroundProcessing`)だけで動かす。`stockImportJob`(ランダムな 5 商品の在庫を −3〜+5 動かす = 基幹からの在庫連携の代わり)と `searchIndexJob`(`solr` のとき Solr の索引を全件作り直す。`db` のときは何もせず成功を記録)を `CRON_INTERVAL_SECONDS`(既定 60 秒)ごとに動かす。前の回が終わっていなければ今回は飛ばす。結果を `cronjob_runs_total{job,result}`・`cronjob_last_success_timestamp_seconds{job}`・`cronjob_duration_seconds{job}` に出す |
| 理由 | ジョブが止まっても画面は動き続けるので、在庫や検索が古くなるだけの「気づきにくい障害」になる。最後の成功時刻を出せば、止まりを数字で見張れる([SRE 方式 4.8](/design/architecture/05-sre#s4-8))。重なりを飛ばすと、遅いジョブが積み上がって DB を詰まらせない |
| 却下した案 | api の中でタイマーを回す: api を 2 台にすると同じジョブが 2 回動く。成功・失敗をログだけに出す: 止まったこと(何も出ないこと)に気づけない |
| 実物 | [aspects/worker.js](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/apps/api/src/aspects/worker.js)(`CHAOS_CRON_FAIL=true` で全部失敗させられる) |

### 4.11 検索の実体(db / Solr) {#s4-11}
| 項目 | 内容 |
| --- | --- |
| 決定 | 検索の実体を `SEARCH_PROVIDER` で切り替える。`db`(軽量版の既定): PostgreSQL の `ILIKE` で名前・短い説明・分類名を探す。`solr`(本格版): Solr のコア `products` を `SOLR_URL`(既定 `http://search:8983/solr/products`)で引く。日本語は CJK バイグラムで切り、全角・半角の違いを吸収する。どちらでも返す JSON の形は同じで、応答ヘッダ `X-Search-Provider` で実体が分かる。Solr に届かないときは検索だけ 503 `SearchUnavailableError`(商品詳細・CMS は DB から読むので動き続ける) |
| 理由 | storefront は検索の裏側を知らなくてよい。軽量版はメモリを抑え、本格版は CCv2 と同じく検索を DB から外した形にする。検索サーバーが落ちても、買い物の他の部分は止めない |
| 却下した案 | 本格版でも DB で検索: 商品が増えると `LIKE` の全件なめで DB が詰まる([性能方式 4.8](/design/architecture/07-performance#s4-8))。Solr が落ちたら全部 500: 検索以外まで巻き込む |
| 実物 | [occ/search.js](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/apps/api/src/occ/search.js)・[solr.js](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/apps/api/src/solr.js)・[solr/products/conf/](https://github.com/kazumasamatsumoto/ops-hands-on-lab/tree/main/apps/api/solr/products/conf) |

## 5. 目標 {#s5}
| 項目 | 目標 | 根拠 |
| --- | --- | --- |
| 成功率 | 1 か月 99.9%(5xx 以外 ÷ 全体) | [SRE 方式 4.2](/design/architecture/05-sre#s4-2) |
| トークンの寿命 | 15 分 = 900 秒 | `TOKEN_TTL_SECONDS = 900` |
| 他人の注文 | 見える件数 0(持ち主でなければ 404) | [D-BE 注文 API](/design/detail/D-BE-orders-api) |
| 定期ジョブ | 最後の成功から 300 秒以内 | `cronjob_last_success_timestamp_seconds` |
| 検索の反映の遅れ(solr) | 最大 `CRON_INTERVAL_SECONDS`(60 秒) | `searchIndexJob` の間隔 |

## 6. 配下の詳細設計書 {#s6}
- [D-BE 注文 API と認可](/design/detail/D-BE-orders-api)

## 7. 未決事項 {#s7}
| # | 内容 |
| --- | --- |
| 1 | 索引を全件作り直すのではなく、変わった商品だけを入れ直すか(商品が増えると全件は重い) |
| 2 | 同じ会員名への失敗が続いたときの通知(ロックではなく、本人へのお知らせ) |
| 3 | 注文を作る API(カート・注文確定)を足すか。足すと書き込みの負荷試験と冪等性の設計が要る |

## 8. レビュー観点 {#s8}
- [ ] 本人のデータを返す API すべてで、持ち主を確かめているか(ログイン確認だけで終わっていないか)
- [ ] 持ち主でないとき、403 ではなく 404 を返しているか(存在を教えない)
- [ ] 文字列の連結で SQL を作っている所が無いか
- [ ] 500 の応答に SQL やスタックトレースが出ていないか
- [ ] `/healthz` が DB を見ていないか(見ていると DB 障害で全台が再起動する)
- [ ] 定期ジョブが 1 か所(worker)でだけ動き、最後の成功時刻が見張られているか
- [ ] トークンの受け付け先(クライアント)と寿命が決まっていて、DB に生のトークンを置いていないか

## この設計を体験する演習 {#exercises}
- [BE-1 API と認可の事故(他人の注文が見える)](/exercises/04-be-api-and-authz)
- [セキュリティ-1 WAF が攻撃を止める](/exercises/17-sec-waf)(SQL インジェクション)
- [インフラ-1 止めずに版を上げる](/exercises/05-infra-rolling-update)(ヘルスチェックと穏やかな停止)
- [ヘッドレス-1 CMS の JSON が画面になるまで](/exercises/21-headless-cms)(CMS の API)
