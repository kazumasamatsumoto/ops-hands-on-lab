# D-QA-04 E2E テスト

版: 2.0 / 親: [QA 方式](/design/architecture/06-qa) / 対象: 主要な導線(トップ → 検索 → 商品詳細 → ログイン → 注文履歴)・他人の注文・画面比較([tools/e2e/](https://github.com/kazumasamatsumoto/ops-hands-on-lab/tree/main/tools/e2e)・[tools/e2e.sh](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/tools/e2e.sh))

::: tip 3 行まとめ(この文書で決めたこと)
- Playwright で、利用者と同じ URL(`http://www.lab.localhost:18080`)から cdn-waf → ingress → storefront / api を端から端までなぞります。シナリオは「買い物の導線」「無い商品は 404」「他人の注文が見えない」「画面比較 3 枚」です。
- 確かめるのは、利用者が頼りにする物(見出し・商品名・価格・注文の合計)と、目に見えにくい物(`X-Render-Mode: ssr`、ブラウザが別オリジンの api を呼べていること、CSP・CORS のエラーが出ていないこと)です。
- わざと壊すスイッチを入れたら落ちること(= テストが効いていること)も確かめます。
:::

## 0. 親の方式設計書 {#s0}
| 項目 | 内容 |
| --- | --- |
| 親 | [QA 方式](/design/architecture/06-qa) |
| 引き継ぐ決定 | 4.1 テストの種類(見えてはいけない物)、4.2 E2E テスト、4.3 画面比較 |
| またがる層 | [D-BE 注文 API](/design/detail/D-BE-orders-api)(認可・CORS)、[D-FE-04 商品詳細画面](/design/detail/D-FE-04-product-detail)、[D-FE-05 CMS 駆動の描画](/design/detail/D-FE-05-headless-cms)、[セキュリティ方式 4.5](/design/architecture/10-security#s4-5)(CSP) |

## 1. 目的と範囲 {#s1}
- **目的**: 変更のたびに「買い物の途中で行き止まりにならない」「他人の注文が見えない」「見た目が崩れていない」を機械で確かめる。
- **含む**: シナリオ、確かめる物、データ、動かし方、画面比較の決まり、壊したときに落ちることの確認。
- **含まない**: 単体テスト、負荷([D-PERF-05](/design/detail/D-PERF-05-load-test))。

## 2. 前提 {#s2}
| 前提 | 内容 |
| --- | --- |
| 道具 | Playwright 1.63.0(Docker イメージ `mcr.microsoft.com/playwright:v1.63.0-noble`。テストの道具とイメージの版をそろえる) |
| 動かし方 | `tools/e2e.sh`。テストのコンテナを cdn-waf と同じネットワークの部屋(`--network container:<cdn-waf>`)に入れる。ブラウザは `*.localhost` を必ず自分自身(127.0.0.1)として引くので、そこで待っている cdn-waf に届く |
| 相手 | `BASE_URL`(既定 `http://www.lab.localhost:18080`)。api は `http://api.lab.localhost:18080`(別オリジン) |
| データ | 見本の会員 `alice`・`bob`(パスワード `password`)、商品 `100001`(ノート A5 方眼、￥330)、alice の注文 `00001001`(合計 ￥1,485) |
| 並列 | しない(`workers: 1`)。cdn-waf の「IP ごとに 1 秒 20 回」と、ingress の「ログインは 1 秒 1 回」に当たらないようにするため |
| 実物 | [playwright.config.ts](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/tools/e2e/playwright.config.ts)・[tests/](https://github.com/kazumasamatsumoto/ops-hands-on-lab/tree/main/tools/e2e/tests) |

## 3. 全体像 {#s3}
| # | シナリオ(ファイル) | 手順 | 確かめる物 |
| --- | --- | --- | --- |
| 1 | 買い物の導線([journey.spec.ts](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/tools/e2e/tests/journey.spec.ts)) | トップ → 検索(ノート)→ 商品詳細 → ログイン(alice)→ 注文履歴 → 注文の詳細 | トップが 200 で `x-render-mode: ssr`、バナーの見出し「秋の文房具フェア」、`data-cms-type="ProductCarouselComponent"` の部品、検索結果、`/p/100001` の商品名と ￥330、ブラウザが `/occ/v2/samplestore/` を呼んだこと、注文 `00001001` の合計 ￥1,485、CSP・CORS のエラーが 0 件 |
| 2 | 無い商品(journey.spec.ts) | `/p/NO-SUCH-CODE` を開く | 状態コード 404 と「ページを表示できませんでした」 |
| 3 | 他人の注文が見えない([authz.spec.ts](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/tools/e2e/tests/authz.spec.ts)) | bob でログイン → `/my-account/orders/00001001`(alice の注文)を直接開く | 「注文を表示できませんでした」と出て、合計の行が 0 件 |
| 4 | 画面比較([visual.spec.ts](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/tools/e2e/tests/visual.spec.ts)) | `/`・`/search?q=ノート`・`/p/100001` の画面全体を撮る | 基準画像(`top`・`search`・`product-detail`)との違いが 50 画素以内 |

## 4. 仕様 {#s4}
### 4.1 確かめ方の決まり {#s4-1}
| 決まり | 内容 | 理由 |
| --- | --- | --- |
| 見つけ方 | 画面の文字や役割(見出し・リンク・ボタン・検索の欄)で探す。CMS の部品は `data-cms-type` で探す | HTML の細かい形(クラス名)に頼ると、見た目を少し変えただけで落ちる |
| 待ち方 | 「見えるまで待つ」を使い、固定の秒数では待たない(見えるまでの上限 10 秒、1 本 45 秒) | 速い日も遅い日も同じ結果にする |
| データ | 見本のデータだけを使い、テストの中で変えない | 何度流しても同じ結果にする |
| 描画モード | トップで応答ヘッダ `x-render-mode` が `ssr` であることも見る | SSR が壊れて CSR に逃げていても画面は出るので、見た目だけでは気づけない |
| 別オリジン | 画面の中の移動で、ブラウザが api(`http://api.lab.localhost:18080`)に fetch したことを記録して確かめる | CORS の設定が壊れると、画面の中の移動だけが失敗する |
| ブラウザのエラー | コンソールとページのエラーを集め、`Content Security Policy`・`CORS`・`Access-Control` を含むものが 0 件 | CSP や CORS の設定ミスは、画面が一部欠けるだけで見落としやすい |

### 4.2 画面比較の決まり {#s4-2}
| 決まり | 内容 |
| --- | --- |
| 基準画像 | 最初に撮った画像を基準として `tests/visual.spec.ts-snapshots/` に保存し、リポジトリで管理する |
| 画面の大きさ | 1280 × 800 に固定する(Desktop Chrome、`ja-JP`、`Asia/Tokyo`) |
| 許す違い | 50 画素まで(`maxDiffPixels: 50`)。「画面の 1%」のような割合にすると 1 万画素まで見逃すため |
| 隠す部分 | 毎回変わる部分を隠してから比べる: 画面下の「描画モード」、在庫の数と「在庫なし」の印(worker の `stockImportJob` が 60 秒ごとに在庫を少し変えるため) |
| 更新 | 意図した見た目の変更なら `tools/e2e.sh --update-snapshots` で撮り直し、レビューで承認する |

### 4.3 壊したときに落ちること {#s4-3}
| スイッチ | 落ちるべきシナリオ | 理由 |
| --- | --- | --- |
| `tools/chaos.sh set idorBug=true` | 3(他人の注文が見える) | 認可の抜けを見つけられるか |
| `tools/chaos.sh set errorRate=1` | 1(トップの CMS・商品が取れない) | API の障害を見つけられるか |
| `SSR_WINDOW_BUG=true docker compose up -d storefront` | 1(500 の画面) | SSR の不具合を見つけられるか |
| `CORS_ALLOWED_ORIGINS` から www を外して api を起動し直す | 1(画面の中の移動で api が読めない) | CORS の設定ミスを見つけられるか |

確かめたら必ず `tools/chaos.sh reset`(storefront・api は `docker compose up -d storefront api`)で戻す。

## 5. 目標と確認方法 {#s5}
| 項目 | 目標 |
| --- | --- |
| 通常時 | 全部通る(`tools/e2e.sh`) |
| 壊したとき | 4.3 の表のとおりに落ちる |
| 所要時間 | 数分以内(変更のたびに流せる長さ) |
| 結果の報告 | `tools/e2e/playwright-report/index.html`(失敗したときの画面・差分の画像・操作の記録) |

## 6. 関連する文書 {#s6}
- [QA 方式](/design/architecture/06-qa)
- [D-BE 注文 API と認可](/design/detail/D-BE-orders-api)
- [D-FE-05 CMS 駆動の描画(ヘッドレス)](/design/detail/D-FE-05-headless-cms)

## 7. 未決事項 {#s7}
| # | 内容 |
| --- | --- |
| 1 | スマホの画面幅でも比べるか |
| 2 | 自動で流す場所(CI)をラボに入れるか |
| 3 | backoffice(管理画面)の導線と、社外からは 403 になることの確認を足すか |
| 4 | 本格版(d1・s1・p1)でも同じテストを流すか。d1・s1 はお店も社内からだけなので、流す場所の IP に注意する |

## 8. レビュー観点 {#s8}
- [ ] 利用者が買い物を終えるまでの導線が入っているか
- [ ] 「見えてはいけない物が見えない」シナリオがあるか
- [ ] SSR で描けていること、別オリジンの api を呼べていることを、見た目以外でも確かめているか
- [ ] 固定の秒数で待っていないか
- [ ] わざと壊したときに本当に落ちることを確かめたか
- [ ] 基準画像の更新に承認の流れがあるか

## この設計を体験する演習 {#exercises}
- [QA-1 E2E テストと画面比較](/exercises/11-qa-e2e-regression)
- [BE-1 API と認可の事故](/exercises/04-be-api-and-authz)
