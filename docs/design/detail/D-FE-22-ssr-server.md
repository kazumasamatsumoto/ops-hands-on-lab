# D-FE-22 SSR サーバー(server.ts)

版: 1.0 / 親: [FE 方式](/design/architecture/01-frontend) / 対象: [apps/web/src/server.ts](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/apps/web/src/server.ts)

::: tip 3 行まとめ(この文書で決めたこと)
- web の Express サーバーは「ファイルを配る」「画面の HTML を作る」「運用の口(/healthz・/metrics)を出す」の 3 つをする。
- SSR は `SSR_TIMEOUT_MS`(既定 3000)で打ち切って空の HTML を返し、`ssr_fallback` をログと指標に残す。例外なら 500 の画面を返し `ssr_errors_total` を増やす。
- 止める合図には、受付中の処理を終えてから止まる(最大 10 秒)。
:::

## 0. 親の方式設計書 {#s0}
| 項目 | 内容 |
| --- | --- |
| 親 | [FE 方式](/design/architecture/01-frontend) |
| 引き継ぐ決定 | 4.1 描画方式、4.3 SSR のタイムアウトと逃げ道 |
| またがる層 | [SRE 方式 4.4](/design/architecture/05-sre#s4-4)(フォールバック率のアラート)、[障害対応方式 4.2](/design/architecture/08-incident-response#s4-2) |

## 1. 目的と範囲 {#s1}
- **含む**: 環境変数、口(パス)ごとの動き、SSR の打ち切り、指標、ログ、停止。
- **含まない**: 画面の中身(各画面の詳細設計書)。

## 2. 前提 {#s2}
| 前提 | 内容 |
| --- | --- |
| ポート | 4000 |
| 前段 | edge が `X-Forwarded-*` を付ける。Angular がそれを信じるよう `trustProxyHeaders` に 4 つを登録する(登録しないと Angular が安全のため CSR に切り替える) |
| 画像 | `node:24.21.0-bookworm-slim`、一般ユーザー `node` |

## 3. 全体像(口ごとの動き) {#s3}
| 順 | パス | 動き | 実物 |
| --- | --- | --- | --- |
| 1 | すべて | 1 リクエスト 1 行のログと指標(`/metrics`・`/healthz` はログに出さない) | [L111-L134](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/apps/web/src/server.ts#L111-L134) |
| 2 | `GET /healthz` | `{"status":"ok"}` | [L136-L138](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/apps/web/src/server.ts#L136-L138) |
| 3 | `GET /metrics` | Prometheus 用の指標 | [L140-L143](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/apps/web/src/server.ts#L140-L143) |
| 4 | `/api/*` | 予備の中継(edge を通さず 4000 番を直接開いた演習のときだけ使う)。本文は 1MB まで、10 秒で打ち切り、届かなければ 502 | [L145-L171](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/apps/web/src/server.ts#L145-L171) |
| 5 | 静的ファイル | JS・CSS・画像。名前にハッシュが入るので 1 年キャッシュしてよいと返す | [L173-L180](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/apps/web/src/server.ts#L173-L180) |
| 6 | 画面(GET・HEAD) | CSR なら空の HTML。SSR なら 4.2 の流れ | [L194-L253](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/apps/web/src/server.ts#L194-L253) |

## 4. 仕様 {#s4}
### 4.1 環境変数 {#s4-1}
| 名前 | 既定 | 意味 |
| --- | --- | --- |
| `PORT` | `4000` | 待ち受けるポート |
| `RENDER_MODE` | `ssr` | `csr` にすると、どの画面もサーバーでは描かず空の HTML を返す |
| `SSR_TIMEOUT_MS` | `3000` | SSR をあきらめるまでの時間(0 以下や数でない値なら 3000) |
| `SSR_WINDOW_BUG` | `false` | `true` でサーバー側の描画が `window` を触って 500 になる(演習用) |
| `API_INTERNAL_URL` | `http://api:3001` | サーバーから見た api の住所 |
| `NG_ALLOWED_HOSTS` | なし | Host ヘッダとして受け付ける名前を足す(軽量版は `localhost,127.0.0.1,web,edge`) |

実物: [server.ts L26-L29](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/apps/web/src/server.ts#L26-L29)・[docker-compose.yml](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/docker-compose.yml)

### 4.2 SSR の流れ {#s4-2}
| 結果 | 応答 | ヘッダ | 指標 | ログ |
| --- | --- | --- | --- | --- |
| 3000ms 以内に描けた | 200(Angular が決めた状態コード)+ 中身入りの HTML | `X-Render-Mode: ssr` | `ssr_render_duration_seconds` に時間 | `renderMode: "ssr"` |
| 3000ms を超えた | 200 + 空の HTML | `X-Render-Mode: fallback`、`Cache-Control: no-store` | 上 + `ssr_fallback_total` +1 | `event: "ssr_fallback"`(`timeoutMs` つき) |
| 例外 | 500 + 「ただいま表示できません」の HTML | `X-Render-Mode: ssr` | 上 + `ssr_errors_total` +1 | `event: "ssr_error"`(`error` つき) |
| `RENDER_MODE=csr` | 200 + 空の HTML | `X-Render-Mode: csr`、`Cache-Control: no-store` | — | `renderMode: "csr"` |

どの場合も `<html data-render-mode="...">` の印を付け、画面の一番下の「描画モード」に出す。
時間切れのあとで SSR が失敗しても、もう返事は済んでいるので無視する。

実物: [server.ts L182-L253](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/apps/web/src/server.ts#L182-L253)

### 4.3 指標 {#s4-3}
| 名前 | 種類 | ラベル | 区切り(秒) |
| --- | --- | --- | --- |
| `ssr_render_duration_seconds` | ヒストグラム | `route` | 0.05, 0.1, 0.25, 0.5, 1, 2, 3, 5, 10 |
| `ssr_fallback_total` | カウンタ | — | — |
| `ssr_errors_total` | カウンタ | — | — |
| `http_requests_total` | カウンタ | `route`・`method`・`status` | — |
| `http_request_duration_seconds` | ヒストグラム | `route`・`method` | 0.01, 0.05, 0.1, 0.25, 0.5, 1, 2, 3, 5, 10 |

`route` は URL をまとめた値(`/`・`/products`・`/products/:id`・`/login`・`/me/orders`・`/me/orders/:orderId`・`static`・`other` など)。実物: [server.ts L60-L99](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/apps/web/src/server.ts#L60-L99)

### 4.4 停止 {#s4-4}
`SIGTERM`・`SIGINT` を受けたら新しい接続を断り、受付中の処理が終わったら止まる。10 秒たっても終わらなければ止まる。実物: [server.ts L273-L280](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/apps/web/src/server.ts#L273-L280)

## 5. 目標と確認方法 {#s5}
| 項目 | 目標 | 確かめ方 |
| --- | --- | --- |
| フォールバック率 | 5 分間で 5% 以下 | Grafana「SSR フォールバック率」、アラート `SSRFallbackRatioHigh` |
| SSR エラー | 0 | アラート `SSRErrors` |
| 打ち切り | 3 秒前後で空の HTML | `tools/chaos.sh set latencyMs=3500` のあと `curl -s -D - http://localhost:18080/products/1 -o /dev/null` で `X-Render-Mode: fallback` |

## 6. 関連する文書 {#s6}
- [D-FE-04 商品詳細画面](/design/detail/D-FE-04-product-detail)
- [D-INC-03 API の応答遅延](/design/detail/D-INC-03-slow-api)

## 7. 未決事項 {#s7}
| # | 内容 |
| --- | --- |
| 1 | 打ち切ったあとも裏で SSR の処理は続く(結果を捨てるだけ)。API が遅い間、web の CPU とメモリを使い続けるので、SSR の同時実行数に上限を付けるか |
| 2 | 予備の中継(`/api/*`)を本番の作りから外すか |

## 8. レビュー観点 {#s8}
- [ ] 打ち切りの時間が環境変数で変えられ、既定値が書いてあるか
- [ ] 打ち切ったときに返す物に「ためない」印が付いているか
- [ ] フォールバックとエラーが、別々の指標とログで数えられているか
- [ ] 指標の `route` が URL そのままではなく、まとめた値になっているか
- [ ] 停止の合図で、受付中の処理を終えてから止まるか

## この設計を体験する演習 {#exercises}
- [FE-1 SSR と CSR を見比べる](/exercises/01-fe-ssr-vs-csr)
- [FE-2 SSR で壊れる書き方](/exercises/02-fe-ssr-rules)
- [障害-1 API が遅い → SSR が逃げる](/exercises/14-incident-slow-api)
