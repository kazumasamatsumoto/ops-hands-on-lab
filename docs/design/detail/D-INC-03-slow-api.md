# D-INC-03 API の応答遅延

版: 2.0 / 親: [障害対応方式](/design/architecture/08-incident-response) / 対象: api が遅くなったときの見え方・気づき方・一次対応

::: tip 3 行まとめ(この文書で決めたこと)
- api が遅くなると、storefront の SSR が 3000ms で打ち切られて空の HTML に逃げます(フォールバック)。利用者には画面が少し遅れて出ます。ブラウザも別オリジンの api を直接呼ぶので、画面の中の移動も遅くなります。
- 気づくのは `SSRFallbackRatioHigh`(5 分間のフォールバック率 5% 超が 1 分)。Grafana の p95 と、ログの `ssr_fallback`・`ssr_api_call`、本格版ではトレース(同じ `trace_id`)で「どの api のどこが遅いか」を裏付けます。
- 一次対応は「画面側か API 側か」を 5 分で切り分け、直前の変更を戻す。原因を直すのはその後です。
:::

## 0. 親の方式設計書 {#s0}
| 項目 | 内容 |
| --- | --- |
| 親 | [障害対応方式](/design/architecture/08-incident-response) |
| 引き継ぐ決定 | 4.2 逃げ道を先に決める、4.3 気づき方と一次対応 |
| またがる層 | [D-FE-22 SSR サーバー](/design/detail/D-FE-22-ssr-server)(逃げ道の作り)、[D-SRE-02](/design/detail/D-SRE-02-slo-burn-rate)(通知)、[SRE 方式 4.9](/design/architecture/05-sre#s4-9)(トレース) |

## 1. 目的と範囲 {#s1}
- **目的**: api が遅いときに、当番 1 人が最初の 15 分で影響を止められるようにする。
- **含む**: 起き方、利用者の見え方、気づき方、切り分け、一次対応、戻したあとの確認。
- **含まない**: 根本の原因の直し方(遅い SQL の改善など)。

## 2. 前提 {#s2}
| 前提 | 内容 |
| --- | --- |
| 起こし方(演習) | `tools/chaos.sh set latencyMs=3500`(OCC の API とトークンに 3.5 秒を足す)。戻すのは `tools/chaos.sh reset`。本格版は `k8s/chaos.sh`(全部の api の Pod に送る) |
| 待ち時間の上限 | storefront の SSR 3000ms、cdn-waf・ingress の読み取り 30 秒、DB の SQL 5 秒(`statement_timeout`)、DB の接続待ち 3 秒 |
| 見る場所 | pager(http://localhost:19094)、Grafana(http://localhost:13000)。本格版はダッシュボード「サンプルストア 1 リクエストの道筋」も |
| スイッチの切り替え口 | `/admin/chaos` は ingress で外から 403。`tools/chaos.sh` は api コンテナの中から直接頼む |

## 3. 全体像(何が起きるか) {#s3}
| 時間 | 起きること | 見える物 |
| --- | --- | --- |
| 0 秒 | api の応答がすべて 3.5 秒遅れる | Grafana の api の p95 が 3.5 秒を超える |
| 〜3 秒 | storefront の SSR が api(`cms/pages`・`products/{code}`)を待つ | — |
| 3 秒 | SSR を打ち切り、空の HTML を返す | `X-Render-Mode: fallback`、storefront のログ `event: "ssr_fallback"` |
| 3 秒〜 | ブラウザが自分で api(`http://api.lab.localhost:18080`)を呼んで画面を作る(さらに 3.5 秒) | 利用者には「読み込み中…」のあとで画面が出る |
| 数分 | フォールバック率が 5% を超えて 1 分続く | pager に `SSRFallbackRatioHigh`(ticket) |

- cdn-waf のキャッシュが効いている画面(`/`・`/p/...`・`/search`)と api(`products`・`cms/pages`)は、30 秒のうちは遅れずに返ります(遅くなるのは期限切れのあと)。
- 5xx にはならないので、成功率の SLO(バーンレートのアラート)は鳴りません。**遅さは成功率とは別に見張る**必要があります。

## 4. 仕様(一次対応の手順) {#s4}
### 4.1 気づく(0〜2 分) {#s4-1}
| 手順 | 見る場所 | 見る物 |
| --- | --- | --- |
| 1 | pager | どのアラートか(`SSRFallbackRatioHigh`)、どのサービスか(`job="storefront"`) |
| 2 | Grafana「storefront(SSR)」の段 | SSR フォールバック率が上がっているか、SSR 描画時間の p95 が 3 秒に張り付いているか |

### 4.2 切り分ける(2〜5 分) {#s4-2}
| 問い | 見る場所 | 答えが「はい」なら |
| --- | --- | --- |
| api の p95 が上がっているか | Grafana「storefront と api」の段の p95 応答時間 | API 側が遅い → 4.3 へ |
| SSR 中のどの api 呼び出しが遅いか | Grafana のログ `{service="storefront"} \|= "ssr_api_call"` の `api`・`durationMs`(1 秒以上か失敗だけが出る) | その API を担当へ |
| api のエラーも増えているか | Grafana「ステータス別」 | 遅いうえに失敗も → [SRE-2](/exercises/10-sre-burn-rate-alert) の手順も並行 |
| 壊すスイッチが入っていないか | Grafana「カオススイッチの状態(api と worker)」、`tools/chaos.sh status` | 練習の消し忘れ → 戻す |
| メモリが上がり続けていないか | Grafana「メモリ(RSS。api・backoffice・worker・storefront)」 | メモリ漏れ → [障害-2](/exercises/15-incident-crashloop) |
| どのルートが遅いか | Grafana のログ `{service="api"}` の `durationMs` と `route` | 特定の API だけ遅い → その API の担当へ |
| 1 リクエストのどこで時間を使ったか(本格版) | ログの `trace_id` から「Tempo で道筋を見る」、またはダッシュボード「サンプルストア 1 リクエストの道筋」 | storefront → api → pg(DB)のどの区間が長いかで、アプリか DB か(Solr か)を分ける |

### 4.3 影響を止める(5〜15 分) {#s4-3}
| 優先 | 手 | ラボでの操作 |
| --- | --- | --- |
| 1 | 直前の変更を戻す | `tools/chaos.sh reset`(本番ならリリースを 1 つ前に戻す) |
| 2 | 台数を増やす(混雑が原因のとき) | 本格版: `kubectl -n lab scale deploy/api --replicas=3`(恒久的には manifest.json の台数を変える) |
| 3 | 逃げ道に任せて待つ(原因が外にあるとき) | フォールバックで画面は出ている。利用者への告知を検討 |

### 4.4 戻ったことを確かめる {#s4-4}
| 確かめる物 | 目安 |
| --- | --- |
| api の p95 | 元の値(数十ミリ秒)に戻る |
| `X-Render-Mode` | `ssr` に戻る(`curl -s -D - -o /dev/null "http://www.lab.localhost:18080/p/100001?t=$RANDOM"`) |
| フォールバック率 | 5 分の窓が過ぎれば 0% に向かい、pager に「解消」が届く |

## 5. 目標と確認方法 {#s5}
| 項目 | 目標 |
| --- | --- |
| 利用者の見え方 | 真っ白にならない(3 秒ほどで空の HTML、その後ブラウザで画面) |
| 気づくまで | アラートが届くまで数分(5 分窓で 5% 超 + 1 分) |
| 影響を止めるまで | 15 分以内 |

## 6. 関連する文書 {#s6}
- [D-FE-22 SSR サーバー](/design/detail/D-FE-22-ssr-server)
- [D-SRE-02 SLO とバーンレートのアラート](/design/detail/D-SRE-02-slo-burn-rate)
- 仕組みの説明: [全体の流れ](/how-it-works/00-overview)・[観測(指標・ログ・トレース)](/how-it-works/11-observability)

## 7. 未決事項 {#s7}
| # | 内容 |
| --- | --- |
| 1 | api の p95 そのものにアラートを置くか(今は SSR のフォールバック率で間接的に気づく) |
| 2 | 打ち切ったあとも裏で SSR が続くため、長く続くと storefront も重くなる。そのときの見分け方 |
| 3 | 軽量版にもトレースを入れるか(今は本格版だけ) |
| 4 | 振り返りの記録の様式 |

## 8. レビュー観点 {#s8}
- [ ] 遅さに気づく仕組みが、成功率とは別にあるか
- [ ] 「画面側か API 側か」を切り分ける手順が、見る場所つきで書いてあるか
- [ ] ログとトレースを同じ `trace_id` でたどれるか
- [ ] 一次対応が「戻す」から始まっているか
- [ ] 戻ったことを何で確かめるかが書いてあるか
- [ ] 練習の消し忘れ(スイッチ)を疑う手順があるか

## この設計を体験する演習 {#exercises}
- [障害-1 API が遅い → SSR が逃げる](/exercises/14-incident-slow-api)
- [SRE-1 SLI を測って SLO と比べる](/exercises/09-sre-sli-slo)
