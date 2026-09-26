# D-PERF-05 負荷試験

版: 2.0 / 親: [性能方式](/design/architecture/07-performance) / 対象: [tools/k6/smoke.js](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/tools/k6/smoke.js)・[tools/k6/browse.js](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/tools/k6/browse.js)・[tools/k6/ramp.js](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/tools/k6/ramp.js)・[tools/k6.sh](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/tools/k6.sh)

::: tip 3 行まとめ(この文書で決めたこと)
- シナリオは 3 本。smoke.js(主な URL を 1 回ずつ。10 秒ほど)で大きく壊れていないか、browse.js(普通の利用者 5 人 × 2 分)で目標を守れるか、ramp.js(5 → 20 → 50 人)でどこが限界かを見ます。
- 合格線は smoke.js が確かめ 100%、browse.js が p95 500ms 未満・失敗 1% 未満、ramp.js が p95 1000ms 未満です。
- 同じシナリオを「利用者と同じ URL(cdn-waf → ingress 経由)」と「api・storefront に直接」の 2 通りで流し、入口の制限(429)とキャッシュの効きと、アプリの限界を分けて見ます。
:::

## 0. 親の方式設計書 {#s0}
| 項目 | 内容 |
| --- | --- |
| 親 | [性能方式](/design/architecture/07-performance) |
| 引き継ぐ決定 | 4.1 速さの目標、4.2 入口でためて減らす、4.4 負荷試験、4.5 台数を増やす、[4.7 fields](/design/architecture/07-performance#s4-7) |
| またがる層 | [セキュリティ方式 4.3](/design/architecture/10-security#s4-3)(cdn-waf の IP ごと 20r/s)、[SRE 方式](/design/architecture/05-sre)(Grafana で同時に見る) |

## 1. 目的と範囲 {#s1}
- **目的**: 目標を守れるか、どこで苦しくなるか、何が先に詰まるかを知る。
- **含む**: シナリオ、人数と時間、合格線、流量の計算、実行の方法、比べ方(キャッシュ・fields)、見る場所。
- **含まない**: 本番規模の容量計画。

## 2. 前提 {#s2}
| 前提 | 内容 |
| --- | --- |
| 道具 | `grafana/k6:1.8.1` を Docker で動かす(PC に入れない) |
| 送り元 | ラボのネットワーク `lab_default` の中のコンテナ 1 つ(= IP 1 つ)。`--add-host` で 3 つのホスト名を cdn-waf の IP(172.30.89.10)に向ける |
| 送り先 | 既定は `WWW_URL=http://www.lab.localhost:18080`・`API_URL=http://api.lab.localhost:18080`(利用者と同じ)。`API_URL=http://api:3001`・`WWW_URL=http://storefront:4000` で直接 |
| 商品 | `100001`〜`100030` からランダム |

## 3. 全体像 {#s3}
| 項目 | smoke.js(スモーク) | browse.js(普通の利用者) | ramp.js(段階的に増やす) |
| --- | --- | --- | --- |
| 人数(VU) | 1 人 × 1 回 | 5(`-e VUS=` で変更) | 30 秒で 5 → 1 分維持 → 30 秒で 20 → 1 分維持 → 30 秒で 50 → 1 分維持 → 30 秒で 0 |
| 時間 | 10 秒ほど | 2 分(`-e DURATION=` で変更) | 合計 5 分 |
| 1 人の動き | トップ・`/p/100001`・`/p/NO-SUCH-CODE`(404)・`/search`・検索 API・商品 API・CMS API・画像・トークン・注文の一覧・`/admin/chaos`(403) | トップの画面 → CMS API → 1 秒 → 検索 API(`pageSize=12`)→ 1 秒 → 商品 API(`fields=FULL`)→ 商品詳細の画面(`-e PAGES=0` で画面なし)→ 1〜3 秒 | 商品 API(`-e TARGET=page` なら商品詳細の画面)→ 0.5 秒 |
| 合格線 | `checks` が 100% | `http_req_failed` < 1%、`http_req_duration` の p95 < 500ms | `http_req_duration` の p95 < 1000ms |
| 確かめ | トップが `X-Render-Mode: ssr`、CMS のバナーがある、注文が取れる など | 各 200 か | 200 か、429 でないか、5xx でないか |

## 4. 仕様 {#s4}
### 4.1 流量の計算 {#s4-1}
| シナリオ | 式 | 1 秒あたり(目安) |
| --- | --- | --- |
| browse.js 5 人(画面あり) | 1 周 = 5 件(画面 2 + API 3)。1 周の時間 ≒ 1 秒 + 1 秒 + 平均 2 秒 = 約 4 秒 → 5 人 × 5 件 ÷ 4 秒 | 約 6 件 |
| browse.js 5 人(`PAGES=0`) | 1 周 = 3 件 → 5 × 3 ÷ 4 | 約 4 件 |
| ramp.js 5 人 | 5 人 ÷ 0.5 秒 | 最大 約 10 件 |
| ramp.js 20 人 | 20 ÷ 0.5 | 最大 約 40 件 |
| ramp.js 50 人 | 50 ÷ 0.5 | 最大 約 100 件 |

応答時間を 0 と見た上限です。実際は応答に時間がかかる分だけ少なくなります。
cdn-waf の上限は IP ごと 1 秒 20 件(+ まとめて 80 件)なので、**ramp.js を利用者と同じ URL で流すと、20 人の段でまとめ分を使い切ったあと 429 が出始める**のが見どころです。

### 4.2 実行の方法 {#s4-2}
| やりたいこと | コマンド |
| --- | --- |
| 大きく壊れていないか | `tools/k6.sh smoke.js` |
| 普通の利用者 | `tools/k6.sh browse.js` |
| 人数と時間を変える | `tools/k6.sh browse.js -e VUS=10 -e DURATION=5m` |
| API だけ | `tools/k6.sh browse.js -e PAGES=0` |
| 段階的に増やす(利用者と同じ URL) | `tools/k6.sh ramp.js` |
| 段階的に増やす(api に直接) | `API_URL=http://api:3001 tools/k6.sh ramp.js` |
| 画面(SSR)を段階的に | `tools/k6.sh ramp.js -e TARGET=page`(storefront に直接: `WWW_URL=http://storefront:4000 tools/k6.sh ramp.js -e TARGET=page`) |

### 4.3 見る場所 {#s4-3}
| 見る物 | 場所 |
| --- | --- |
| p95・失敗率・合否 | k6 の最後の要約(しきい値を満たさなければ失敗で終わる) |
| 成功率・p95・流量の変化 | Grafana「サンプルストア SLO」の storefront と api の段 |
| 429 の数 | k6 の `429 ではない` の確かめの割合、cdn-waf のログの `status` |
| キャッシュの効き | cdn-waf のログの `cache`(HIT の割合)、応答ヘッダ `X-Cache-Status` |
| SSR の時間 | Grafana「SSR 描画時間」「SSR フォールバック率」 |
| メモリ | Grafana「メモリ(RSS。api・backoffice・worker・storefront)」 |

### 4.4 比べ方と記録 {#s4-4}
| 比べる物 | 方法 | 分かること |
| --- | --- | --- |
| キャッシュあり / なし | `EDGE_CACHE=off docker compose up -d cdn-waf` のあと同じシナリオ。戻すのは `docker compose up -d cdn-waf` | 入口でためることで、api・storefront の負担がどれだけ減るか |
| fields の量 | 検索 API を `fields=BASIC` と `fields=FULL` で比べる(20 件で BASIC 約 3KB、FULL 約 25KB) | 返す項目の量が、通信量と応答時間にどう効くか |
| 入口あり / なし | 利用者と同じ URL と、`API_URL=http://api:3001` | 429 やキャッシュの影響を除いた、アプリだけの限界 |
| 台数 | 本格版で `kubectl -n lab scale deploy/api --replicas=3` | 台数を増やして耐えられるか。DB が先に詰まらないか |

試験のたびに、日時・版・シナリオ・送り先(入口経由 / 直接)・キャッシュの有無・人数・p95・失敗率・429 の割合・詰まった場所を 1 行で残し、前回と比べられるようにします。

## 5. 目標と確認方法 {#s5}
| 項目 | 目標 | 確かめ方 |
| --- | --- | --- |
| スモーク | 確かめがすべて通る | `tools/k6.sh smoke.js` |
| 普通の利用者(入口経由) | 合格(p95 < 500ms、失敗 < 1%) | `tools/k6.sh browse.js` の要約 |
| 限界(api 直接) | 50 人でも p95 < 1000ms | `API_URL=http://api:3001 tools/k6.sh ramp.js` |
| 入口の制限 | 入口経由の 20 人以上で 429 が出る(守りが効いている) | `tools/k6.sh ramp.js` |

## 6. 関連する文書 {#s6}
- [D-SEC-01 WAF とレート制限](/design/detail/D-SEC-01-waf-and-rate-limit)
- [D-NW-01 cdn-waf と ingress の経路とキャッシュ](/design/detail/D-NW-01-edge-route)(商品・CMS の API は 30 秒ためるので、入口経由は速く見える)
- [D-FE-04 商品詳細画面](/design/detail/D-FE-04-product-detail)(カルーセルは商品ごとに api を呼ぶ)

## 7. 未決事項 {#s7}
| # | 内容 |
| --- | --- |
| 1 | 入口経由で本当の限界を見るには、送り元を複数にするか、試験のときだけ制限を上げる(`EDGE_GLOBAL_RATE`) |
| 2 | ログイン・注文履歴(キャッシュされない API)を含むシナリオを足すか。トークンの発行は ingress で 1 秒 1 回に制限されている |
| 3 | 検索を Solr にした本格版(`SEARCH_PROVIDER=solr`)で、db の検索と速さを比べるか。応答ヘッダ `X-Search-Provider` でどちらが答えたか分かる |

## 8. レビュー観点 {#s8}
- [ ] シナリオに考える時間(sleep)が入っているか
- [ ] 流量の計算式があり、本番の見込みと比べてあるか
- [ ] キャッシュに当たる場合と当たらない場合を分けて見ているか
- [ ] 入口の制限を通した結果と、アプリだけの結果を分けているか
- [ ] 一覧で `fields=FULL` のような重い頼み方をしていないか
- [ ] 結果を前回と比べられる形で残しているか

## この設計を体験する演習 {#exercises}
- [性能-1 負荷試験で限界を見る](/exercises/12-perf-load-test)
- [性能-2 台数を増やして耐える](/exercises/13-perf-scale-out)
