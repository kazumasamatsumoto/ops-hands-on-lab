# SRE 方式設計書(ラボ)

版: 2.0 / 親: [全体方式](/design/architecture/00-overall) / 対象: Prometheus・Alertmanager・pager・Grafana・Loki・Alloy(本格版は + OpenTelemetry Collector・Tempo)

::: tip 3 行まとめ(この文書で決めたこと)
- 利用者から見た調子(SLI)を「成功率 = 5xx 以外 ÷ 全体」と「p95 応答時間」で測る。目標(SLO)は storefront と api に置き、1 か月 99.9%。
- アラートは「失敗の予算(エラーバジェット)を使う速さ」で鳴らす(緊急 14.4 倍・警告 6 倍)。画面が動いていても気づきにくい**定期ジョブの止まり**は、最後の成功から 5 分で鳴らす。
- 指標・ログ・トレースの 3 つで追う。ログに `trace_id` を入れ、本格版では Grafana でログから Tempo の「1 リクエストの道筋」に飛べるようにする。
:::

## 0. 位置づけ {#s0}
全体方式 5 章の目標(99.9%)を、測り方・鳴らし方・届け方に落とします。
配下: [D-SRE-02 SLO とバーンレートのアラート](/design/detail/D-SRE-02-slo-burn-rate)。

## 1. 目的と範囲 {#s1}
- **含む**: SLI の定義、SLO とエラーバジェット、アラートの基準、SSR と定期ジョブの見張り、通知の経路、ダッシュボード、ログの集め方、トレース。
- **含まない**: 当番表、定常作業の一覧、外形監視(現場では要る。[必要なこと一覧](/guide/checklist))。

CCv2 の案件では、指標とトレースは APM の道具、ログはログ検索の道具で見ることが多く、ラボの Prometheus・Grafana・Tempo と Loki がそれぞれに当たります。道具の名前は違っても、「何を測り、どこで鳴らすか」の決め方は同じです。

## 2. 前提 {#s2}
| 前提 | 内容 |
| --- | --- |
| 収集 | Prometheus が storefront:4000・api:3001・backoffice:3001・worker:3001 の `/metrics` を 5 秒ごとに**中から直接**集める(`/metrics` は ingress で外から閉じている)。本番は 15〜60 秒が多い |
| 保存 | 指標は 31 日(`--storage.tsdb.retention.time=31d`)、ログは 7 日(168 時間)で消す |
| 通知 | 外部には送らない。pager(ポート 19094)が受けて画面に並べる |
| トレース | `OTEL_EXPORTER_OTLP_ENDPOINT` があるときだけ送る。軽量版は設定していないので送らない。本格版はアプリの 4 つの Deployment(storefront・api・backoffice・worker)に `OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-collector:4318` を付け、OpenTelemetry Collector(`otel/opentelemetry-collector:0.161.0`)→ Tempo(`grafana/tempo:2.10.8`、24 時間で消す)に集める |

## 3. 全体像 {#s3}
```text
storefront・api・backoffice・worker の /metrics ──5 秒ごと──▶ Prometheus
                   ├ 記録ルール: エラー率(1m・5m・30m・1h・6h・30d)→ 成功率・p95・バーンレート・予算の残り、SSR、定期ジョブ
                   └ アラートルール ─▶ Alertmanager ─(まとめる・黙らせる)─▶ pager
各コンテナのログ ─ Docker のソケット ─▶ Alloy ─▶ Loki(ラベル service で絞る)
(本格版)storefront・api・backoffice・worker ─OTLP/HTTP :4318─▶ OpenTelemetry Collector ─OTLP/gRPC :4317─▶ Tempo(:3200 で Grafana が問い合わせる)
Grafana ◀── Prometheus・Loki(本格版は + Tempo)(ダッシュボード「サンプルストア SLO」、本格版は +「サンプルストア 1 リクエストの道筋」)
```
本格版では、観測の道具も Namespace `lab` の Deployment(`prometheus`・`alertmanager`・`pager`・`grafana`・`loki`・`alloy`・`otel-collector`・`tempo`)で動きます。Alloy は Docker のソケットではなく Kubernetes の API から Pod のログを読みます。cdn-waf(クラスタの外)と ingress-nginx(Namespace `ingress-nginx`)はトレースを出さないので、道筋の始まりは storefront です。

## 4. 決定事項 {#s4}
### 4.1 SLI: 何を測るか {#s4-1}
| 項目 | 内容 |
| --- | --- |
| 決定 | 成功率 = 5xx 以外の件数 ÷ 全体の件数。p95 応答時間 = `http_request_duration_seconds` のヒストグラムから計算。見守り用(`/metrics`・`/healthz`・`/readyz`)、管理用(`/admin/*`)、どのルートにも当たらない物(`unmatched`)は数えない。ラベルの `route` は `/p/:code`・`/occ/v2/samplestore/products/:code` のようにパターンにまとめる。サービスは `job` ラベル(storefront・api・backoffice・worker)で分ける |
| 理由 | 利用者の体験とつながる数字だけを数える。URL をそのままラベルにすると種類が増えすぎて Prometheus が重くなる |
| 却下した案 | CPU 使用率を見る: CPU が平気でも注文が失敗していることがある。4xx も失敗に数える: 利用者の入力ミス(ログイン失敗など)でも予算が減ってしまう |
| 実物 | [slo-recording.yml](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/observability/prometheus/rules/slo-recording.yml)・[metrics.js](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/apps/api/src/metrics.js)・[prometheus.yml](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/observability/prometheus/prometheus.yml) |

### 4.2 SLO と エラーバジェット {#s4-2}
| 項目 | 内容 |
| --- | --- |
| 決定 | SLO は storefront と api に置き、1 か月(30 日)の成功率 99.9%。エラーバジェット = 1 − 0.999 = 0.001。予算の残り = 1 − (30 日のエラー率 ÷ 0.001)。backoffice(社内向け)と worker(画面を持たない)は数字は作るが目標は置かない |
| 理由 | 100% を目指すと何も変えられなくなる。「失敗してよい量」を決めると、予算が残っていれば新機能を出し、減っていれば直すことを優先する、と決められる。目標はお客さんが直接使う物にだけ置く |
| 実物 | [slo-recording.yml](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/observability/prometheus/rules/slo-recording.yml) |

### 4.3 アラート {#s4-3}
| 項目 | 内容 |
| --- | --- |
| 決定 | バーンレート = 窓のエラー率 ÷ 0.001。**緊急(page)** `ErrorBudgetBurnPage`: 5 分窓 > 14.4 かつ 1 時間窓 > 14.4 が 1 分続く。**警告(ticket)** `ErrorBudgetBurnTicket`: 30 分窓 > 6 かつ 6 時間窓 > 6 が 5 分続く。演習用に**デモ** `ErrorBudgetBurnDemo`(1 分窓 かつ 5 分窓 > 14.4、待ちなし)も置く。どれも `job=~"storefront\|api"` に絞る。指標が取れない(`up == 0`)が 1 分続けば `TargetDown`(緊急。4 サービスとも) |
| 理由 | 長い窓で「本当に予算を削るほど続いているか」、短い窓で「今もまだ起きているか」を見る。1 件のエラーで鳴らさず、直ったあとも鳴り続けない |
| 却下した案 | エラー率 1% を超えたら鳴らす: 夜中の一瞬のぶれで人を起こし、やがて誰も見なくなる |
| 実物 | [slo-alerts.yml](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/observability/prometheus/rules/slo-alerts.yml) |

### 4.4 SSR のアラート {#s4-4}
| 項目 | 内容 |
| --- | --- |
| 決定 | SSR のフォールバック率が 5 分間で 5% を超えて 1 分続けば警告(`SSRFallbackRatioHigh`)。SSR のエラーが 1 件でも出て 1 分続けば警告(`SSRErrors`) |
| 理由 | フォールバックは 5xx にならない(画面は出る)ので、成功率の SLO では気づけない。別に見張る |
| 実物 | [slo-alerts.yml](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/observability/prometheus/rules/slo-alerts.yml)(group `ssr`) |

### 4.5 通知の届け方 {#s4-5}
| 項目 | 内容 |
| --- | --- |
| 決定 | Alertmanager が `alertname` と `job` でまとめ、最初は 10 秒待って仲間を集め、同じまとまりの追加は 30 秒ごと、鳴り続けていれば 1 時間ごとに送り直す。直ったときも知らせる。緊急が出ている間は同じ `job` の警告を黙らせる |
| 理由 | 同じ原因の通知が何十通も届く「通知の洪水」を防ぐ |
| 実物 | [alertmanager.yml](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/observability/alertmanager/alertmanager.yml)・[pager/server.mjs](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/observability/pager/server.mjs) |

### 4.6 ダッシュボード {#s4-6}
| 項目 | 内容 |
| --- | --- |
| 決定 | Grafana のホームを「サンプルストア SLO」にする。上から「SLO の要約」(成功率・p95・予算の残り・1 時間窓のバーンレート)、「storefront と api」(リクエスト・成功率・p95・バーンレート・メモリ・カオスの状態)、「storefront(SSR)」、「worker(定期ジョブ = backgroundProcessing)」、「ログ(Loki)」の段の順。ファイルから自動で登録し、ログインなしで閲覧できる(ラボだけ)。本格版はダッシュボード「サンプルストア 1 リクエストの道筋」(Tempo。[k8s/config/dashboards/samplestore-trace.json](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/k8s/config/dashboards/samplestore-trace.json))を足す。並びは「使い方」「最近の道筋」「選んだ道筋(storefront → api → pg)」「この道筋のログ(同じ trace_id)」 |
| 理由 | 障害のとき、最初に開く 1 枚を決めておく。上から「困っているか → どこか → なぜか」の順に読める |
| 実物 | [samplestore-slo.json](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/observability/grafana/dashboards/samplestore-slo.json)・[datasources.yml](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/observability/grafana/provisioning/datasources/datasources.yml) |

### 4.7 ログ {#s4-7}
| 項目 | 内容 |
| --- | --- |
| 決定 | アプリ(storefront・api・backoffice・worker)と入口(cdn-waf・ingress のアクセスログ)は 1 行 1 JSON で標準出力に出す(db や観測の道具は各製品の形のまま)。Alloy が Docker のソケット(読むだけ)からラボのコンテナ(compose の project が `lab`)のログを読み、`service`・`container`・`level` のラベルを付けて Loki へ送る。見守りの定期アクセスはログに出さない。トレースが動いているときは、アプリのログに `trace_id`・`span_id` を入れる |
| 理由 | 1 か所で、部品をまたいで絞り込める。`X-Request-Id`(cdn-waf が付ける)と `trace_id` で、入口からアプリまで同じリクエストを追える |
| 実物 | [config.alloy](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/observability/alloy/config.alloy)・[loki.yml](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/observability/loki/loki.yml)・[apps/api/src/log.js](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/apps/api/src/log.js) |

### 4.8 定期ジョブの見張り {#s4-8}
| 項目 | 内容 |
| --- | --- |
| 決定 | worker は `cronjob_last_success_timestamp_seconds{job}`(最後に成功した時刻。起動時刻から始まる)と `cronjob_runs_total{job,result}` を出す。**止まり** `CronJobStale`: `time() - cronjob_last_success_timestamp_seconds > 300`(5 分以上成功なし)で警告。**失敗の多さ** `CronJobFailureRatioHigh`: 直近 5 分の失敗率 > 0.5 が 1 分続けば警告。演習用に `CronJobStaleDemo`(> 60 秒、デモ)も置く。ジョブ名を `job` ラベルで出すので、収集の設定で `honor_labels: true` にする(しないと `exported_job` に名前が変わる) |
| 理由 | ジョブが止まっても画面は動き続け、在庫や検索の索引が静かに古くなる。「失敗した」はログに出るが「動いていない」は何も出ないので、最後の成功からの時間で見張る。失敗率は、止まり切る前に気づくため |
| 却下した案 | ジョブの失敗ログだけで気づく: プロセスごと止まったとき何も出ない。「毎回成功したか」で鳴らす: 1 回の失敗で鳴り、次の回で直るぶれまで人を呼ぶ |
| 実物 | [slo-alerts.yml](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/observability/prometheus/rules/slo-alerts.yml)(group `cronjob`)・[prometheus.yml](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/observability/prometheus/prometheus.yml)(worker の `honor_labels`)・[aspects/worker.js](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/apps/api/src/aspects/worker.js) |

### 4.9 トレース(1 リクエストを追う) {#s4-9}
| 項目 | 内容 |
| --- | --- |
| 決定 | OpenTelemetry を使い、`OTEL_EXPORTER_OTLP_ENDPOINT` があるときだけ OTLP/HTTP で送る(無ければ何もしない)。storefront は受けたリクエスト → `ssr.render` → api への呼び出しを区間(スパン)にし、`traceparent` を api に渡す。api は http・express・pg と Solr への問い合わせを自動で計測し、worker はジョブ 1 回を 1 本の道筋にする。本格版は manifest.json の `tracing.otlpEndpoint`(`http://otel-collector:4318`)をアプリの 4 つの Deployment に付け、OpenTelemetry Collector → Tempo に集める。Grafana の Loki のデータソースに derived field を置き、ログの `"trace_id":"…"` から「Tempo で道筋を見る」に飛べるようにする(正規表現 `"trace_id":"([0-9a-f]{32})"`。[k8s/config/grafana-datasources.yml](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/k8s/config/grafana-datasources.yml))。逆向き(道筋 → 同じ trace_id のログ)も Tempo のデータソースの `tracesToLogsV2` でつなぐ |
| 理由 | 指標は「どこかが遅い」、ログは「この部品で何が起きた」までしか分からない。トレースなら 1 回のクリックが storefront → api → DB のどこで時間を使ったかが 1 本の線で見える |
| 却下した案 | 全部の版で常に送る: 軽量版のメモリ(約 2.5GB)を超える。ログの時刻だけで突き合わせる: 同時に何本も動いていると、どれが同じリクエストか分からない |
| 実物 | [manifest.json](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/manifest.json)(`tracing`)・[k8s/observability/traces.yaml](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/k8s/observability/traces.yaml)・[k8s/config/grafana-datasources.yml](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/k8s/config/grafana-datasources.yml)・[apps/api/src/otel.js](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/apps/api/src/otel.js)・[apps/web/src/server/otel.ts](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/apps/web/src/server/otel.ts)・[apps/web/src/server.ts](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/apps/web/src/server.ts) |

## 5. 目標 {#s5}
| 項目 | 目標 | 計算式 |
| --- | --- | --- |
| 成功率 | 1 か月 99.9% | 予算 0.1%。30 日 = 43,200 分 × 0.001 = **43.2 分/月**(全部止まった場合の持ち分) |
| 緊急の基準 | 14.4 倍 | 1 時間で予算の 2%: 0.02 × 720 時間 ÷ 1 時間 = 14.4。このままだと 30 日 ÷ 14.4 ≒ **約 2 日**で使い切る |
| 警告の基準 | 6 倍 | 6 時間で予算の 5%: 0.05 × 720 ÷ 6 = 6。このままだと 30 日 ÷ 6 = **5 日**で使い切る |
| 例: エラー率 50% | バーンレート 500 | 0.5 ÷ 0.001 = 500 → 43,200 分 ÷ 500 ≒ 約 86 分(1 時間半ほど)で 1 か月分を使い切る |
| 定期ジョブ | 最後の成功から 300 秒以内 | 間隔 60 秒なら、およそ 5 回(5 分ぶん)続けて失敗・停止すると鳴る |

## 6. 配下の詳細設計書 {#s6}
- [D-SRE-02 SLO とバーンレートのアラート](/design/detail/D-SRE-02-slo-burn-rate)

## 7. 未決事項 {#s7}
| # | 内容 |
| --- | --- |
| 1 | 指標は 31 日保存にしたので 30 日の予算の残りは計算できるが、ラボでは「起動してからの分」と読む。PC を止めると途切れる |
| 2 | p95 の目標とアラートを置くか(今は記録してダッシュボードに出すだけ) |
| 3 | 軽量版にもトレースを入れるか(メモリとの兼ね合い)。「1 リクエストの道筋」のダッシュボードは本格版だけ |
| 4 | 当番表と、緊急が 15 分応答されないときの上げ方(ラボには無い) |

## 8. レビュー観点 {#s8}
- [ ] SLI が利用者の体験とつながっているか(CPU などの内側の数字だけになっていないか)
- [ ] SLO に計算式(何分ぶん失敗してよいか)が付いているか
- [ ] アラートが「長い窓 かつ 短い窓」になっているか。1 件で鳴らないか
- [ ] 画面に出ない仕事(定期ジョブ)にも「止まったら鳴る」見張りがあるか
- [ ] 緊急と警告の届け先・対応時間が分かれているか
- [ ] 指標のラベルに ID や URL をそのまま入れていないか
- [ ] ログに `trace_id` などのつなぐ鍵が入っていて、部品をまたいで追えるか

## この設計を体験する演習 {#exercises}
- [SRE-1 SLI を測って SLO と比べる](/exercises/09-sre-sli-slo)
- [SRE-2 エラーバジェットとアラート](/exercises/10-sre-burn-rate-alert)
- [障害-1 API が遅い → SSR が逃げる](/exercises/14-incident-slow-api)(SSR のアラート)
