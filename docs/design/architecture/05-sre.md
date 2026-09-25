# SRE 方式設計書(ラボ)

版: 1.0 / 親: [全体方式](/design/architecture/00-overall) / 対象: Prometheus・Alertmanager・pager・Grafana・Loki・Alloy

::: tip 3 行まとめ(この文書で決めたこと)
- 利用者から見た調子(SLI)を「成功率 = 5xx 以外 ÷ 全体」と「p95 応答時間」で測る。目標(SLO)は 1 か月 99.9%。
- アラートは「失敗の予算(エラーバジェット)を使う速さ」で鳴らす。緊急は 5 分窓 かつ 1 時間窓で 14.4 倍、警告は 30 分窓 かつ 6 時間窓で 6 倍。
- 通知はラボ内の pager に集める。緊急が鳴っている間は、同じサービスの警告を黙らせる。
:::

## 0. 位置づけ {#s0}
全体方式 5 章の目標(99.9%)を、測り方・鳴らし方・届け方に落とします。
配下: [D-SRE-02 SLO とバーンレートのアラート](/design/detail/D-SRE-02-slo-burn-rate)。

## 1. 目的と範囲 {#s1}
- **含む**: SLI の定義、SLO とエラーバジェット、アラートの基準、通知の経路、ダッシュボード、ログの集め方。
- **含まない**: 当番表、定常作業の一覧、外形監視(現場では要る。[必要なこと一覧](/guide/checklist) 43・44)。

## 2. 前提 {#s2}
| 前提 | 内容 |
| --- | --- |
| 収集 | Prometheus が api:3001 と web:4000 の `/metrics` を 5 秒ごとに集める(本番は 15〜60 秒が多い) |
| 保存 | 指標は 7 日、ログは 7 日(168 時間)で消す |
| 通知 | 外部には送らない。pager(ポート 19094)が受けて画面に並べる |

## 3. 全体像 {#s3}
```text
api・web の /metrics ──5 秒ごと──▶ Prometheus
                                    ├ 記録ルール: エラー率(1m・5m・30m・1h・6h・30d)→ 成功率・p95・バーンレート・予算の残り
                                    └ アラートルール ─▶ Alertmanager ─(まとめる・黙らせる)─▶ pager
各コンテナのログ ─ Docker のソケット ─▶ Alloy ─▶ Loki
Grafana ◀── Prometheus と Loki(ダッシュボード「サンプルストア SLO」)
```

## 4. 決定事項 {#s4}
### 4.1 SLI: 何を測るか {#s4-1}
| 項目 | 内容 |
| --- | --- |
| 決定 | 成功率 = 5xx 以外の件数 ÷ 全体の件数。p95 応答時間 = `http_request_duration_seconds` のヒストグラムから計算。見守り用(`/metrics`・`/healthz`・`/readyz`)、管理用(`/admin/*`)、どのルートにも当たらない物(`unmatched`)は数えない。ラベルの `route` は `/products/:id` のようにパターンにまとめる |
| 理由 | 利用者の体験とつながる数字だけを数える。URL をそのままラベルにすると種類が増えすぎて Prometheus が重くなる |
| 却下した案 | CPU 使用率を見る: CPU が平気でも注文が失敗していることがある。4xx も失敗に数える: 利用者の入力ミス(ログイン失敗など)でも予算が減ってしまう |
| 実物 | [slo-recording.yml](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/observability/prometheus/rules/slo-recording.yml#L17-L89)・[metrics.js](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/apps/api/src/metrics.js#L49-L60) |

### 4.2 SLO と エラーバジェット {#s4-2}
| 項目 | 内容 |
| --- | --- |
| 決定 | SLO は 1 か月(30 日)の成功率 99.9%。エラーバジェット = 1 − 0.999 = 0.001。予算の残り = 1 − (30 日のエラー率 ÷ 0.001) |
| 理由 | 100% を目指すと何も変えられなくなる。「失敗してよい量」を決めると、予算が残っていれば新機能を出し、減っていれば直すことを優先する、と決められる |
| 実物 | [slo-recording.yml](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/observability/prometheus/rules/slo-recording.yml#L91-L116) |

### 4.3 アラート {#s4-3}
| 項目 | 内容 |
| --- | --- |
| 決定 | バーンレート = 窓のエラー率 ÷ 0.001。**緊急(page)**: 5 分窓 > 14.4 かつ 1 時間窓 > 14.4 が 1 分続く。**警告(ticket)**: 30 分窓 > 6 かつ 6 時間窓 > 6 が 5 分続く。演習用に**デモ**(1 分窓 かつ 5 分窓 > 14.4、待ちなし)も置く。指標が取れない(`up == 0`)が 1 分続けば緊急 |
| 理由 | 長い窓で「本当に予算を削るほど続いているか」、短い窓で「今もまだ起きているか」を見る。1 件のエラーで鳴らさず、直ったあとも鳴り続けない |
| 却下した案 | エラー率 1% を超えたら鳴らす: 夜中の一瞬のぶれで人を起こし、やがて誰も見なくなる |
| 実物 | [slo-alerts.yml](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/observability/prometheus/rules/slo-alerts.yml#L16-L59) |

### 4.4 SSR のアラート {#s4-4}
| 項目 | 内容 |
| --- | --- |
| 決定 | SSR のフォールバック率が 5 分間で 5% を超えて 1 分続けば警告。SSR のエラーが 1 件でも出て 1 分続けば警告 |
| 理由 | フォールバックは 5xx にならない(画面は出る)ので、成功率の SLO では気づけない。別に見張る |
| 実物 | [slo-alerts.yml](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/observability/prometheus/rules/slo-alerts.yml#L61-L83) |

### 4.5 通知の届け方 {#s4-5}
| 項目 | 内容 |
| --- | --- |
| 決定 | Alertmanager が `alertname` と `job` でまとめ、最初は 10 秒待って仲間を集め、同じまとまりの追加は 30 秒ごと、鳴り続けていれば 1 時間ごとに送り直す。直ったときも知らせる。緊急が出ている間は同じ `job` の警告を黙らせる |
| 理由 | 同じ原因の通知が何十通も届く「通知の洪水」を防ぐ |
| 実物 | [alertmanager.yml](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/observability/alertmanager/alertmanager.yml) |

### 4.6 ダッシュボード {#s4-6}
| 項目 | 内容 |
| --- | --- |
| 決定 | Grafana のホームを「サンプルストア SLO」にする。上から「SLO の要約(成功率・p95・予算の残り・1 時間窓のバーンレート)」「API」「web(SSR)」「ログ(Loki)」の順。ファイルから自動で登録し、画面では変えられない。ログインなしで閲覧できる(ラボだけ) |
| 理由 | 障害のとき、最初に開く 1 枚を決めておく。上から「困っているか → どこか → なぜか」の順に読める |
| 実物 | [samplestore-slo.json](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/observability/grafana/dashboards/samplestore-slo.json) |

### 4.7 ログ {#s4-7}
| 項目 | 内容 |
| --- | --- |
| 決定 | 全部品が 1 行 1 JSON で標準出力に出す。Alloy が Docker のソケット(読むだけ)からラボのコンテナ(compose の project が `lab`)のログを読み、`service`・`container`・`level` のラベルを付けて Loki へ送る。見守りの定期アクセスはログに出さない |
| 理由 | 1 か所で、部品をまたいで絞り込める |
| 実物 | [config.alloy](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/observability/alloy/config.alloy)・[loki.yml](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/observability/loki/loki.yml) |

## 5. 目標 {#s5}
| 項目 | 目標 | 計算式 |
| --- | --- | --- |
| 成功率 | 1 か月 99.9% | 予算 0.1%。30 日 = 43,200 分 × 0.001 = **43.2 分/月**(全部止まった場合の持ち分) |
| 緊急の基準 | 14.4 倍 | 1 時間で予算の 2%: 0.02 × 720 時間 ÷ 1 時間 = 14.4。このままだと 30 日 ÷ 14.4 ≒ **約 2 日**で使い切る |
| 警告の基準 | 6 倍 | 6 時間で予算の 5%: 0.05 × 720 ÷ 6 = 6。このままだと 30 日 ÷ 6 = **5 日**で使い切る |
| 例: エラー率 50% | バーンレート 500 | 0.5 ÷ 0.001 = 500 → 43.2 分 ÷ 500 ≒ 約 5 分で 1 か月分を使い切る |

## 6. 配下の詳細設計書 {#s6}
- [D-SRE-02 SLO とバーンレートのアラート](/design/detail/D-SRE-02-slo-burn-rate)

## 7. 未決事項 {#s7}
| # | 内容 |
| --- | --- |
| 1 | 30 日の予算の残りは、指標の保存期間(7 日)より長い窓で計算している。ラボでは「起動してからの分」と読むが、本番なら保存期間を 30 日以上にするか、長期保存の仕組みを足す |
| 2 | p95 の目標とアラートを置くか(今は記録してダッシュボードに出すだけ) |
| 3 | 当番表と、緊急が 15 分応答されないときの上げ方(ラボには無い) |

## 8. レビュー観点 {#s8}
- [ ] SLI が利用者の体験とつながっているか(CPU などの内側の数字だけになっていないか)
- [ ] SLO に計算式(何分ぶん失敗してよいか)が付いているか
- [ ] アラートが「長い窓 かつ 短い窓」になっているか。1 件で鳴らないか
- [ ] 緊急と警告の届け先・対応時間が分かれているか
- [ ] 指標のラベルに ID や URL をそのまま入れていないか
- [ ] ログとダッシュボードの保存期間が、目標の窓(30 日)に足りているか

## この設計を体験する演習 {#exercises}
- [SRE-1 SLI を測って SLO と比べる](/exercises/09-sre-sli-slo)
- [SRE-2 エラーバジェットとアラート](/exercises/10-sre-burn-rate-alert)
- [障害-1 API が遅い → SSR が逃げる](/exercises/14-incident-slow-api)(SSR のアラート)
