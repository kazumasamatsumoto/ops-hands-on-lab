# D-SRE-02 SLO とバーンレートのアラート

版: 2.0 / 親: [SRE 方式](/design/architecture/05-sre) / 対象: [slo-recording.yml](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/observability/prometheus/rules/slo-recording.yml)・[slo-alerts.yml](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/observability/prometheus/rules/slo-alerts.yml)・[alertmanager.yml](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/observability/alertmanager/alertmanager.yml)・[prometheus.yml](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/observability/prometheus/prometheus.yml)

::: tip 3 行まとめ(この文書で決めたこと)
- 監視項目は「storefront と api の成功率(5xx 以外 ÷ 全体)」。SLO は 1 か月 99.9%、エラーバジェットは 0.001。backoffice(社内向け)と worker(画面なし)は数字を作るだけで、目標は置きません。
- 記録ルールで窓ごと(1 分・5 分・30 分・1 時間・6 時間・30 日)のエラー率を作り、0.001 で割ってバーンレートにします。緊急は 5 分窓 かつ 1 時間窓 > 14.4(1 分続く)、警告は 30 分窓 かつ 6 時間窓 > 6(5 分続く)。演習用のデモも置きます。
- 画面は動いていても在庫や検索が古くなる「定期ジョブの止まり」を、worker の `cronjob_last_success_timestamp_seconds` で見張ります(`CronJobStale`: 5 分以上成功なし)。
:::

## 0. 親の方式設計書 {#s0}
| 項目 | 内容 |
| --- | --- |
| 親 | [SRE 方式](/design/architecture/05-sre) |
| 引き継ぐ決定 | 4.1 SLI、4.2 SLO とエラーバジェット、4.3 アラート、4.5 通知の届け方、[4.8 定期ジョブの見張り](/design/architecture/05-sre#s4-8) |
| またがる層 | [障害対応方式 4.3](/design/architecture/08-incident-response#s4-3)(通知を受けた人の動き)、[BE 方式 4.10](/design/architecture/02-backend#s4-10)(定期ジョブ) |

## 1. 目的と範囲 {#s1}
- **目的**: 月の予算を使い切る前に、使う速さで人を呼ぶ。止まっても画面に出ない裏方の仕事(定期ジョブ)にも気づく。
- **含む**: 収集の設定、記録ルールの一覧、アラートの一覧、計算式、通知の設定、確認の手順。
- **含まない**: SSR のアラートの細部([D-FE-22](/design/detail/D-FE-22-ssr-server))、トレース(本格版。[SRE 方式 4.9](/design/architecture/05-sre#s4-9))。

## 2. 前提 {#s2}
| 前提 | 内容 |
| --- | --- |
| 収集先(job) | `storefront`(`storefront:4000`)・`api`・`backoffice`・`worker`(どれも `:3001`)。5 秒ごと。cdn-waf・ingress を通さず中から直接取る(`/metrics` は外から閉じているため) |
| 元の指標 | `http_requests_total{job, route, method, status}`(4 つとも出す)、worker は `cronjob_runs_total{job,result}`・`cronjob_last_success_timestamp_seconds{job}`・`cronjob_duration_seconds{job}` |
| worker の job ラベル | 定期ジョブの指標はジョブ名を `job` ラベルで出す(`stockImportJob`・`searchIndexJob`)。Prometheus の `job` とぶつかるので、収集の設定で `honor_labels: true`(アプリのラベルを優先) |
| 数えない物 | `route` が `/metrics`・`/healthz`・`/readyz`・`/admin/.*`・`unmatched` |
| 計算の間隔 | 5 秒ごと(`evaluation_interval` と各 group の `interval`) |
| 保存期間 | 31 日(`--storage.tsdb.retention.time=31d`)。30 日の窓が計算できる長さ |

## 3. 全体像 {#s3}
```text
http_requests_total
  └ job:http_errors:ratio_rate{1m,5m,30m,1h,6h} = 5xx の率 ÷ 全体の率
  └ job:http_errors:ratio_rate30d               = 30 日の 5xx の率 ÷ 30 日の全体の率
       ├ job:sli_success:ratio_rate5m          = 1 − 5 分のエラー率
       ├ job:slo_burn_rate:{1m,5m,30m,1h,6h}   = エラー率 ÷ 0.001
       └ job:slo_error_budget_remaining:ratio30d = 1 − 30 日のエラー率 ÷ 0.001
            → ErrorBudgetBurn*(storefront と api だけ)
cronjob_runs_total / cronjob_last_success_timestamp_seconds(worker)
  └ job:cronjob_failure:ratio_rate5m・job:cronjob_seconds_since_last_success
            → CronJobStale・CronJobFailureRatioHigh
                  → Alertmanager → pager(http://localhost:19094)
```

## 4. 仕様 {#s4}
### 4.1 記録ルール {#s4-1}
| 名前 | 式(要点) | 使い道 |
| --- | --- | --- |
| `job:http_requests:rate5m` | 1 秒あたりの件数(5 分) | 流量 |
| `job:http_errors:ratio_rate5m` など 6 本(1m・5m・30m・1h・6h・30d) | 5xx の率 ÷ 全体の率。5xx が 0 件でも 0 になるよう `or ... * 0` を付ける | バーンレートの元 |
| `job:sli_success:ratio_rate5m` | `1 - job:http_errors:ratio_rate5m` | 成功率(SLI) |
| `job:http_request_duration_seconds:p95_rate5m` | `histogram_quantile(0.95, ...)` | p95 |
| `job:slo_burn_rate:1m`・`5m`・`30m`・`1h`・`6h` | エラー率 ÷ `0.001` | アラート |
| `job:slo_error_budget_remaining:ratio30d` | `1 - (30 日のエラー率 / 0.001)` | 予算の残り(1 = 満タン、0 = 使い切り、マイナス = 使いすぎ) |
| `job:ssr_render_duration_seconds:p95_rate5m`・`job:ssr_fallback:ratio_rate5m`・`job:ssr_errors:rate5m` | SSR の p95・フォールバック率・エラー | SSR のアラート |
| `job:cronjob_failure:ratio_rate5m` | 失敗の回数 ÷ 動いた回数(5 分) | 定期ジョブの失敗率 |
| `job:cronjob_seconds_since_last_success` | `time() - max by (job) (cronjob_last_success_timestamp_seconds)` | 最後の成功からの秒数(Grafana の「最後の成功からの時間」) |

### 4.2 アラート {#s4-2}
| 名前 | 条件 | 続く時間 | 重さ |
| --- | --- | --- | --- |
| `ErrorBudgetBurnPage` | storefront・api の 5 分窓 > 14.4 **かつ** 1 時間窓 > 14.4 | 1 分 | page(緊急) |
| `ErrorBudgetBurnTicket` | 30 分窓 > 6 **かつ** 6 時間窓 > 6 | 5 分 | ticket(警告) |
| `ErrorBudgetBurnDemo` | 1 分窓 > 14.4 **かつ** 5 分窓 > 14.4 | 0 秒 | demo(演習用) |
| `SSRFallbackRatioHigh` | SSR のフォールバック率(5 分)> 5% | 1 分 | ticket |
| `SSRErrors` | SSR エラー(5 分)> 0 | 1 分 | ticket |
| `CronJobStale` | `time() - cronjob_last_success_timestamp_seconds > 300`(5 分以上成功なし) | 0 秒 | ticket |
| `CronJobFailureRatioHigh` | 定期ジョブの失敗率(5 分)> 50% | 1 分 | ticket |
| `CronJobStaleDemo` | 同じ式で 60 秒 | 30 秒(ふだんの 60 秒ごとの成功の直前に一瞬だけ超えるため) | demo(演習用) |
| `TargetDown` | `up{job=~"storefront\|api\|backoffice\|worker"} == 0` | 1 分 | page |

- 通知の本文(`summary`・`description`)には、どのサービス・ジョブか(`job`)と、そのときの値を入れます。
- `cronjob_last_success_timestamp_seconds` は worker が起動した時刻から始まるので、起動直後に `CronJobStale` が鳴ることはありません。
- `CronJobStale` は、定期ジョブが止まると「画面は動いているのに、在庫(`stockImportJob`)や検索の索引(`searchIndexJob`)がだんだん古くなる」気づきにくい障害を見つけるためのものです。CCv2 では backgroundProcessing で動く CronJob の見張りに当たります。

### 4.3 計算式 {#s4-3}
| 項目 | 式 | 値 |
| --- | --- | --- |
| エラーバジェット | 1 − SLO | 1 − 0.999 = 0.001 |
| 1 か月の持ち分 | 30 日 × 24 時間 × 60 分 × 0.001 | 43,200 × 0.001 = **43.2 分** |
| バーンレート | 窓のエラー率 ÷ 0.001 | エラー率 1.44% → 14.4 |
| 緊急の 14.4 | 予算の 2% を 1 時間で: 0.02 × 720 時間 ÷ 1 時間 | 14.4(このままだと 30 ÷ 14.4 ≒ 2.1 日で使い切る) |
| 警告の 6 | 予算の 5% を 6 時間で: 0.05 × 720 時間 ÷ 6 時間 | 6(このままだと 30 ÷ 6 = 5 日で使い切る) |
| 定期ジョブの 300 秒 | ジョブの間隔(既定 60 秒)の 5 回分 | 1〜2 回の失敗では鳴らさず、続けて止まったら鳴らす |

### 4.4 通知(Alertmanager) {#s4-4}
| 設定 | 値 | 意味 |
| --- | --- | --- |
| `group_by` | `alertname`・`job` | 同じアラート・同じサービス(ジョブ)を 1 通にまとめる |
| `group_wait` | 10 秒 | 最初の 1 件のあと、仲間が来るのを待つ |
| `group_interval` | 30 秒 | まとまりに追加があったとき、次に送るまで |
| `repeat_interval` | 1 時間 | 鳴り続けている間の送り直し |
| 送り先 | `http://pager:9094/webhook`、直ったときも送る | ラボ内の pager |
| 抑止 | `severity="page"` が出ている間、同じ `job` の `severity="ticket"` を黙らせる | 通知の洪水を防ぐ |

## 5. 目標と確認方法 {#s5}
| 項目 | 目標 | 確かめ方 |
| --- | --- | --- |
| 1 件のエラーで鳴らない | 鳴らない | `tools/chaos.sh set errorRate=0.01` で数分流しても page は鳴らない(5 分窓のバーンレートは約 10) |
| 本当の障害で鳴る | 数分以内に pager へ | `tools/chaos.sh set errorRate=0.5` → `tools/k6.sh browse.js -e DURATION=3m -e PAGES=0` → 1〜2 分で `ErrorBudgetBurnDemo`、続いて `ErrorBudgetBurnPage` |
| 定期ジョブの止まり | 数分以内に pager へ | `CHAOS_CRON_FAIL=true CRON_INTERVAL_SECONDS=10 docker compose up -d worker` → 約 1〜2 分で `CronJobStaleDemo` と `CronJobFailureRatioHigh`、約 5〜6 分で `CronJobStale` |
| 直ったら止まる | 「解消」が届く | `tools/chaos.sh reset`・`docker compose up -d worker` のあと、短い窓が下がれば解消 |
| 予算の残り | Grafana で見える | 「エラーバジェットの残り(30 日)」、worker の段の「最後の成功からの時間」 |

## 6. 関連する文書 {#s6}
- [D-INC-03 API の応答遅延](/design/detail/D-INC-03-slow-api)(通知のあとの一次対応)
- [D-FE-22 SSR サーバー](/design/detail/D-FE-22-ssr-server)(SSR のアラート)
- [D-DR-02 バックアップと復元](/design/detail/D-DR-02-backup-restore)(検索の索引は `searchIndexJob` が作り直す)
- 仕組みの説明: [観測(指標・ログ・トレース)](/how-it-works/11-observability)

## 7. 未決事項 {#s7}
| # | 内容 |
| --- | --- |
| 1 | ラボは起動してからの分しかデータが無いので、30 日の予算の残りは「起動してからの分」と読む |
| 2 | worker そのものが止まると `cronjob_*` の指標が集まらなくなり、`CronJobStale` の式は値を持たない(鳴らない)。worker の止まりは `TargetDown{job="worker"}` で気づく前提でよいか。ジョブの止まりと worker の止まりを 1 つのアラートにまとめるか |
| 3 | 遅さ(p95)の SLO とアラート |

## 8. レビュー観点 {#s8}
- [ ] SLO の数字から、しきい値(14.4・6)までの計算式がたどれるか
- [ ] 長い窓と短い窓の両方を条件にしているか
- [ ] 数えない物(見守り用・管理用)が決まっていて、理由があるか
- [ ] SLO を置くサービスと置かないサービスが、理由つきで分かれているか
- [ ] 画面に出ない裏方の仕事(定期ジョブ)に、「最後に成功した時刻」の見張りがあるか
- [ ] 通知がまとめられ、緊急と警告で届き方が違うか
- [ ] わざと壊して鳴ること、直して止まることを確かめたか

## この設計を体験する演習 {#exercises}
- [SRE-1 SLI を測って SLO と比べる](/exercises/09-sre-sli-slo)
- [SRE-2 エラーバジェットとアラート](/exercises/10-sre-burn-rate-alert)
