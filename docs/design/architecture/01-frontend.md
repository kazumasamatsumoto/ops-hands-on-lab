# FE 方式設計書(ラボ)

版: 2.0 / 親: [全体方式](/design/architecture/00-overall) / 対象: storefront(Angular 21 SSR。CCv2 の JS Storefront に当たる)

::: tip 3 行まとめ(この文書で決めたこと)
- 画面は毎回サーバーで作る(SSR)。トップ・商品詳細・分類ページは、api の CMS の JSON(`cms/pages`)の部品の種類(`typeCode`)を見て Angular の部品を並べる「CMS 駆動の描画」にする。
- SSR は 3000ms で打ち切り、間に合わなければ空の HTML を返してブラウザに任せる(真っ白にしない)。api の住所は SSR 中は中の近道、ブラウザからは別オリジンの `http://api.lab.localhost:18080`。
- 最初に読む JS・CSS は 450kB を超えたらビルドを失敗させる。注文履歴は後から読み込む。
:::

## 0. 位置づけ {#s0}
全体方式の「利用者の通り道は cdn-waf の 1 か所」「設定は環境変数」「CCv2 + ヘッドレスの形に寄せる」を受けて、画面の作り方を決めます。
配下: [D-FE-04 商品詳細画面](/design/detail/D-FE-04-product-detail)、[D-FE-05 CMS 駆動の描画(ヘッドレス)](/design/detail/D-FE-05-headless-cms)、[D-FE-22 SSR サーバー](/design/detail/D-FE-22-ssr-server)。

## 1. 目的と範囲 {#s1}
- **含む**: 画面の一覧、描画方式(SSR / CSR)、CMS 駆動の描画、SSR で守る書き方、SSR の待ち時間と逃げ道、JS の予算と遅延読み込み、ログインの印の置き場所、api の呼び先(SSR とブラウザ)。
- **含まない**: 画面のデザイン、多言語、CMS の編集画面(ラボでは backoffice でバナーの文言だけを変えられる)。

画面は 7 つです(`/p/`・`/c/` の URL の形は SAP Commerce のアクセラレーター由来で、Composable Storefront も互換のために受け付けます。Composable Storefront の既定の形は `/product/…`・`/category/…` です)。

| URL | 中身 | CMS 駆動 |
| --- | --- | --- |
| `/` | トップ(`pageType=ContentPage&pageLabelOrId=homepage`) | はい |
| `/p/:code` | 商品詳細(`pageType=ProductPage&code=...`)。無い商品は HTTP 404 | はい |
| `/c/:code` | 分類ページ(`pageType=CategoryPage&code=...`。例 `/c/kitchen`)。無い分類は HTTP 404。メニューの分類のリンクは今は検索を指す | はい |
| `/search?q=` | 検索結果(`products/search?query=...`) | いいえ |
| `/login` | ログイン(OAuth のトークンをもらう) | いいえ |
| `/my-account/orders` | 注文履歴(遅延読み込み) | いいえ |
| `/my-account/orders/:code` | 注文の詳細 | いいえ |

## 2. 前提 {#s2}
| 前提 | 内容 |
| --- | --- |
| 部品 | Angular 21(スタンドアロン)、`@angular/ssr`。Express のサーバー(`src/server.ts`、ポート 4000)で配る |
| 入口 | 利用者は `http://www.lab.localhost:18080`(cdn-waf → ingress → storefront) |
| API | SSR 中は `API_INTERNAL_URL`(既定 `http://api:3001`)、ブラウザからは `API_PUBLIC_URL`(既定 `http://api.lab.localhost:18080`、別オリジンなので CORS が効く) |
| Host の確認 | Angular SSR は知らない Host ヘッダを 400 で断るので、`NG_ALLOWED_HOSTS` で `www.lab.localhost,storefront,localhost,127.0.0.1` を許可する |

## 3. 全体像 {#s3}
```text
ブラウザ ─▶ cdn-waf ─▶ ingress ─▶ storefront(server.ts)
                                  ├─ RENDER_MODE=csr → 空の HTML(殻)を返す → ブラウザが api を呼んで描く
                                  └─ RENDER_MODE=ssr → Angular がサーバーで描く
                                        GET http://api:3001/occ/v2/samplestore/cms/pages?...  (設計図)
                                        GET http://api:3001/occ/v2/samplestore/products/{code} (中身)
                                        ├─ 3000ms 以内 → 中身入りの HTML(X-Render-Mode: ssr)
                                        ├─ 間に合わない → 空の HTML(X-Render-Mode: fallback、Cache-Control: no-store)
                                        └─ 例外 → 500 の画面(ssr_errors_total が増える)
ブラウザ(表示のあと) ─▶ http://api.lab.localhost:18080/occ/v2/...(別オリジン。CORS)・/medias/...(画像)
```

## 4. 決定事項 {#s4}
### 4.1 描画方式 {#s4-1}
| 項目 | 内容 |
| --- | --- |
| 決定 | すべての画面をリクエストのたびにサーバーで描く(`RenderMode.Server`)。環境変数 `RENDER_MODE=csr` で CSR に切り替えられる。誰が描いたかを応答ヘッダ `X-Render-Mode` と `<html data-render-mode>` に出す |
| 理由 | 商品や在庫は変わるので、ビルド時の事前描画はしない。SSR にすると最初の表示が速く、検索エンジンにも中身が見える |
| 却下した案 | CSR だけ: 最初の HTML が空で、JS が動くまで何も見えない。事前描画(ビルド時): 在庫が古くなる |
| 実物 | [app.routes.server.ts](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/apps/web/src/app/app.routes.server.ts)・[server.ts](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/apps/web/src/server.ts) |

### 4.2 SSR で壊れない書き方 {#s4-2}
| 項目 | 内容 |
| --- | --- |
| 決定 | サーバーで動くコードでは `window`・`document`・`sessionStorage` を直接触らない。触るときは `isPlatformBrowser()` で確かめるか、`afterNextRender()` の中で触る |
| 理由 | サーバー(Node.js)には `window` が無く、「window is not defined」で描画が止まり、SSR が 500 になる。開発者の PC(ブラウザ)では動くので気づきにくい |
| 却下した案 | 見つけたら直す: 1 か所でも入ると全画面が 500 になる。規約とレビューで入口で止める |
| 実物 | わざと壊した例: [app.ts](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/apps/web/src/app/app.ts)(`SSR_WINDOW_BUG=true` のときだけ動く) |

### 4.3 SSR のタイムアウトと逃げ道 {#s4-3}
| 項目 | 内容 |
| --- | --- |
| 決定 | SSR は `SSR_TIMEOUT_MS`(既定 3000)で打ち切り、CSR の空の HTML を返す(フォールバック)。そのとき `Cache-Control: no-store` を付けて cdn-waf にためさせず、ログに `ssr_fallback` を出し、`ssr_fallback_total` を 1 増やす |
| 理由 | api が遅いと SSR も遅くなり、サーバーの手がふさがって全体が止まる。空の HTML でも、ブラウザが後から画面を作れば利用者は買い物を続けられる |
| 却下した案 | 待ち続ける: 利用者は真っ白な画面で待たされ、storefront も巻き込まれて落ちる。すぐ 500 を返す: 画面を出せたはずの人まで止める |
| 実物 | [server.ts](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/apps/web/src/server.ts)(`sendCsrShell`)。詳細は [D-FE-22](/design/detail/D-FE-22-ssr-server) |

### 4.4 遅延読み込みと JS の予算 {#s4-4}
| 項目 | 内容 |
| --- | --- |
| 決定 | 注文履歴(`/my-account/orders` 以下)は `loadChildren` で後から読む。最初に読む JS・CSS の合計(initial)は 400kB で警告、450kB でビルド失敗。部品 1 つの CSS は 4kB で警告、8kB で失敗 |
| 理由 | 使う人の少ない画面の部品を、全員が最初に読まないようにする。重くなったことに、作った時点で気づく |
| 却下した案 | 予算なし: ライブラリを 1 つ足すたびに少しずつ重くなり、誰も気づかない |
| 実物 | [app.routes.ts](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/apps/web/src/app/app.routes.ts)・[angular.json](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/apps/web/angular.json)(`budgets`) |

### 4.5 ログインの印の置き場所 {#s4-5}
| 項目 | 内容 |
| --- | --- |
| 決定 | OAuth の `access_token`(15 分)はメモリに持ち、ブラウザでは `sessionStorage` にも控える(タブを閉じると消える)。`localStorage` には置かない。サーバーでは保存しない。`Authorization` は `/users/` の下の呼び出しにだけ付ける。注文のような本人だけのデータは、サーバーからの申し送り(TransferState)に入れない |
| 理由 | `localStorage` はずっと残り、盗まれたときの被害が大きい。サーバーのメモリは全員で共有なので、置くと他人の印が混ざる。商品の呼び出しに `Authorization` を付けると、cdn-waf のキャッシュが効かず、毎回 CORS の下見(プリフライト)も飛ぶ |
| 却下した案 | Cookie に入れる: cdn-waf のキャッシュの扱いが複雑になり、CSRF の対策も要る(ラボのお店は Cookie を使わない) |
| 実物 | [auth.service.ts](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/apps/web/src/app/core/auth.service.ts)・[api-base.interceptor.ts](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/apps/web/src/app/core/api-base.interceptor.ts) |

### 4.6 CMS 駆動の描画(ヘッドレス) {#s4-6}
| 項目 | 内容 |
| --- | --- |
| 決定 | トップ・商品詳細・分類ページは、URL からページ(`pageType` と `pageLabelOrId` / `code`)を決め、`GET /occ/v2/samplestore/cms/pages` の JSON を取る。スロット(`contentSlots.contentSlot[]`)を返ってきた順に並べ、中の部品は `typeCode` を**対応表 1 か所**(`cms-mapping.ts`)で引いて Angular の部品を当てはめる(`SimpleBannerComponent`・`CMSParagraphComponent`・`ProductCarouselComponent`・`ProductDetailsComponent`・`SearchBoxComponent`・`NavigationComponent` の 6 種類)。表に無い `typeCode` は描かずに飛ばし、ログに `cms_unknown_component` を出す(画面は落とさない) |
| 理由 | 「どこに・何を置くか」をコードではなく CMS のデータで決められる。backoffice でバナーの文言を変えると、storefront を作り直さずにトップが変わる。部品を増やすときは Angular の部品を 1 つ作り、対応表に 1 行足すだけ。CMS 側に新しい部品が先に置かれても、サイトは止まらない |
| 却下した案 | 画面ごとに並びをコードに書く: 文言やバナーの差し替えのたびにリリースが要る。知らない部品で例外にする: CMS の更新 1 つで全画面が 500 になる |
| 実物 | [cms-mapping.ts](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/apps/web/src/app/cms/cms-mapping.ts)・[cms-page.ts](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/apps/web/src/app/cms/cms-page.ts)・[cms-route.ts](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/apps/web/src/app/cms/cms-route.ts)。詳細は [D-FE-05](/design/detail/D-FE-05-headless-cms) |

### 4.7 api の住所を SSR とブラウザで分ける {#s4-7}
| 項目 | 内容 |
| --- | --- |
| 決定 | SSR 中は中の近道 `API_INTERNAL_URL`(`http://api:3001`)で呼ぶ。ブラウザは `API_PUBLIC_URL`(`http://api.lab.localhost:18080`)で呼ぶ。この住所は JS に焼き込まず、`server.ts` が返す HTML に `<meta name="api-public-url">` として書き足す。画像の `<img src>` は SSR 中でも外向きの住所にする(読むのはブラウザだから)。SSR で取った CMS・商品の JSON は TransferState でブラウザに申し送り、最初の表示で api を呼び直さない |
| 理由 | SSR 中に外向きの住所を使うと、cdn-waf・ingress を 1 周して遅く、レート制限にも数えられる。住所を HTML で渡すと、同じイメージを d1・s1・p1 で使える。`<script>` でなく `<meta>` なので CSP に引っかからない |
| 却下した案 | ブラウザもサーバーも同じ住所: どちらか一方で届かない。環境ごとにビルドし直す: 検証した物と本番の物が別物になる |
| 実物 | [server.ts](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/apps/web/src/server.ts)(`decorateHtml`)・[tokens.ts](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/apps/web/src/app/core/tokens.ts)・[api.service.ts](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/apps/web/src/app/core/api.service.ts) |

## 5. 目標 {#s5}
| 項目 | 目標 | 測る場所 |
| --- | --- | --- |
| SSR の打ち切り | 3000ms | `ssr_render_duration_seconds{route}`(ヒストグラム) |
| フォールバック率 | 5 分間で 5% 以下(超えて 1 分続けば警告) | `job:ssr_fallback:ratio_rate5m`。計算式 = フォールバック回数 ÷ SSR を試みた回数 |
| SSR のエラー | 0 件(1 件でも 1 分続けば警告) | `job:ssr_errors:rate5m` |
| 知らない CMS 部品 | 0 件(出たら対応表の追加漏れ) | ログの `cms_unknown_component` |
| 最初に読む JS・CSS | 450kB 以下(ビルドで強制。今は約 336kB) | `ng build` の結果 |

## 6. 配下の詳細設計書 {#s6}
- [D-FE-04 商品詳細画面](/design/detail/D-FE-04-product-detail)
- [D-FE-05 CMS 駆動の描画(ヘッドレス)](/design/detail/D-FE-05-headless-cms)
- [D-FE-22 SSR サーバー(server.ts)](/design/detail/D-FE-22-ssr-server)

## 7. 未決事項 {#s7}
| # | 内容 |
| --- | --- |
| 1 | SSR の打ち切り時間を画面ごとに変えるか(今は全画面 3000ms) |
| 2 | ページの template ごとのスロットの並び(レイアウト設定)を storefront 側に持つか。今は api が返した順のまま並べる |
| 3 | CMS の部品を遅延読み込みにするか。今は分かりやすさを優先して最初から全部読み込む |
| 4 | 対応ブラウザと画面幅の一覧(ラボでは決めていない) |

## 8. レビュー観点 {#s8}
- [ ] サーバーで動くコードで `window`・`document` を直接触っていないか
- [ ] SSR の打ち切り時間と、そのとき返す物(空の HTML、キャッシュさせない印)が決まっているか
- [ ] `typeCode` → 部品の対応表が 1 か所にあり、知らない部品で画面が落ちないか
- [ ] SSR 中とブラウザで api の住所が分かれていて、外向きの住所が JS に焼き込まれていないか
- [ ] JS の予算がビルドに組み込まれていて、超えたら失敗するか
- [ ] ログインの印を `localStorage` やサーバーの共有メモリに置いていないか。本人だけのデータを申し送りに載せていないか

## この設計を体験する演習 {#exercises}
- [FE-1 SSR と CSR を見比べる](/exercises/01-fe-ssr-vs-csr)
- [FE-2 SSR で壊れる書き方](/exercises/02-fe-ssr-rules)
- [FE-3 遅延読み込みと JS の予算](/exercises/03-fe-lazy-loading)
- [ヘッドレス-1 CMS の JSON が画面になるまで](/exercises/21-headless-cms)
- [障害-1 API が遅い → SSR が逃げる](/exercises/14-incident-slow-api)
