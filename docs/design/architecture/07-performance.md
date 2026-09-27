# 性能方式設計書(ラボ)

版: 2.0 / 親: [全体方式](/design/architecture/00-overall) / 対象: 応答の速さ・キャッシュ・返す量(fields)・検索・JS の大きさ・負荷試験・台数

::: tip 3 行まとめ(この文書で決めたこと)
- 速さは平均ではなく「遅い方の 5%」(p95)で見る。普通の利用者のシナリオで p95 が 500ms 未満、失敗 1% 未満を合格とする。
- 速くする手は 5 つ: 入口(cdn-waf)で 30 秒ためる、返す量を `fields` で選ぶ、検索を DB から Solr に外す(本格版)、最初に読む JS を 450kB 以下に抑える、台数を増やす(スケールアウト)。
- 負荷試験は「普通の利用者」と「段階的に増やす」の 2 本。cdn-waf 経由と api 直接の両方で測り、どこが先に詰まるかを見る。
:::

## 0. 位置づけ {#s0}
全体方式 5 章の「p95 500ms 未満」を、測り方と速くする手に落とします。
配下: [D-PERF-05 負荷試験](/design/detail/D-PERF-05-load-test)。

## 1. 目的と範囲 {#s1}
- **含む**: 速さの目標、キャッシュの効き、返す量(`fields`)、検索の実体、JS の予算、負荷試験の方式、台数を増やす方法、DB 接続の上限。
- **含まない**: 本番の容量計画(セールなど)、画像の最適化(ラボの画像は小さな SVG)。

## 2. 前提 {#s2}
| 前提 | 内容 |
| --- | --- |
| 道具 | k6(Docker イメージ `grafana/k6:1.8.1`)。ラボの Docker ネットワーク(`lab_default`)の中から送り、3 つのホスト名を cdn-waf の IP(`172.30.89.10`)に向ける |
| 送り元 | k6 はコンテナ 1 つ = IP 1 つ。cdn-waf の「IP ごとに 1 秒 20 回(バースト 80)」のレート制限に当たる |
| 台数 | 軽量版は全部 1 つずつ。本格版は環境ごと(p1: storefront 2・api 2)から増やせる |

## 3. 全体像 {#s3}
```text
k6 ──▶ cdn-waf(キャッシュ 30 秒・IP ごと 1 秒 20 回)──▶ ingress ──▶ storefront / api ──▶ db(接続 最大 10 本/台)・Solr
k6 ──▶ api:3001 / storefront:4000 に直接(API_URL・WWW_URL)… アプリそのものの限界を見る
結果: k6 の要約(p95・失敗率)と、Grafana の p95・成功率・リクエスト数
```

## 4. 決定事項 {#s4}
### 4.1 速さの目標 {#s4-1}
| 項目 | 内容 |
| --- | --- |
| 決定 | 普通の利用者(browse.js): p95 が 500ms 未満、失敗 1% 未満。段階的な試験(ramp.js): p95 が 1000ms 未満 |
| 理由 | 平均だと、20 人に 1 人が 5 秒待っていても隠れる。p95 は「ほとんどの人が体験する遅め」の速さ |
| 却下した案 | 平均で決める: 遅い人が見えない。最大で決める: 1 回の外れ値で不合格になる |
| 実物 | [browse.js](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/tools/k6/browse.js)・[ramp.js](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/tools/k6/ramp.js)(`thresholds`) |

### 4.2 入口でためて減らす {#s4-2}
| 項目 | 内容 |
| --- | --- |
| 決定 | トップ・商品詳細・検索の HTML と、商品・CMS の API を cdn-waf で 30 秒、画像を 1 日ためる([ネットワーク方式 4.2](/design/architecture/04-network#s4-2))。商品の API には `Authorization` を付けない(付けるとためられない) |
| 理由 | 一番速いのは、奥まで行かないこと。よく見られる画面ほど効く。CMS 駆動の画面は 1 枚で CMS と商品の API を何本も呼ぶので、API をためる効果も大きい |
| 実物 | [cdn-waf/default.conf.template](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/cdn-waf/default.conf.template) |

### 4.3 最初に読む JS を抑える {#s4-3}
| 項目 | 内容 |
| --- | --- |
| 決定 | initial の予算は 400kB で警告、450kB でビルド失敗(今は約 336kB)。注文履歴は遅延読み込み。JS・CSS はファイル名に中身のハッシュが入るので、storefront が 1 年キャッシュしてよいと返す。SSR で取った JSON は TransferState で申し送り、最初の表示で api を呼び直さない |
| 理由 | スマホでは、JS の大きさがそのまま表示の遅さになる。同じ JSON を 2 回取るのは無駄 |
| 実物 | [angular.json](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/apps/web/angular.json)・[server.ts](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/apps/web/src/server.ts)・[api.service.ts](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/apps/web/src/app/core/api.service.ts) |

### 4.4 負荷試験 {#s4-4}
| 項目 | 内容 |
| --- | --- |
| 決定 | 負荷をかけるシナリオを 2 本持つ(このほかに、主な URL を 1 回ずつ確かめる smoke.js がある)。**browse.js**: 5 人(`VUS`)が 2 分(`DURATION`)、トップの画面と CMS の API → 1 秒考える → 検索の API(12 件)→ 1 秒考える → 商品 1 件の API(`fields=FULL`)と商品詳細の画面 → 1〜3 秒考える、を繰り返す(`PAGES=0` で API だけ)。**ramp.js**: 30 秒で 5 人 → 1 分維持 → 20 人 → 1 分 → 50 人 → 1 分 → 30 秒で 0 人。各人は 0.5 秒ごとに商品 1 件の API(`TARGET=page` なら商品詳細の画面)を呼ぶ。どちらも cdn-waf 経由とアプリ直接の両方で測る |
| 理由 | 普通の使われ方で目標を守れるかと、どこで限界が来るか・何が先に詰まるか(レート制限の 429 か、api の遅れか、DB か)を分けて知る |
| 却下した案 | 1 つの URL だけを全力で連打: 本番の混ざった使われ方と違い、キャッシュに全部当たって「速い」と勘違いする |
| 実物 | [browse.js](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/tools/k6/browse.js)・[ramp.js](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/tools/k6/ramp.js)・[k6.sh](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/tools/k6.sh) |

### 4.5 台数を増やす {#s4-5}
| 項目 | 内容 |
| --- | --- |
| 決定 | 本格版で storefront・api のレプリカを増やして耐える(ずっと変えるなら manifest.json の `environments.*.replicas` を直して作り直す。試すだけなら `kubectl -n lab scale deploy/api --replicas=N`)。api は状態をメモリに持たない(トークンは DB にハッシュで置く、データも DB)ので、何台に増やしても同じ答えを返す。定期ジョブは worker 1 台だけで動かし、api を増やしてもジョブは増えない |
| 理由 | 1 台を大きくするより、同じ物を並べる方が、壊れたときにも強い |
| 却下した案 | 1 台のメモリや CPU を増やす(スケールアップ): 上限があり、その 1 台が落ちたら終わり |
| 実物 | [manifest.json](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/manifest.json)・[k8s/generated/envs/p1/kustomization.yaml](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/k8s/generated/envs/p1/kustomization.yaml) |

### 4.6 DB の接続の上限 {#s4-6}
| 項目 | 内容 |
| --- | --- |
| 決定 | 1 プロセスあたり DB 接続は最大 10 本、接続を待つのは 3 秒まで。api・backoffice・worker の全部が同じ DB を使う |
| 理由 | api を増やすと DB への接続も増える。(api + backoffice + worker の台数)× 10 本が DB の上限を超えないように、台数を増やすときは DB 側も確かめる |
| 実物 | [db.js](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/apps/api/src/db.js) |

### 4.7 返す量を減らす(fields) {#s4-7}
| 項目 | 内容 |
| --- | --- |
| 決定 | 商品の API は `fields=BASIC\|DEFAULT\|FULL` で返す項目を選べる。一覧・検索は `DEFAULT`(既定)以下、商品詳細の本体だけ `FULL` を使う。目安: 検索 20 件で BASIC 約 3KB、FULL 約 25KB |
| 理由 | 件数の多い画面で `FULL` を頼むと、運ぶ量が 8 倍ほどになり、回線の遅いスマホで効く。CCv2 の OCC でも同じ考え方で `fields` を選ぶ |
| 却下した案 | いつも全部返す: 作るのは楽だが、一覧が重くなる。画面ごとに専用の API: API が画面に縛られる |
| 実物 | [apps/api/src/occ/format.js](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/apps/api/src/occ/format.js)・[apps/api/README.md](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/apps/api/README.md) |

### 4.8 検索を DB から外す(Solr) {#s4-8}
| 項目 | 内容 |
| --- | --- |
| 決定 | 本格版は検索を Solr で行う(`SEARCH_PROVIDER=solr`)。索引は worker の `searchIndexJob` が 60 秒ごとに作り直す。軽量版はメモリを抑えるため DB の `ILIKE` で代用する。Solr の返事は 2 秒(`SOLR_TIMEOUT_MS`)まで待ち、届かなければ検索だけ 503 |
| 理由 | `ILIKE '%…%'` は全件をなめるので、商品が増えると DB が詰まり、注文など他の処理まで遅くなる。索引を引く Solr なら件数が増えても速い。価格・在庫の変化が検索に出るまで最大 60 秒遅れることは受け入れる |
| 却下した案 | 本番でも DB で検索: 検索の混雑が DB 全体を巻き込む。問い合わせのたびに索引を作る: 遅い |
| 実物 | [occ/search.js](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/apps/api/src/occ/search.js)・[solr.js](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/apps/api/src/solr.js)・[aspects/worker.js](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/apps/api/src/aspects/worker.js) |

## 5. 目標 {#s5}
| 項目 | 目標 | 計算・根拠 |
| --- | --- | --- |
| 普通の利用者の p95 | 500ms 未満 | browse.js の `thresholds` |
| 普通の利用者の失敗率 | 1% 未満 | 同上 |
| ramp.js 50 人のときの流量 | 1 秒あたり 約 100 件 | 50 人 ÷ 0.5 秒 = 100 件/秒(応答時間を 0 と見た上限) |
| cdn-waf 経由の上限 | 1 秒 20 件(k6 の 1 IP。最初の 80 件はまとめて通る) | 100 件/秒 > 20 件/秒 なので、cdn-waf 経由では 429 が出る。**これが見どころ** |
| DB 接続 | 台数 × 10 本 | p1 なら api 2 + backoffice 1 + worker 1 = 4 台 → 最大 40 本 |
| 検索の返す量 | 20 件で BASIC 約 3KB / FULL 約 25KB | `fields` の違い |

## 6. 配下の詳細設計書 {#s6}
- [D-PERF-05 負荷試験](/design/detail/D-PERF-05-load-test)

## 7. 未決事項 {#s7}
| # | 内容 |
| --- | --- |
| 1 | 負荷試験のときだけ cdn-waf のレート制限を上げるか、送り元を分けるか(今はアプリ直接で測る) |
| 2 | 画面(ブラウザ)で測る速さ(最初の表示が出るまで)を目標に入れるか |
| 3 | 本格版で DB の検索と Solr の検索の p95 を並べて比べる試験を定番にするか |

## 8. レビュー観点 {#s8}
- [ ] 目標が平均ではなく p95 などで決まっているか
- [ ] 負荷試験のシナリオが、本番の使われ方(混ざり方・考える時間)に近いか
- [ ] 流量の計算式があるか(人数 ÷ 間隔)
- [ ] 前段の制限(レート制限・キャッシュ)を通した結果と、アプリだけの結果を分けて見ているか
- [ ] 一覧で必要以上の項目(`FULL`)を取っていないか
- [ ] 台数を増やしたとき、DB など後ろの上限を確かめているか

## この設計を体験する演習 {#exercises}
- [性能-1 負荷試験で限界を見る](/exercises/12-perf-load-test)
- [性能-2 台数を増やして耐える](/exercises/13-perf-scale-out)
- [FE-3 遅延読み込みと JS の予算](/exercises/03-fe-lazy-loading)
- [ネットワーク-1 前段のキャッシュ](/exercises/07-nw-cache)
