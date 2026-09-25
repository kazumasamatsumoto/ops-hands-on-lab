# D-PERF-05 負荷試験

版: 1.0 / 親: [性能方式](/design/architecture/07-performance) / 対象: [tools/k6/browse.js](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/tools/k6/browse.js)・[tools/k6/ramp.js](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/tools/k6/ramp.js)・[tools/k6.sh](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/tools/k6.sh)

::: tip 3 行まとめ(この文書で決めたこと)
- シナリオは 2 本。browse.js(普通の利用者 5 人 × 2 分)で目標を守れるか、ramp.js(5 → 20 → 50 人)でどこが限界かを見る。
- 合格線は browse.js が p95 500ms 未満・失敗 1% 未満、ramp.js が p95 1000ms 未満。
- 同じシナリオを「edge 経由」と「api 直接」の 2 通りで流し、入口の制限(429)とアプリの限界を分けて見る。
:::

## 0. 親の方式設計書 {#s0}
| 項目 | 内容 |
| --- | --- |
| 親 | [性能方式](/design/architecture/07-performance) |
| 引き継ぐ決定 | 4.1 速さの目標、4.4 負荷試験、4.5 台数を増やす |
| またがる層 | [セキュリティ方式 4.3](/design/architecture/10-security#s4-3)(IP ごと 1 秒 20 回)、[SRE 方式](/design/architecture/05-sre)(Grafana で同時に見る) |

## 1. 目的と範囲 {#s1}
- **目的**: 目標を守れるか、どこで苦しくなるか、何が先に詰まるかを知る。
- **含む**: シナリオ、人数と時間、合格線、流量の計算、実行の方法、見る場所。
- **含まない**: 本番規模の容量計画。

## 2. 前提 {#s2}
| 前提 | 内容 |
| --- | --- |
| 道具 | `grafana/k6:1.8.1` を Docker で動かす(PC に入れない) |
| 送り元 | ラボのネットワーク `lab_default` の中のコンテナ 1 つ(= IP 1 つ) |
| 送り先 | 既定は `http://edge:8080`。`BASE_URL=http://api:3001` で api に直接 |

## 3. 全体像 {#s3}
| 項目 | browse.js(普通の利用者) | ramp.js(段階的に増やす) |
| --- | --- | --- |
| 人数(VU) | 5(`-e VUS=` で変更) | 30 秒で 5 → 1 分維持 → 30 秒で 20 → 1 分維持 → 30 秒で 50 → 1 分維持 → 30 秒で 0 |
| 時間 | 2 分(`-e DURATION=` で変更) | 合計 5 分 |
| 1 人の動き | 一覧 API → 1 秒 → 詳細 API → 詳細画面(`-e PAGES=0` で画面なし)→ 1〜3 秒 | 詳細 API → 0.5 秒 |
| 商品 | 1〜30 からランダム | 1〜30 からランダム |
| 合格線 | `http_req_failed` < 1%、`http_req_duration` の p95 < 500ms | `http_req_duration` の p95 < 1000ms |
| 確かめ | 200 か | 200 か、429 でないか、5xx でないか |

実物: [browse.js L11-L35](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/tools/k6/browse.js#L11-L35)・[ramp.js L13-L37](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/tools/k6/ramp.js#L13-L37)

## 4. 仕様 {#s4}
### 4.1 流量の計算 {#s4-1}
| シナリオ | 式 | 1 秒あたり(目安) |
| --- | --- | --- |
| browse.js 5 人 | 1 周 = 3 件(画面あり)。1 周の時間 ≒ 1 秒 + 平均 2 秒 = 約 3 秒 → 5 人 × 3 件 ÷ 3 秒 | 約 5 件 |
| ramp.js 5 人 | 5 人 ÷ 0.5 秒 | 最大 約 10 件 |
| ramp.js 20 人 | 20 ÷ 0.5 | 最大 約 40 件 |
| ramp.js 50 人 | 50 ÷ 0.5 | 最大 約 100 件 |

応答時間を 0 と見た上限です。実際は応答に時間がかかる分だけ少なくなります。
edge の上限は IP ごと 1 秒 20 件(+ まとめて 40 件)なので、**ramp.js を edge 経由で流すと 20 人の段から 429 が出始める**のが見どころです。

### 4.2 実行の方法 {#s4-2}
| やりたいこと | コマンド |
| --- | --- |
| 普通の利用者 | `tools/k6.sh browse.js` |
| 人数と時間を変える | `tools/k6.sh browse.js -e VUS=10 -e DURATION=5m` |
| API だけ | `tools/k6.sh browse.js -e PAGES=0` |
| 段階的に増やす(edge 経由) | `tools/k6.sh ramp.js` |
| 段階的に増やす(api 直接) | `BASE_URL=http://api:3001 tools/k6.sh ramp.js` |

### 4.3 見る場所 {#s4-3}
| 見る物 | 場所 |
| --- | --- |
| p95・失敗率・合否 | k6 の最後の要約(しきい値を満たさなければ失敗で終わる) |
| 成功率・p95・流量の変化 | Grafana「サンプルストア SLO」 |
| 429 の数 | k6 の `429 ではない` の確かめの割合、edge のログの `status` |
| キャッシュの効き | edge のログの `cache`(HIT の割合) |
| api のメモリ | Grafana「API のメモリ(RSS)」 |

### 4.4 記録する物 {#s4-4}
試験のたびに、日時・版・シナリオ・送り先(edge / api)・人数・p95・失敗率・429 の割合・詰まった場所を 1 行で残す。前回と比べられるようにする。

## 5. 目標と確認方法 {#s5}
| 項目 | 目標 | 確かめ方 |
| --- | --- | --- |
| 普通の利用者(edge 経由) | 合格(p95 < 500ms、失敗 < 1%) | `tools/k6.sh browse.js` の要約 |
| 限界(api 直接) | 50 人でも p95 < 1000ms | `BASE_URL=http://api:3001 tools/k6.sh ramp.js` |
| 入口の制限 | edge 経由の 20 人以上で 429 が出る(守りが効いている) | `tools/k6.sh ramp.js` |

## 6. 関連する文書 {#s6}
- [D-SEC-01 WAF とレート制限](/design/detail/D-SEC-01-waf-and-rate-limit)
- [D-NW-01 edge の経路とキャッシュ](/design/detail/D-NW-01-edge-route)(商品 API は 30 秒ためるので、edge 経由は速く見える)

## 7. 未決事項 {#s7}
| # | 内容 |
| --- | --- |
| 1 | edge 経由で本当の限界を見るには、送り元を複数にするか、試験のときだけ制限を上げる |
| 2 | ログイン・注文履歴(キャッシュされない API)を含むシナリオを足すか |

## 8. レビュー観点 {#s8}
- [ ] シナリオに考える時間(sleep)が入っているか
- [ ] 流量の計算式があり、本番の見込みと比べてあるか
- [ ] キャッシュに当たる場合と当たらない場合を分けて見ているか
- [ ] 入口の制限を通した結果と、アプリだけの結果を分けているか
- [ ] 結果を前回と比べられる形で残しているか

## この設計を体験する演習 {#exercises}
- [性能-1 負荷試験で限界を見る](/exercises/12-perf-load-test)
- [性能-2 台数を増やして耐える](/exercises/13-perf-scale-out)
