# D-FE-04 商品詳細画面

版: 2.0 / 親: [FE 方式](/design/architecture/01-frontend) / 対象: `/p/:code`(例: `/p/100001`)

::: tip 3 行まとめ(この文書で決めたこと)
- 商品詳細は **CMS 駆動の画面**です。api の `cms/pages?pageType=ProductPage&code=...` が返す枠(スロット)に、商品の本体(`ProductDetailsComponent`)と「同じ分類の商品」(`ProductCarouselComponent`)を並べます。
- 本体は `GET /occ/v2/samplestore/products/{code}?fields=FULL` で商品を取り、SSR の結果を HTML と一緒にブラウザへ申し送ります(ブラウザは同じ API を呼び直しません)。無い商品は **HTTP 404** を返します。
- cdn-waf で 30 秒ためる画面なので、**人によって変わる物(ログイン名など)を中身に入れません**。画像は api の外向きの住所(`API_PUBLIC_URL`)の `/medias/` から読みます。
:::

## 0. 親の方式設計書 {#s0}
| 項目 | 内容 |
| --- | --- |
| 親 | [FE 方式](/design/architecture/01-frontend) |
| 引き継ぐ決定 | 4.1 描画方式(毎回 SSR)、4.3 SSR の打ち切り 3000ms、4.5 本人だけのデータは申し送らない、[4.6 CMS 駆動の描画](/design/architecture/01-frontend#s4-6)、[4.7 api の住所](/design/architecture/01-frontend#s4-7) |
| またがる層 | [ネットワーク方式 4.2](/design/architecture/04-network#s4-2)(この画面は 30 秒ためる)、[BE 方式](/design/architecture/02-backend)(OCC の商品 API と CMS API)、[性能方式 4.7](/design/architecture/07-performance#s4-7)(fields) |

## 1. 目的と範囲 {#s1}
- **目的**: 利用者が商品を選ぶための情報を出す。検索エンジンにも中身を見せる。
- **含む**: 画面の枠と部品、表示項目、状態、API の呼び方、SSR とキャッシュの注意、無い商品の扱い。
- **含まない**: カートへの追加(ラボには無い)。CMS 駆動の描画の仕組みそのもの([D-FE-05](/design/detail/D-FE-05-headless-cms))。

## 2. 前提 {#s2}
| 前提 | 内容 |
| --- | --- |
| URL | `/p/:code`(`:code` は商品コード。見本は `100001`〜`100030`)。CCv2 の Composable Storefront の商品ページの URL の形に合わせています |
| ルート | [app.routes.ts](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/apps/web/src/app/app.routes.ts) の `p/:code` → `CmsRoute`(`data: { pageType: 'ProductPage' }`)。最初の JS に入ります(遅延読み込みしません) |
| 部品 | [cms-route.ts](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/apps/web/src/app/cms/cms-route.ts)(CMS のページを取る)・[product-details.ts](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/apps/web/src/app/cms/components/product-details.ts)(商品の本体)・[product-carousel.ts](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/apps/web/src/app/cms/components/product-carousel.ts)(同じ分類の商品) |
| CMS のページ | api の [cms.js](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/apps/api/src/occ/cms.js)。ページ `productDetails`(テンプレート `ProductDetailsPageTemplate`)を返し、`ProductRelatedCarousel` の `productCodes` に同じ分類の商品を最大 8 件入れます |

## 3. 全体像 {#s3}
```text
ブラウザ ─▶ cdn-waf(www の /p/... は 30 秒ためる)─▶ ingress(www → storefront)─▶ storefront(SSR)
  storefront(SSR 中は API_INTERNAL_URL = http://api:3001 を直接呼ぶ)
    1. CmsRoute      ─ GET /occ/v2/samplestore/cms/pages?pageType=ProductPage&code=100001
    2. 枠を順に並べる  SearchBox → NavigationBar → Summary → CrossSelling → Footer
    3. Summary の ProductDetailsComponent ─ GET /occ/v2/samplestore/products/100001?fields=FULL
       CrossSelling の ProductCarouselComponent ─ 商品ごとに GET /products/{code}?fields=DEFAULT
    4. 受け取った JSON を TransferState(申し送り)に入れて HTML に添える
ブラウザ: ハイドレーション。申し送りがあれば api を呼ばずに使う(1 回だけ)
  画像: <img src="http://api.lab.localhost:18080/medias/100001.svg">(ブラウザが api から直接読む)
```

## 4. 仕様 {#s4}
### 4.1 表示項目 {#s4-1}
商品の本体(`ProductDetailsComponent`)が出す物です。api の項目は `fields=FULL` の返事です。

| 項目 | API の項目 | 表示 | 無いとき |
| --- | --- | --- | --- |
| 商品名 | `name` | 見出し(h1)。ページの題名も「商品名 \| サンプルストア」 | — |
| 価格 | `price.formattedValue` | 例: `￥330` | — |
| 在庫 | `stock.stockLevelStatus`・`stock.stockLevel` | `inStock`: 「あり(N 個)」/ `lowStock`(5 個以下): 「残りわずか(N 個)」/ `outOfStock`: 「在庫なし」の印 | 在庫の行を出さない |
| 短い説明 | `summary` | 段落 | 出さない |
| 説明 | `description`(FULL のときだけ返る) | 段落 | 出さない |
| 分類 | `categories[].name` | 「カテゴリ: …」 | 出さない |
| 画像 | `images[0].url`(`/medias/100001.svg`) | 480 × 300。`API_PUBLIC_URL` を前に付ける([media.pipe.ts](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/apps/web/src/app/core/media.pipe.ts)) | 「画像なし」の枠 |
| 商品コード | `code` | 「商品コード: 100001」 | — |

「同じ分類の商品」(`CrossSelling` の枠)は、CMS が持つ `productCodes`(空白区切りの商品コード)を 1 件ずつ `fields=DEFAULT` で取り、商品名・価格・画像を並べます。1 件が 404 でも並び全体は出します。

### 4.2 状態 {#s4-2}
| 状態 | 表示 | HTTP の状態コード(SSR) |
| --- | --- | --- |
| 読み込み中 | 「読み込み中…」 | — |
| CMS のページが無い(商品コードが無い) | 「ページを表示できませんでした。見つかりませんでした。」 | **404**(`RESPONSE_INIT` で書き換える) |
| 商品の取得が失敗 | 「商品が見つかりません」+ 状態コードごとの短い説明(401・403・404・429・5xx・届かない = CORS の可能性) | 404 のときは **404** |
| 表示 | 4.1 の項目 | 200 |

無い商品に 200 を返すと、検索エンジンが中身の無いページを登録し、監視でも気づけません。そのため SSR の応答も 404 にします。
実物: [product-details.ts](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/apps/web/src/app/cms/components/product-details.ts)・[cms-route.ts](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/apps/web/src/app/cms/cms-route.ts)・[describeError](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/apps/web/src/app/core/api.service.ts)

### 4.3 API の呼び方 {#s4-3}
| 項目 | 内容 |
| --- | --- |
| 呼ぶ API | `GET /occ/v2/samplestore/cms/pages?pageType=ProductPage&code={code}`、`GET /occ/v2/samplestore/products/{code}?fields=FULL`、カルーセルは `?fields=DEFAULT` |
| 呼び先 | サーバー(SSR 中)は `API_INTERNAL_URL`(`http://api:3001`)、ブラウザは `API_PUBLIC_URL`(`http://api.lab.localhost:18080`。別オリジンなので CORS が効く)。前半の付け替えは [api-base.interceptor.ts](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/apps/web/src/app/core/api-base.interceptor.ts) |
| ログインの印 | 付けない(`Authorization` を付けるのは `/users/` の下だけ)。付けると cdn-waf がためず、ブラウザは毎回プリフライト(OPTIONS)を送るため |
| 申し送り | サーバーで取った結果を `api:<パス>?<問い合わせ>` の名札で TransferState に入れる。404 も「無かった」印として申し送る。ブラウザは最初の 1 回だけそれを使い、使ったら消す |
| fields | 詳細は項目が多い `FULL`、並びは軽い `DEFAULT`。一覧で `FULL` を頼むと重くなる([性能方式 4.7](/design/architecture/07-performance#s4-7)) |
| 実物 | [api.service.ts](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/apps/web/src/app/core/api.service.ts) |

### 4.4 SSR とキャッシュの注意 {#s4-4}
| 項目 | 内容 |
| --- | --- |
| 画面のキャッシュ | cdn-waf が `www.lab.localhost` の `/p/...` の HTML を 30 秒ためる。だから中身に人ごとの情報を入れない |
| API のキャッシュ | cdn-waf が api の `products/{code}` と `cms/pages` も 30 秒ためる(ブラウザから呼んだとき)。画像 `/medias/` は 1 日 |
| 変更の反映 | backoffice で価格・在庫を変えても、キャッシュが切れるまで(最大 30 秒)古い値が出る |
| 打ち切り | api が遅く SSR が 3000ms を超えると、空の HTML が返る(`X-Render-Mode: fallback`)。空の HTML は `Cache-Control: no-store` なのでためない |
| 書き方 | この部品では `window` などブラウザだけの物を触らない |
| 在庫の変化 | worker の `stockImportJob` が 60 秒ごとに在庫を少し変える。画面比較のテストでは在庫の行を隠す |

## 5. 目標と確認方法 {#s5}
| 項目 | 目標 | 確かめ方 |
| --- | --- | --- |
| SSR | HTML に商品名と CMS の部品が入っている | `curl -s http://www.lab.localhost:18080/p/100001 \| grep -o 'data-cms-type="[^"]*"'` に `ProductDetailsComponent` と `ProductCarouselComponent` |
| 描画モード | `ssr` | 応答ヘッダ `X-Render-Mode: ssr`、画面の一番下の「描画モード」 |
| キャッシュ | 2 回目は `HIT` | `curl -sI http://www.lab.localhost:18080/p/100001 \| grep -i x-cache` を 2 回。`MISS` → `HIT` |
| 無い商品 | 404 | `curl -s -o /dev/null -w '%{http_code}\n' http://www.lab.localhost:18080/p/NO-SUCH-CODE` |
| API の呼び直し | 最初の表示で商品の API をブラウザが呼ばない | ブラウザの開発者ツールの Network で、最初の表示の api への fetch が 0 件 |

## 6. 関連する文書 {#s6}
- [D-FE-05 CMS 駆動の描画(ヘッドレス)](/design/detail/D-FE-05-headless-cms)(枠と部品の並べ方)
- [D-FE-22 SSR サーバー](/design/detail/D-FE-22-ssr-server)(打ち切りとフォールバック)
- [D-NW-01 cdn-waf と ingress の経路とキャッシュ](/design/detail/D-NW-01-edge-route)
- 仕組みの説明: [storefront の SSR](/how-it-works/04-storefront-ssr)・[CMS 駆動の描画](/how-it-works/05-headless-cms)

## 7. 未決事項 {#s7}
| # | 内容 |
| --- | --- |
| 1 | 「同じ分類の商品」は商品ごとに api を呼ぶ(8 件なら 8 回)。SSR が遅くなる原因になりやすいので、`products/search` 1 回にまとめるか |
| 2 | 画像は api がその場で作る SVG。実物の写真にするとき、大きさの違う画像(`format`)をどう選ぶか |

## 8. レビュー観点 {#s8}
- [ ] キャッシュされる画面に、人ごとの情報が入っていないか
- [ ] サーバーで取った結果を申し送り、ブラウザで二重に呼んでいないか
- [ ] 無い商品で、画面の文言だけでなく状態コードも 404 になっているか
- [ ] 画像の URL が内側の住所(`http://api:3001`)になっていないか
- [ ] エラーのときに真っ白にならず、次の行動が分かる文が出るか
- [ ] 値が無い項目で画面が壊れないか

## この設計を体験する演習 {#exercises}
- [FE-1 SSR と CSR を見比べる](/exercises/01-fe-ssr-vs-csr)
- [ネットワーク-1 前段のキャッシュ](/exercises/07-nw-cache)
- [ヘッドレス-1 CMS の JSON が画面になるまで](/exercises/21-headless-cms)
