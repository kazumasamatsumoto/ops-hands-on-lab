# D-FE-05 CMS 駆動の描画(ヘッドレス)

版: 2.0 / 親: [FE 方式](/design/architecture/01-frontend) / 対象: [apps/web/src/app/cms/](https://github.com/kazumasamatsumoto/ops-hands-on-lab/tree/main/apps/web/src/app/cms)・[apps/api/src/occ/cms.js](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/apps/api/src/occ/cms.js)

::: tip 3 行まとめ(この文書で決めたこと)
- 「どの画面に・どの枠(スロット)に・どの部品を・どの順で置くか」は storefront のコードに書かず、api の `GET /occ/v2/samplestore/cms/pages` が JSON で返します。storefront は JSON を見て部品を並べるだけです(ヘッドレスの核心)。
- 部品の種類(`typeCode`)→ Angular の部品の対応表は、アプリの中で 1 か所([cms-mapping.ts](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/apps/web/src/app/cms/cms-mapping.ts))だけに持ちます。表に無い `typeCode` は描かずに飛ばし、ログ `cms_unknown_component` に残します(画面は落とさない)。
- backoffice でトップのバナーの文言を変えると、storefront を作り直さなくても画面が変わります。ただし cdn-waf のキャッシュ(30 秒)が切れるまでは古い文言が出ます。
:::

## 0. 親の方式設計書 {#s0}
| 項目 | 内容 |
| --- | --- |
| 親 | [FE 方式](/design/architecture/01-frontend) |
| 引き継ぐ決定 | [4.6 CMS 駆動の描画](/design/architecture/01-frontend#s4-6)、[4.7 api の住所](/design/architecture/01-frontend#s4-7)、4.1 描画方式(毎回 SSR)、4.3 SSR の打ち切り |
| またがる層 | [全体方式 4.6](/design/architecture/00-overall#s4-6)(CCv2 + ヘッドレスに寄せる)、[BE 方式](/design/architecture/02-backend)(CMS の API)、[ネットワーク方式 4.2](/design/architecture/04-network#s4-2)(cms/pages を 30 秒ためる) |

## 1. 目的と範囲 {#s1}
- **目的**: 画面の並びや文言を、アプリを作り直さずに CMS のデータだけで変えられるようにする。そのときに、知らない部品が来ても画面が落ちないようにする。
- **含む**: CMS の API の頼み方と返事の形、枠の位置、部品の種類と対応表、並べ方、知らない部品の扱い、申し送り(TransferState)、変更が画面に出るまで。
- **含まない**: 部品ごとの見た目の細部、商品詳細の中身([D-FE-04](/design/detail/D-FE-04-product-detail))、CMS の編集画面(ラボでは backoffice のバナーの文言だけ)。

## 2. 前提 {#s2}
| 前提 | 内容 |
| --- | --- |
| CCv2 で当たるもの | Composable Storefront の「CMS 駆動の描画」。api は OCC の CMS ページの API、対応表は storefront の設定の「cmsComponents」(typeCode ごとの部品の登録)に当たる。このラボはその簡略版 |
| CMS のデータ | api の DB の `cms_pages`・`cms_slots`・`cms_slot_components`・`cms_components`。見本は [seed-data.js](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/apps/api/src/seed-data.js) |
| CMS 駆動の画面 | `/`(トップ)・`/p/:code`(商品詳細)・`/c/:code`(分類ページ)。`/search`・`/login`・`/my-account/orders` は CMS を使わない普通の画面 |
| api の住所 | SSR 中は `API_INTERNAL_URL`(`http://api:3001`)、ブラウザは `API_PUBLIC_URL`(`http://api.lab.localhost:18080`) |

## 3. 全体像 {#s3}
```text
URL /  ─▶ app.routes.ts: CmsRoute, data { pageType: 'ContentPage', pageLabelOrId: 'homepage' }
URL /p/100001 ─▶ app.routes.ts: CmsRoute, data { pageType: 'ProductPage' } + :code

CmsRoute(cms-route.ts)
  GET /occ/v2/samplestore/cms/pages?pageType=ContentPage&pageLabelOrId=homepage
        ▼ 返事(画面の設計図。見た目の HTML は入っていない)
  { uid, name, template, title, contentSlots: { contentSlot: [
      { slotId, position, components: { component: [ { uid, typeCode, name, modifiedTime, ...属性 } ] } } ] } }
        ▼
CmsPageView(cms-page.ts)
  枠を JSON の順に <div class="cms-slot" data-slot="Section1"> として並べる
  枠の中の部品ごとに:
     typeCode を CMS_COMPONENT_MAPPING(cms-mapping.ts)で引く
       ├ 見つかった → <div class="cms-component" data-cms-type="SimpleBannerComponent">
       │              <ng-container *ngComponentOutlet="部品; inputs: { data: JSON }">
       └ 無い      → 描かない。警告 cms_unknown_component(サーバーは JSON ログ、ブラウザはコンソール)
```

## 4. 仕様 {#s4}
### 4.1 CMS の API の頼み方 {#s4-1}
| 画面 | 頼み方 | 無いとき |
| --- | --- | --- |
| トップ | `GET /occ/v2/samplestore/cms/pages?pageType=ContentPage&pageLabelOrId=homepage` | 404 `CMSItemNotFoundError` |
| 商品詳細 | `GET /occ/v2/samplestore/cms/pages?pageType=ProductPage&code=100001` | 商品が無ければ 404 `UnknownIdentifierError` |
| 分類ページ | `GET /occ/v2/samplestore/cms/pages?pageType=CategoryPage&code=kitchen`(分類は `stationery`・`kitchen`・`living`・`digital`) | 分類が無ければ 404 `UnknownIdentifierError` |
| (その他) | `pageType` が 3 つのどれでもない | 400 `ValidationError` |

- ProductPage と CategoryPage は、ページの形は 1 つずつで、返すときに中身を埋めます(`ProductRelatedCarousel` に同じ分類の商品を最大 8 件、`CategoryBanner` と `CategoryProductCarousel` に分類の名前と商品)。
- CategoryPage は storefront の `/c/:code`(例 `/c/kitchen`)で描きます。メニュー(`NavigationComponent`)の分類のリンクは今も検索(`/search?q=分類名`)を指しているので、分類ページは URL を直接開くか、商品の `categories[].url`(`/c/<分類>`)から入ります(7 章)。
- 返事は誰が頼んでも同じなので、cdn-waf が 30 秒ためます(api のホスト名の `= /occ/v2/samplestore/cms/pages`)。

### 4.2 ページと枠(スロット) {#s4-2}
| ページ(`uid` / テンプレート) | 枠の順(`position`) |
| --- | --- |
| `homepage` / `LandingPageTemplate` | `SearchBox` → `NavigationBar` → `Section1`(バナー)→ `Section2`(ごあいさつの段落)→ `Section3`(新着商品)→ `Section4`(キッチンのおすすめ)→ `Footer` |
| `productDetails` / `ProductDetailsPageTemplate` | `SearchBox` → `NavigationBar` → `Summary`(商品の本体)→ `CrossSelling`(同じ分類の商品)→ `Footer` |
| `productList` / `ProductListPageTemplate` | `SearchBox` → `NavigationBar` → `Section1`(分類のバナー)→ `ProductList`(分類の商品)→ `Footer` |

storefront は api が返した順のまま並べます。本物の Composable Storefront はテンプレートごとの「どの枠をどの順で置くか」を storefront 側の設定(レイアウト設定)で決めますが、ラボでは簡単にするため JSON の順を使います。

### 4.3 部品の種類と対応表 {#s4-3}
| `typeCode` | 属性 | Angular の部品 | 描き方 |
| --- | --- | --- | --- |
| `SimpleBannerComponent` | `headline`・`content`・`media:{url,altText}`・`urlLink` | [simple-banner.ts](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/apps/web/src/app/cms/components/simple-banner.ts) | 見出し・文・画像・リンク。画像は `API_PUBLIC_URL` + `media.url` |
| `CMSParagraphComponent` | `content` | [paragraph.ts](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/apps/web/src/app/cms/components/paragraph.ts) | `[innerHTML]` に入れる。危ないタグ(`<script>`・`onclick` など)は Angular が取り除く |
| `ProductCarouselComponent` | `title`・`productCodes`(空白区切りの文字列。例 `"100021 100013"`) | [product-carousel.ts](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/apps/web/src/app/cms/components/product-carousel.ts) | 商品ごとに `products/{code}?fields=DEFAULT` を呼んで並べる(8 件なら 8 回) |
| `ProductDetailsComponent` | なし | [product-details.ts](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/apps/web/src/app/cms/components/product-details.ts) | URL の `:code` の商品を `fields=FULL` で表示。無ければ 404 |
| `SearchBoxComponent` | `placeholder` | [search-box.ts](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/apps/web/src/app/cms/components/search-box.ts) | `/search?q=` へ進む検索の欄。入力欄の案内の文は `placeholder`(無ければ「商品名で探す」) |
| `NavigationComponent` | `links:[{name,url,categoryCode?}]` | [navigation.ts](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/apps/web/src/app/cms/components/navigation.ts) | リンクを並べる |

各部品の JSON には `uid`・`typeCode`・`name`・`modifiedTime` も付きます。部品には JSON をそのまま `data` として渡し、部品は `data` から見出しなどを読んで描きます。

### 4.4 知らない部品の扱い {#s4-4}
| 項目 | 内容 |
| --- | --- |
| 動き | 対応表に無い `typeCode` は描かずに飛ばす。枠とほかの部品はそのまま描く |
| 理由 | CMS の担当者が新しい部品を置いた日に、storefront の更新がまだでもサイトを止めないため |
| ログ(サーバー) | `{"service":"storefront","level":"warn","event":"cms_unknown_component","typeCode":"…","uid":"…","pageUid":"homepage","slotId":"…","trace_id":"…"}` |
| ログ(ブラウザ) | 開発者ツールのコンソールに警告 |
| 回数 | 1 ページにつき 1 回(`computed` で、元の JSON が変わらない限り計算し直さない) |
| 部品を増やすとき | Angular の部品を 1 つ作り、`cms-mapping.ts` に 1 行足すだけ。画面(ルート)のコードは触らない |

### 4.5 申し送り(TransferState)と二重取りの防止 {#s4-5}
| 項目 | 内容 |
| --- | --- |
| サーバー | SSR 中に api から受け取った CMS のページと商品の JSON を、名札 `api:<パス>?<問い合わせ>` で TransferState に入れる。HTML の `<script id="ng-state" type="application/json">` でブラウザへ渡る |
| ブラウザ | 最初の表示(ハイドレーション)では申し送りを 1 回だけ使い、api を呼び直さない。画面を行き来したら新しく取り直す |
| 404 | 「無かった」も印として申し送る。ブラウザが同じ 404 を取りに行き直さない |
| 入れない物 | 注文などログインした人だけのデータ |
| 実物 | [api.service.ts](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/apps/web/src/app/core/api.service.ts) |

### 4.6 変更が画面に出るまで {#s4-6}
| 手順 | 何が起きるか | かかる時間 |
| --- | --- | --- |
| 1 | backoffice(`http://backoffice.lab.localhost:18080/backoffice/`、`admin` / `admin`)でトップのバナーの見出し・本文を保存 | すぐ(DB の `cms_components` の `HomepageSplashBanner` が変わる) |
| 2 | cdn-waf にためてある `/`(www)と `cms/pages`(api)が切れる | 最大 30 秒 |
| 3 | 次のリクエストで storefront が新しい JSON を取り、新しい文言で描く | 1 回の SSR |

キャッシュを切った環境(本格版 d1。`EDGE_CACHE=off`)では、保存してすぐ変わります。

## 5. 目標と確認方法 {#s5}
| 項目 | 目標 | 確かめ方 |
| --- | --- | --- |
| SSR に部品が入る | JS なしの HTML に部品の印がある | `curl -s http://www.lab.localhost:18080/ \| grep -o 'data-cms-type="[^"]*"'` |
| CMS の JSON | 枠と部品が返る | `curl -s 'http://api.lab.localhost:18080/occ/v2/samplestore/cms/pages?pageType=ContentPage&pageLabelOrId=homepage'` |
| 知らない部品 | 画面は出て、ログに警告 | `docker compose logs storefront \| grep cms_unknown_component` |
| 二重取りしない | 最初の表示で api への fetch が 0 件 | ブラウザの開発者ツールの Network |
| 変更の反映 | バナーの文言が 30 秒以内に変わる | backoffice で保存 → `curl -sI http://www.lab.localhost:18080/ \| grep -i x-cache` で `HIT` から `EXPIRED`・`MISS` に変わったあと文言を確かめる |

## 6. 関連する文書 {#s6}
- [D-FE-04 商品詳細画面](/design/detail/D-FE-04-product-detail)(ProductPage の中身)
- [D-FE-22 SSR サーバー](/design/detail/D-FE-22-ssr-server)(ログ `cms_unknown_component`)
- [D-NW-01 cdn-waf と ingress の経路とキャッシュ](/design/detail/D-NW-01-edge-route)(cms/pages を 30 秒ためる)
- 仕組みの説明: [CMS 駆動の描画](/how-it-works/05-headless-cms)

## 7. 未決事項 {#s7}
| # | 内容 |
| --- | --- |
| 1 | メニューの分類のリンク(今は `/search?q=分類名`)を、分類ページ `/c/:code` に向けるか。向けるなら cdn-waf で `/c/…` の HTML もためるかを合わせて決める |
| 2 | 枠の順をテンプレートごとに storefront 側で決める(レイアウト設定)か、今のまま api の順に任せるか |
| 3 | 部品を遅延読み込みにするか(今は最初から全部読み込む) |
| 4 | CMS を変えたとき、そのページだけ cdn-waf のキャッシュを消す仕組みを入れるか |

## 8. レビュー観点 {#s8}
- [ ] `typeCode` → 部品の対応表が 1 か所だけにあるか(画面ごとに if 文で分けていないか)
- [ ] 知らない部品で画面が落ちず、ログに「どのページのどの部品か」が残るか
- [ ] CMS の文章を HTML として入れるとき、危ないタグが取り除かれるか
- [ ] SSR で取った JSON を申し送り、ブラウザで二重に取っていないか
- [ ] CMS を変えてから画面に出るまでの時間(キャッシュ)を、編集する人に伝えてあるか
- [ ] 部品が商品ごとに api を呼ぶとき、呼ぶ回数が SSR の打ち切り(3000ms)に収まるか

## この設計を体験する演習 {#exercises}
- [ヘッドレス-1 CMS の JSON が画面になるまで](/exercises/21-headless-cms)
- [FE-1 SSR と CSR を見比べる](/exercises/01-fe-ssr-vs-csr)
- [ネットワーク-1 前段のキャッシュ](/exercises/07-nw-cache)
