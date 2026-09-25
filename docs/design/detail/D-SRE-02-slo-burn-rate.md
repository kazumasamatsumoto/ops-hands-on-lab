# D-SRE-02 SLO とバーンレートのアラート

版: 1.0 / 親: [SRE 方式](/design/architecture/05-sre) / 対象: [slo-recording.yml](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/observability/prometheus/rules/slo-recording.yml)・[slo-alerts.yml](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/observability/prometheus/rules/slo-alerts.yml)・[alertmanager.yml](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/observability/alertmanager/alertmanager.yml)

::: tip 3 行まとめ(この文書で決めたこと)
- 監視項目は「api と web の成功率(5xx 以外 ÷ 全体)」。SLO は 1 か月 99.9%、エラーバジェットは 0.001。
- 記録ルールで窓ごと(1 分・5 分・30 分・1 時間・6 時間・30 日)のエラー率を作り、0.001 で割ってバーンレートにする。
- 緊急は 5 分窓 かつ 1 時間窓 > 14.4(1 分続く)、警告は 30 分窓 かつ 6 時間窓 > 6(5 分続く)。演習用のデモ(1 分窓 かつ 5 分窓、待ちなし)も置く。
:::

## 0. 親の方式設計書 {#s0}
| 項目 | 内容 |
| --- | --- |
| 親 | [SRE 方式](/design/architecture/05-sre) |
| 引き継ぐ決定 | 4.1 SLI、4.2 SLO とエラーバジェット、4.3 アラート、4.5 通知の届け方 |
| またがる層 | [障害対応方式 4.3](/design/architecture/08-incident-response#s4-3)(通知を受けた人の動き) |

## 1. 目的と範囲 {#s1}
- **目的**: 月の予算を使い切る前に、使う速さで人を呼ぶ。
- **含む**: 記録ルールの一覧、アラートの一覧、計算式、通知の設定、確認の手順。
- **含まない**: SSR のアラートの細部([D-FE-22](/design/detail/D-FE-22-ssr-server))。

## 2. 前提 {#s2}
| 前提 | 内容 |
| --- | --- |
| 元の指標 | `http_requests_total{job, route, method, status}`(api・web の両方が出す) |
| 数えない物 | `route` が `/metrics`・`/healthz`・`/readyz`・`/admin/.*`・`unmatched` |
| 計算の間隔 | 5 秒ごと(`evaluation_interval` と各 group の `interval`) |

## 3. 全体像 {#s3}
```text
http_requests_total
  └ job:http_errors:ratio_rate{1m,5m,30m,1h,6h} = 5xx の率 ÷ 全体の率
  └ job:http_errors:ratio_rate30d               = 30 日の 5xx 件数 ÷ 30 日の全体件数
       ├ job:sli_success:ratio_rate5m          = 1 − 5 分のエラー率
       ├ job:slo_burn_rate:{1m,5m,30m,1h,6h}   = エラー率 ÷ 0.001
       └ job:slo_error_budget_remaining:ratio30d = 1 − 30 日のエラー率 ÷ 0.001
            → アラート → Alertmanager → pager
```

## 4. 仕様 {#s4}
### 4.1 記録ルール {#s4-1}
| 名前 | 式(要点) | 使い道 |
| --- | --- | --- |
| `job:http_requests:rate5m` | 1 秒あたりの件数(5 分) | 流量 |
| `job:http_errors:ratio_rate5m` など 6 本 | 5xx の率 ÷ 全体の率。5xx が 0 件でも 0 になるよう `or ... * 0` を付ける | バーンレートの元 |
| `job:sli_success:ratio_rate5m` | `1 - job:http_errors:ratio_rate5m` | 成功率(SLI) |
| `job:http_request_duration_seconds:p95_rate5m` | `histogram_quantile(0.95, ...)` | p95 |
| `job:slo_burn_rate:1m`・`5m`・`30m`・`1h`・`6h` | エラー率 ÷ `0.001` | アラート |
| `job:slo_error_budget_remaining:ratio30d` | `1 - (30 日のエラー率 / 0.001)` | 予算の残り(1 = 満タン、0 = 使い切り、マイナス = 使いすぎ) |

実物: [slo-recording.yml L13-L116](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/observability/prometheus/rules/slo-recording.yml#L13-L116)

### 4.2 アラート {#s4-2}
| 名前 | 条件 | 続く時間 | 重さ | 行 |
| --- | --- | --- | --- | --- |
| `ErrorBudgetBurnPage` | 5 分窓 > 14.4 **かつ** 1 時間窓 > 14.4 | 1 分 | page(緊急) | [L19-L29](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/observability/prometheus/rules/slo-alerts.yml#L19-L29) |
| `ErrorBudgetBurnTicket` | 30 分窓 > 6 **かつ** 6 時間窓 > 6 | 5 分 | ticket(警告) | [L31-L41](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/observability/prometheus/rules/slo-alerts.yml#L31-L41) |
| `ErrorBudgetBurnDemo` | 1 分窓 > 14.4 **かつ** 5 分窓 > 14.4 | 0 秒 | demo(演習用) | [L46-L59](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/observability/prometheus/rules/slo-alerts.yml#L46-L59) |
| `TargetDown` | `up{job=~"api\|web"} == 0` | 1 分 | page | [L88-L95](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/observability/prometheus/rules/slo-alerts.yml#L88-L95) |

通知の本文(`summary`・`description`)には、どのサービスか(`job`)と、そのときのバーンレートの値を入れる。

### 4.3 計算式 {#s4-3}
| 項目 | 式 | 値 |
| --- | --- | --- |
| エラーバジェット | 1 − SLO | 1 − 0.999 = 0.001 |
| 1 か月の持ち分 | 30 日 × 24 時間 × 60 分 × 0.001 | 43,200 × 0.001 = **43.2 分** |
| バーンレート | 窓のエラー率 ÷ 0.001 | エラー率 1.44% → 14.4 |
| 緊急の 14.4 | 予算の 2% を 1 時間で: 0.02 × 720 時間 ÷ 1 時間 | 14.4(このままだと 30 ÷ 14.4 ≒ 2.1 日で使い切る) |
| 警告の 6 | 予算の 5% を 6 時間で: 0.05 × 720 時間 ÷ 6 時間 | 6(このままだと 30 ÷ 6 = 5 日で使い切る) |

### 4.4 通知(Alertmanager) {#s4-4}
| 設定 | 値 | 意味 |
| --- | --- | --- |
| `group_by` | `alertname`・`job` | 同じアラート・同じサービスを 1 通にまとめる |
| `group_wait` | 10 秒 | 最初の 1 件のあと、仲間が来るのを待つ |
| `group_interval` | 30 秒 | まとまりに追加があったとき、次に送るまで |
| `repeat_interval` | 1 時間 | 鳴り続けている間の送り直し |
| 送り先 | `http://pager:9094/webhook`、直ったときも送る | ラボ内の pager |
| 抑止 | `severity="page"` が出ている間、同じ `job` の `severity="ticket"` を黙らせる | 通知の洪水を防ぐ |

## 5. 目標と確認方法 {#s5}
| 項目 | 目標 | 確かめ方 |
| --- | --- | --- |
| 1 件のエラーで鳴らない | 鳴らない | `errorRate=0.01` で数分流しても page は鳴らない(5 分窓のバーンレートは約 10) |
| 本当の障害で鳴る | 数分以内に pager へ | `tools/chaos.sh set errorRate=0.5` → `tools/k6.sh browse.js -e DURATION=3m -e PAGES=0` → 1〜2 分で `ErrorBudgetBurnDemo`、続いて `ErrorBudgetBurnPage` |
| 直ったら止まる | 「解消」が届く | `tools/chaos.sh reset` のあと、短い窓が下がれば解消 |
| 予算の残り | Grafana で見える | 「エラーバジェットの残り(30 日)」 |

## 6. 関連する文書 {#s6}
- [D-INC-03 API の応答遅延](/design/detail/D-INC-03-slow-api)(通知のあとの一次対応)
- [D-FE-22 SSR サーバー](/design/detail/D-FE-22-ssr-server)(SSR のアラート)

## 7. 未決事項 {#s7}
| # | 内容 |
| --- | --- |
| 1 | Prometheus の保存期間は 7 日だが、予算の残りは 30 日の窓で計算している。ラボでは「起動してからの分」と読む。本番では保存期間を 30 日以上にする |
| 2 | ダッシュボードは api(`job="api"`)だけを表示している。web の成功率も同じルールで計算済みなので、パネルを足すか |
| 3 | 遅さ(p95)の SLO とアラート |

## 8. レビュー観点 {#s8}
- [ ] SLO の数字から、しきい値(14.4・6)までの計算式がたどれるか
- [ ] 長い窓と短い窓の両方を条件にしているか
- [ ] 数えない物(見守り用・管理用)が決まっていて、理由があるか
- [ ] 通知がまとめられ、緊急と警告で届き方が違うか
- [ ] わざと壊して鳴ること、直して止まることを確かめたか

## この設計を体験する演習 {#exercises}
- [SRE-1 SLI を測って SLO と比べる](/exercises/09-sre-sli-slo)
- [SRE-2 エラーバジェットとアラート](/exercises/10-sre-burn-rate-alert)
