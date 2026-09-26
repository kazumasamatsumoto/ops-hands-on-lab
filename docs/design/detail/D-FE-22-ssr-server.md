# D-FE-22 SSR サーバー(server.ts)

版: 2.0 / 親: [FE 方式](/design/architecture/01-frontend) / 対象: [apps/web/src/server.ts](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/apps/web/src/server.ts)

::: tip 3 行まとめ(この文書で決めたこと)
- storefront の Express サーバー(CCv2 の JS Storefront の SSR サーバーに当たります)は、「ファイルを配る」「画面の HTML を作る」「ブラウザに api の外向きの住所を教える」「運用の口(/healthz・/metrics・ログ・トレース)を出す」の 4 つをします。
- SSR は `SSR_TIMEOUT_MS`(既定 3000)で打ち切って空の HTML(`Cache-Control: no-store`)を返し、`ssr_fallback` をログと指標に残します。例外なら 500 の画面を返し `ssr_errors_total` を増やします。
- 返す HTML には必ず `<html data-render-mode>` と `<meta name="api-public-url">` を書き足し、応答ヘッダ `X-Render-Mode` で誰が描いたかを示します。止める合図には、受付中の処理を終えてから止まります(最大 10 秒)。
:::

## 0. 親の方式設計書 {#s0}
| 項目 | 内容 |
| --- | --- |
| 親 | [FE 方式](/design/architecture/01-frontend) |
| 引き継ぐ決定 | 4.1 描画方式、4.3 SSR のタイムアウトと逃げ道、[4.7 api の住所](/design/architecture/01-frontend#s4-7) |
| またがる層 | [SRE 方式 4.4](/design/architecture/05-sre#s4-4)(フォールバック率のアラート)、[SRE 方式 4.9](/design/architecture/05-sre#s4-9)(トレース)、[障害対応方式 4.2](/design/architecture/08-incident-response#s4-2) |

## 1. 目的と範囲 {#s1}
- **含む**: 環境変数、口(パス)ごとの動き、SSR の打ち切り、HTML に書き足す印、指標、ログ、トレース、停止。
- **含まない**: 画面の中身(各画面の詳細設計書と [D-FE-05](/design/detail/D-FE-05-headless-cms))。

## 2. 前提 {#s2}
| 前提 | 内容 |
| --- | --- |
| ポート | 4000(Service 名・compose のサービス名は `storefront`) |
| 前段 | cdn-waf → ingress(www.lab.localhost)の後ろにいる。前段が付ける `X-Forwarded-For`・`X-Forwarded-Host`・`X-Forwarded-Port`・`X-Forwarded-Proto` を信じるよう `trustProxyHeaders` に登録する(登録しないと Angular が安全のため CSR に切り替える) |
| Host の許可 | Angular SSR は知らない Host ヘッダを 400 で断る。`angular.json` の `allowedHosts` と環境変数 `NG_ALLOWED_HOSTS`(compose・manifest とも `www.lab.localhost,storefront,localhost,127.0.0.1`)で許す |
| イメージ | `node:24.21.0-bookworm-slim` から作る `lab/web:local`。ヘルスチェックは `/healthz`(10 秒ごと、3 回) |

## 3. 全体像(口ごとの動き) {#s3}
| 順 | パス | 動き |
| --- | --- | --- |
| 1 | すべて | 1 リクエスト 1 行のログと指標。画面のリクエストにはトレースの区間を作る(`/metrics`・`/healthz` はログに出さない) |
| 2 | `GET /healthz` | `{"status":"ok"}` |
| 3 | `GET /metrics` | Prometheus 用の指標(外からは ingress が 403 にする) |
| 4 | 静的ファイル | JS・CSS など。名前に内容のハッシュが入るので 1 年キャッシュしてよいと返す |
| 5 | 画面(GET・HEAD) | `RENDER_MODE=csr` なら空の HTML。SSR なら 4.2 の流れ |

第 1 版にあった「`/api/*` の予備の中継」はありません。ブラウザは api を別のホスト名(`api.lab.localhost`)で直接呼びます。

## 4. 仕様 {#s4}
### 4.1 環境変数 {#s4-1}
| 名前 | 既定 | 意味 |
| --- | --- | --- |
| `PORT` | `4000` | 待ち受けるポート |
| `RENDER_MODE` | `ssr` | `csr` にすると、どの画面もサーバーでは描かず空の HTML を返す |
| `SSR_TIMEOUT_MS` | `3000` | SSR をあきらめるまでの時間(0 以下や数でない値なら 3000) |
| `SSR_WINDOW_BUG` | `false` | `true` でサーバー側の描画が `window` を触って 500 になる(演習用) |
| `API_INTERNAL_URL` | `http://api:3001` | サーバー(SSR 中)から見た api の住所。コンテナ同士の内側の近道 |
| `API_PUBLIC_URL` | `http://api.lab.localhost:18080` | ブラウザから見た api の住所。HTML の `<meta>` と画像の URL に使う |
| `NG_ALLOWED_HOSTS` | なし | Host ヘッダとして受け付ける名前を足す(カンマ区切り) |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | なし | あるときだけトレースを `/v1/traces` に OTLP/HTTP で送る(本格版は manifest の `tracing` から `http://otel-collector:4318` が入る) |
| `OTEL_SERVICE_NAME` | `samplestore-storefront` | トレースに付くサービス名 |

実物: [server.ts](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/apps/web/src/server.ts)・[docker-compose.yml の storefront](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/docker-compose.yml)・[manifest.json の storefront](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/manifest.json)

### 4.2 SSR の流れ {#s4-2}
| 結果 | 応答 | ヘッダ | 指標 | ログ |
| --- | --- | --- | --- | --- |
| 3000ms 以内に描けた | Angular が決めた状態コード(無い商品なら 404)+ 中身入りの HTML | `X-Render-Mode: ssr` | `ssr_render_duration_seconds` に時間 | `renderMode: "ssr"` |
| 3000ms を超えた | 200 + 空の HTML | `X-Render-Mode: fallback`、`Cache-Control: no-store` | 上 + `ssr_fallback_total` +1 | `event: "ssr_fallback"`(`timeoutMs`・`trace_id` つき) |
| 例外 | 500 + 「ただいま表示できません(500)」の HTML | `X-Render-Mode: ssr` | 上 + `ssr_errors_total` +1 | `event: "ssr_error"`(`error` つき) |
| `RENDER_MODE=csr` | 200 + 空の HTML | `X-Render-Mode: csr`、`Cache-Control: no-store` | — | `renderMode: "csr"` |

- 空の HTML に `no-store` を付けるのは、時間切れの空の HTML を cdn-waf に 30 秒ためさせないためです。
- 時間切れのあとで SSR が失敗しても、もう返事は済んでいるので無視します。

### 4.3 指標 {#s4-3}
| 名前 | 種類 | ラベル | 区切り(秒) |
| --- | --- | --- | --- |
| `ssr_render_duration_seconds` | ヒストグラム | `route` | 0.05, 0.1, 0.25, 0.5, 1, 2, 3, 5, 10 |
| `ssr_fallback_total` | カウンタ | — | — |
| `ssr_errors_total` | カウンタ | — | — |
| `http_requests_total` | カウンタ | `route`・`method`・`status` | — |
| `http_request_duration_seconds` | ヒストグラム | `route`・`method` | 0.01, 0.05, 0.1, 0.25, 0.5, 1, 2, 3, 5, 10 |

`route` は URL をまとめた値(`/`・`/search`・`/p/:code`・`/c/:code`・`/login`・`/my-account/orders`・`/my-account/orders/:code`・`/metrics`・`/healthz`・`static`・`other`)。URL をそのままラベルにすると種類が増えすぎて Prometheus が重くなるためです。

### 4.4 停止 {#s4-4}
`SIGTERM`・`SIGINT` を受けたら新しい接続を断り、受付中の処理が終わったら、送り残したトレースを送ってから止まる。10 秒たっても終わらなければ止まる。

### 4.5 HTML に書き足す印 {#s4-5}
SSR・CSR・フォールバックのどの HTML にも、次の 2 つを書き足します(`decorateHtml`)。

| 印 | 例 | 使い道 |
| --- | --- | --- |
| `<html data-render-mode="...">` | `ssr` / `csr` / `fallback` | 画面の一番下の「描画モード」の表示 |
| `<meta name="api-public-url" content="...">` | `http://api.lab.localhost:18080` | ブラウザが api を呼ぶ住所([tokens.ts](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/apps/web/src/app/core/tokens.ts) が読む) |

外向きの住所を JS に焼き込まず HTML で渡すのは、同じイメージを d1・s1・p1 のどの環境でも使うためです。`<script>` でなく `<meta>` なのは、CSP(読み込んでよいスクリプトの一覧)に引っかからないためです。

### 4.6 ログとトレース {#s4-6}
| 項目 | 内容 |
| --- | --- |
| ログ | 1 行 1 JSON を標準出力へ。例: `{"service":"storefront","msg":"request","route":"/p/:code","status":200,"durationMs":..,"renderMode":"ssr","fallback":false,"trace_id":"...","reqId":"..."}`。`event` 付きは `ssr_fallback`・`ssr_error`・`cms_unknown_component`・`ssr_api_call`(SSR 中の api 呼び出しのうち失敗・1 秒以上) |
| トレースの区間 | `GET /p/:code`(受けたリクエスト。前段が `traceparent` を付けていればその続き)→ `ssr.render`(Angular が HTML を作っていた時間)→ SSR 中の api 呼び出し 1 本ずつ |
| つながり | SSR 中の api 呼び出しに `traceparent` ヘッダを付け、api 側の区間を下につなげる([app-hooks.ts](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/apps/web/src/server/app-hooks.ts)・[otel.ts](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/apps/web/src/server/otel.ts)) |
| 有効になる版 | 本格版だけ(OpenTelemetry Collector → Tempo)。Grafana ではログの `trace_id` から「Tempo で道筋を見る」で飛べる。軽量版は送り先が無いので `trace_id` はログに入らない |

## 5. 目標と確認方法 {#s5}
| 項目 | 目標 | 確かめ方 |
| --- | --- | --- |
| フォールバック率 | 5 分間で 5% 以下 | Grafana「SSR フォールバック率」、アラート `SSRFallbackRatioHigh` |
| SSR エラー | 0 | アラート `SSRErrors` |
| 打ち切り | 3 秒前後で空の HTML | `tools/chaos.sh set latencyMs=3500` のあと `curl -s -D - -o /dev/null "http://www.lab.localhost:18080/p/100001?t=$RANDOM"` で `X-Render-Mode: fallback`(`?t=` はキャッシュを避けるため) |
| 住所の印 | `<meta name="api-public-url">` が入っている | `curl -s http://www.lab.localhost:18080/ \| grep -o '<meta name="api-public-url"[^>]*>'` |

## 6. 関連する文書 {#s6}
- [D-FE-04 商品詳細画面](/design/detail/D-FE-04-product-detail)
- [D-FE-05 CMS 駆動の描画(ヘッドレス)](/design/detail/D-FE-05-headless-cms)
- [D-INC-03 API の応答遅延](/design/detail/D-INC-03-slow-api)
- 仕組みの説明: [storefront の SSR](/how-it-works/04-storefront-ssr)

## 7. 未決事項 {#s7}
| # | 内容 |
| --- | --- |
| 1 | 打ち切ったあとも裏で SSR の処理は続く(結果を捨てるだけ)。api が遅い間、storefront の CPU とメモリを使い続けるので、SSR の同時実行数に上限を付けるか |
| 2 | 軽量版にもトレースの受け口を置くか(今は本格版だけ) |

## 8. レビュー観点 {#s8}
- [ ] 打ち切りの時間が環境変数で変えられ、既定値が書いてあるか
- [ ] 打ち切ったときに返す物に「ためない」印が付いているか
- [ ] フォールバックとエラーが、別々の指標とログで数えられているか
- [ ] 指標の `route` が URL そのままではなく、まとめた値になっているか
- [ ] api の外向きの住所を JS に焼き込まず、環境ごとに変えられるか
- [ ] 停止の合図で、受付中の処理を終えてから止まるか

## この設計を体験する演習 {#exercises}
- [FE-1 SSR と CSR を見比べる](/exercises/01-fe-ssr-vs-csr)
- [FE-2 SSR で壊れる書き方](/exercises/02-fe-ssr-rules)
- [障害-1 API が遅い → SSR が逃げる](/exercises/14-incident-slow-api)
