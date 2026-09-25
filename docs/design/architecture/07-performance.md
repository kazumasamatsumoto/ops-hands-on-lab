# 性能方式設計書(ラボ)

版: 1.0 / 親: [全体方式](/design/architecture/00-overall) / 対象: 応答の速さ・キャッシュ・JS の大きさ・負荷試験・台数

::: tip 3 行まとめ(この文書で決めたこと)
- 速さは平均ではなく「遅い方の 5%」(p95)で見る。普通の利用者のシナリオで p95 が 500ms 未満、失敗 1% 未満を合格とする。
- 速くする手は 3 つ: 入口で 30 秒ためる(キャッシュ)、最初に読む JS を 450kB 以下に抑える、台数を増やす(スケールアウト)。
- 負荷試験は「普通の利用者」と「段階的に増やす」の 2 本。edge 経由と api 直接の両方で測り、どこが先に詰まるかを見る。
:::

## 0. 位置づけ {#s0}
全体方式 5 章の「p95 500ms 未満」を、測り方と速くする手に落とします。
配下: [D-PERF-05 負荷試験](/design/detail/D-PERF-05-load-test)。

## 1. 目的と範囲 {#s1}
- **含む**: 速さの目標、キャッシュの効き、JS の予算、負荷試験の方式、台数を増やす方法、DB 接続の上限。
- **含まない**: 本番の容量計画(セールなど)、画像の最適化。

## 2. 前提 {#s2}
| 前提 | 内容 |
| --- | --- |
| 道具 | k6(Docker イメージ `grafana/k6:1.8.1`)。ラボの Docker ネットワーク(`lab_default`)の中から送る |
| 送り元 | k6 はコンテナ 1 つ = IP 1 つ。edge の「IP ごとに 1 秒 20 回」のレート制限に当たる |
| 台数 | 軽量版は api・web 1 つずつ。本格版は 2 つずつから増やせる |

## 3. 全体像 {#s3}
```text
k6 ──▶ edge(キャッシュ 30 秒・IP ごと 1 秒 20 回)──▶ api / web ──▶ db(接続 最大 10 本)
k6 ──▶ api:3001 に直接(BASE_URL=http://api:3001)… アプリそのものの限界を見る
結果: k6 の要約(p95・失敗率)と、Grafana の p95・成功率・リクエスト数
```

## 4. 決定事項 {#s4}
### 4.1 速さの目標 {#s4-1}
| 項目 | 内容 |
| --- | --- |
| 決定 | 普通の利用者(browse.js): p95 が 500ms 未満、失敗 1% 未満。段階的な試験(ramp.js): p95 が 1000ms 未満 |
| 理由 | 平均だと、20 人に 1 人が 5 秒待っていても隠れる。p95 は「ほとんどの人が体験する遅め」の速さ |
| 却下した案 | 平均で決める: 遅い人が見えない。最大で決める: 1 回の外れ値で不合格になる |
| 実物 | [browse.js](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/tools/k6/browse.js#L11-L19)・[ramp.js](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/tools/k6/ramp.js#L13-L26) |

### 4.2 入口でためて減らす {#s4-2}
| 項目 | 内容 |
| --- | --- |
| 決定 | 商品一覧・詳細の HTML と商品の API を edge で 30 秒ためる([ネットワーク方式 4.2](/design/architecture/04-network#s4-2)) |
| 理由 | 一番速いのは、奥まで行かないこと。よく見られる画面ほど効く |
| 実物 | [default.conf.template](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/edge/default.conf.template#L125-L140) |

### 4.3 最初に読む JS を抑える {#s4-3}
| 項目 | 内容 |
| --- | --- |
| 決定 | initial の予算は 400kB で警告、450kB でビルド失敗(今は約 320kB)。注文履歴は遅延読み込み。JS・CSS はファイル名に中身のハッシュが入るので、web が 1 年キャッシュしてよいと返す |
| 理由 | スマホでは、JS の大きさがそのまま表示の遅さになる |
| 実物 | [angular.json](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/apps/web/angular.json#L71-L87)・[server.ts](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/apps/web/src/server.ts#L173-L180) |

### 4.4 負荷試験 {#s4-4}
| 項目 | 内容 |
| --- | --- |
| 決定 | 2 本のシナリオを持つ。**browse.js**: 5 人(`VUS`)が 2 分(`DURATION`)、一覧 → 1 秒考える → 詳細 → 詳細画面 → 1〜3 秒考える、を繰り返す。**ramp.js**: 30 秒で 5 人 → 1 分維持 → 20 人 → 1 分 → 50 人 → 1 分 → 30 秒で 0 人。各人は 0.5 秒ごとに商品詳細 API を呼ぶ。どちらも edge 経由と api 直接の両方で測る |
| 理由 | 普通の使われ方で目標を守れるかと、どこで限界が来るか・何が先に詰まるか(レート制限の 429 か、api の遅れか、DB か)を分けて知る |
| 却下した案 | 1 つの URL だけを全力で連打: 本番の混ざった使われ方と違い、キャッシュに全部当たって「速い」と勘違いする |
| 実物 | [browse.js](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/tools/k6/browse.js)・[ramp.js](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/tools/k6/ramp.js)・[k6.sh](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/tools/k6.sh) |

### 4.5 台数を増やす {#s4-5}
| 項目 | 内容 |
| --- | --- |
| 決定 | 本格版で api・web のレプリカを増やして耐える(`kubectl -n lab scale deploy/api --replicas=N`)。api は状態をメモリに持たない(ログインの印は JWT、データは DB)ので、何台に増やしても同じ答えを返す |
| 理由 | 1 台を大きくするより、同じ物を並べる方が、壊れたときにも強い |
| 却下した案 | 1 台のメモリや CPU を増やす(スケールアップ): 上限があり、その 1 台が落ちたら終わり |
| 実物 | [k8s/manifests/api.yaml](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/k8s/manifests/api.yaml#L11-L19) |

### 4.6 DB の接続の上限 {#s4-6}
| 項目 | 内容 |
| --- | --- |
| 決定 | api 1 台あたり DB 接続は最大 10 本、接続を待つのは 3 秒まで |
| 理由 | api を増やすと DB への接続も増える。台数 × 10 本が DB の上限を超えないように、台数を増やすときは DB 側も確かめる |
| 実物 | [db.js](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/apps/api/src/db.js#L5-L15) |

## 5. 目標 {#s5}
| 項目 | 目標 | 計算・根拠 |
| --- | --- | --- |
| 普通の利用者の p95 | 500ms 未満 | browse.js の `thresholds` |
| 普通の利用者の失敗率 | 1% 未満 | 同上 |
| ramp.js 50 人のときの流量 | 1 秒あたり 約 100 件 | 50 人 ÷ 0.5 秒 = 100 件/秒(応答時間を 0 と見た上限) |
| edge 経由の上限 | 1 秒 20 件(k6 の 1 IP) | 100 件/秒 > 20 件/秒 なので、edge 経由では 429 が出る。**これが見どころ** |
| DB 接続 | api の台数 × 10 本 | 本格版の既定 2 台なら 20 本 |

## 6. 配下の詳細設計書 {#s6}
- [D-PERF-05 負荷試験](/design/detail/D-PERF-05-load-test)

## 7. 未決事項 {#s7}
| # | 内容 |
| --- | --- |
| 1 | 負荷試験のときだけ edge のレート制限を上げるか、送り元を分けるか(今は api 直接で測る) |
| 2 | 画面(ブラウザ)で測る速さ(最初の表示が出るまで)を目標に入れるか |

## 8. レビュー観点 {#s8}
- [ ] 目標が平均ではなく p95 などで決まっているか
- [ ] 負荷試験のシナリオが、本番の使われ方(混ざり方・考える時間)に近いか
- [ ] 流量の計算式があるか(人数 ÷ 間隔)
- [ ] 前段の制限(レート制限・キャッシュ)を通した結果と、アプリだけの結果を分けて見ているか
- [ ] 台数を増やしたとき、DB など後ろの上限を確かめているか

## この設計を体験する演習 {#exercises}
- [性能-1 負荷試験で限界を見る](/exercises/12-perf-load-test)
- [性能-2 台数を増やして耐える](/exercises/13-perf-scale-out)
- [FE-3 遅延読み込みと JS の予算](/exercises/03-fe-lazy-loading)
- [ネットワーク-1 前段のキャッシュ](/exercises/07-nw-cache)
