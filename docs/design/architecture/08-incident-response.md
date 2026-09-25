# 障害対応方式設計書(ラボ)

版: 1.0 / 親: [全体方式](/design/architecture/00-overall) / 対象: 障害の分け方・逃げ道・気づき方・一次対応・練習

::: tip 3 行まとめ(この文書で決めたこと)
- 障害を「遅い」「落ちる」「間違った物を返す」の 3 つに分け、それぞれの**逃げ道を先に決めておく**(例: API が遅ければ SSR をあきらめて空の HTML を返す)。
- 気づくのはアラート(pager)、原因を探すのは Grafana のダッシュボードとログ。一次対応は「影響を止める」を先、「原因を直す」を後にする。
- 障害はわざと起こして練習する(`tools/chaos.sh`)。本番の前に、見張りと手順が効くことを確かめる。
:::

## 0. 位置づけ {#s0}
全体方式の「わざと壊すスイッチを組み込む」を使って、障害の見え方と対応を決めます。
配下: [D-INC-03 API の応答遅延](/design/detail/D-INC-03-slow-api)。

## 1. 目的と範囲 {#s1}
- **含む**: 障害の分け方、逃げ道、気づき方と一次対応、再起動に任せる範囲、障害の練習、振り返り。
- **含まない**: 連絡の文面の型、発注者への報告ルール(現場では要る。[必要なこと一覧](/guide/checklist) 59)。

## 2. 前提 {#s2}
| 前提 | 内容 |
| --- | --- |
| 壊すスイッチ | api: `latencyMs`・`errorRate`・`leakMb`・`idorBug`・`sqliBug`。web: `SSR_WINDOW_BUG` |
| 切り替え | `tools/chaos.sh set 名前=値`、戻すのは `tools/chaos.sh reset`。api が再起動するとスイッチは起動時の値に戻る |
| 見る場所 | pager(19094)、Grafana(13000)、`docker compose ps`・`docker compose logs` |

## 3. 全体像 {#s3}
| 分け方 | 起こし方 | 利用者の見え方 | 逃げ道・自動の回復 | 気づき方 |
| --- | --- | --- | --- | --- |
| 遅い | `latencyMs=3500` など | 画面が遅い。SSR が間に合わず空の HTML → ブラウザで描く | SSR のフォールバック(3000ms) | `SSRFallbackRatioHigh`、p95 の上昇 |
| 落ちる(エラー) | `errorRate=0.5` | 半分が 500 | 無し(直すまで予算が減る) | `ErrorBudgetBurnPage`(緊急) |
| 落ちる(メモリ) | `leakMb=5` | 途中で接続が切れ、少しして戻る | メモリ上限で強制終了 → 自動で再起動 | `TargetDown`、メモリのグラフ、`docker compose ps` の再起動 |
| 間違った物を返す | `idorBug=true`・`sqliBug=true` | 他人の注文が見える / SQL を書き換えられる | 無し(アラートは鳴らない) | ログの `chaos` の警告、WAF の遮断ログ |
| 画面の作りの誤り | `SSR_WINDOW_BUG=true` | 全画面が 500 | 無し | `SSRErrors` |

## 4. 決定事項 {#s4}
### 4.1 障害の分け方 {#s4-1}
| 項目 | 内容 |
| --- | --- |
| 決定 | 上の表の 3 つ(+ 画面の作りの誤り)に分け、それぞれに「逃げ道」「気づき方」「一次対応」を決める |
| 理由 | 分け方によって、やることがまったく違う。「間違った物を返す」は見張りでは気づけず、ログとレビューが頼り |
| 実物 | [chaos.js](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/apps/api/src/chaos.js#L80-L95) |

### 4.2 逃げ道を先に決める {#s4-2}
| 項目 | 内容 |
| --- | --- |
| 決定 | API が遅いとき、web は 3000ms で SSR をあきらめて空の HTML を返す(キャッシュさせない)。DB に届かないとき、api は `/readyz` で 503 を返して振り分けから外れる(再起動はしない) |
| 理由 | 一部の遅れが全体に広がる(連鎖)のを止める。「全部止まる」より「少し遅いが使える」の方がよい |
| 却下した案 | 起きてから考える: 障害の最中に設計を考えることになる |
| 実物 | [server.ts](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/apps/web/src/server.ts#L212-L225)・[server.js の readyz](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/apps/api/src/server.js#L48-L57) |

### 4.3 気づき方と一次対応 {#s4-3}
| 項目 | 内容 |
| --- | --- |
| 決定 | 気づくのは pager の通知。一次対応は次の順: ① Grafana で「困っているか」(成功率・p95)を見る → ② 「どこか」(api か web か、ルート別)を見る → ③ 直前の変更(スイッチ・リリース)を戻す → ④ ログで原因を探す |
| 理由 | 当番が 1 人でも最初の 15 分を迷わずに動ける。影響を止めるのが先 |
| 実物 | [D-INC-03](/design/detail/D-INC-03-slow-api)・[ダッシュボード](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/observability/grafana/dashboards/samplestore-slo.json) |

### 4.4 再起動に任せる範囲 {#s4-4}
| 項目 | 内容 |
| --- | --- |
| 決定 | メモリの上限を超えた部品は強制終了され、自動で再起動される(軽量版 `restart: unless-stopped`、本格版は kubelet)。ただし再起動で「直った」と扱わず、同じことが繰り返されていないか(再起動の回数・CrashLoopBackOff)を必ず見る |
| 理由 | 自動の回復は時間稼ぎで、原因(メモリ漏れ)は残っている |
| 却下した案 | 再起動に任せて調べない: 毎日同じ時間に落ちていても誰も気づかない |
| 実物 | [docker-compose.yml](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/docker-compose.yml)・[k8s/manifests/api.yaml](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/k8s/manifests/api.yaml#L60-L66) |

### 4.5 障害の練習 {#s4-5}
| 項目 | 内容 |
| --- | --- |
| 決定 | 障害を起こすのは `tools/chaos.sh`(軽量版)・`k8s/chaos.sh`(本格版)だけ。スイッチの状態は指標 `lab_chaos_setting` でダッシュボードに出し、「今は壊している最中」と分かるようにする。練習のあとは必ず `reset` する |
| 理由 | 手順書は一度も試さないと、本番で書いてあるコマンドが動かない。壊している最中だと分からないと、練習を本物の障害と間違える |
| 実物 | [chaos.sh](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/tools/chaos.sh)・[metrics.js](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/apps/api/src/metrics.js#L27-L47) |

### 4.6 振り返り {#s4-6}
| 項目 | 内容 |
| --- | --- |
| 決定 | 演習(と本番の障害)のあとに、「何が起きたか・いつ気づいたか・何をしたか・次に仕組みのどこを変えるか」を書く。誰が悪いかは書かない |
| 理由 | 「担当者の確認不足」で終わると、仕組みが何も変わらず同じ障害が起きる |
| 実物 | ラボでは様式を持たない(未決事項 1) |

## 5. 目標 {#s5}
| 項目 | 目標 | 根拠 |
| --- | --- | --- |
| 遅いときの画面 | 3 秒ほどで何かが出る(真っ白にしない) | SSR の打ち切り 3000ms |
| 緊急の気づき | errorRate=0.5 で数分以内に pager に届く | 緊急は 5 分窓 かつ 1 時間窓 > 14.4 が 1 分続く。デモ用は 1 分窓 かつ 5 分窓で待ちなし(1〜2 分で届く) |
| 通知の重さ | 緊急が出ている間、同じサービスの警告は黙る | Alertmanager の抑止 |

## 6. 配下の詳細設計書 {#s6}
- [D-INC-03 API の応答遅延](/design/detail/D-INC-03-slow-api)

## 7. 未決事項 {#s7}
| # | 内容 |
| --- | --- |
| 1 | 振り返り(ポストモーテム)の様式をラボに置くか |
| 2 | 「間違った物を返す」障害(IDOR など)を見張りで気づく方法(例: 他人の注文を返した回数を指標にする) |

## 8. レビュー観点 {#s8}
- [ ] 障害の種類ごとに、逃げ道と気づき方が決まっているか
- [ ] 逃げ道が「全体を止めない」ものになっているか(遅れの連鎖を切れるか)
- [ ] 一次対応が「影響を止める → 原因を探す」の順になっているか
- [ ] 自動の再起動に頼りきりになっていないか(繰り返しを見張っているか)
- [ ] 手順を実際に試した記録があるか

## この設計を体験する演習 {#exercises}
- [障害-1 API が遅い → SSR が逃げる](/exercises/14-incident-slow-api)
- [障害-2 メモリ不足で再起動を繰り返す](/exercises/15-incident-crashloop)
- [SRE-2 エラーバジェットとアラート](/exercises/10-sre-burn-rate-alert)
