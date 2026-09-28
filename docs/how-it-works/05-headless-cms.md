---
title: 仕組み-5 ヘッドレスと CMS 駆動の描画
---

# 仕組み-5 ヘッドレスと CMS 駆動の描画

::: tip このページで分かること
- api の `cms/pages` が返す JSON(ページ → スロット → 部品)が、画面の部品になるまでの 1 歩ずつ。
- `typeCode` → Angular の部品 の対応表と、知らない部品が来たときの動き。
- 「ヘッドレス」にすると何がうれしいのか。
- 業務の人が backoffice でバナーを変えてから、お客さんの画面に出るまで(キャッシュで遅れる理由)。
:::

## 1. 一言でいうと {#s1}

画面の **「どこに・何を・どの順で置くか」は api(CMS)が JSON で決め**、storefront は **「その部品をどう見せるか」だけ** を知っています。
storefront は JSON を上から読み、部品の種類(`typeCode`)ごとに決まった Angular の部品を当てはめて並べるだけです。

**たとえ: 新聞の割り付け表と活字**

- 編集部(CMS)は「1 面の上に大見出し、その下に写真、右に広告」という **割り付け表**(JSON)を作る。
- 印刷所(storefront)は「大見出しはこの活字、写真はこの枠」という **型** を持っていて、割り付け表の通りに組むだけ。
- 記事の差し替えは編集部だけでできる。印刷所の型を作り直す(storefront を作り直す)必要はない。
- 割り付け表に、印刷所が知らない型(新しい部品)が書かれていたら、そこだけ空けて刷る(画面全体は止めない)。

**ヘッドレス** は「頭(画面)が切り離されている」という意味です。お店の中身(商品・CMS・注文)は api が持ち、画面は別のアプリ(storefront)が作ります。画面の作り替えと、中身の運用を別々に進められるのがうれしい点です。

## 2. 1 リクエストの流れ {#s2}

トップページ `/` を SSR するときの流れです。

```text
 ① ルートの表       URL "/" → CmsRoute, data: { pageType: 'ContentPage', pageLabelOrId: 'homepage' }
 ② 設計図をもらう   GET /occ/v2/samplestore/cms/pages?pageType=ContentPage&pageLabelOrId=homepage
 ③ api が DB から組み立てる
      cms_pages(ページ)→ cms_slots(枠)→ cms_slot_components(並び)→ cms_components(部品と属性)
 ④ 返ってくる JSON(抜粋)
      { "uid": "homepage", "template": "LandingPageTemplate", "title": "サンプルストア",
        "contentSlots": { "contentSlot": [
          { "slotId": "SearchBoxSlot",         "position": "SearchBox",     "components": { "component": [ { "typeCode": "SearchBoxComponent", ... } ] } },
          { "slotId": "NavigationBarSlot",     "position": "NavigationBar", "components": { "component": [ { "typeCode": "NavigationComponent", ... } ] } },
          { "slotId": "Section1Slot-Homepage", "position": "Section1",      "components": { "component": [
              { "uid": "HomepageSplashBanner", "typeCode": "SimpleBannerComponent",
                "headline": "秋の文房具フェア", "content": "ノートとペンを…",
                "media": { "url": "/medias/banner-homepage.svg", ... }, "urlLink": "/search?q=..." } ] } },
          { "slotId": "Section2Slot-Homepage", ... CMSParagraphComponent ... },
          { "slotId": "Section3Slot-Homepage", ... ProductCarouselComponent "productCodes": "100021 100013 ..." },
          { "slotId": "Section4Slot-Homepage", ... ProductCarouselComponent ... },
          { "slotId": "FooterSlot", ... CMSParagraphComponent ... } ] } }
 ⑤ 枠を上から順に並べる   <div class="cms-slot" data-slot="Section1">
 ⑥ 部品ごとに対応表を引く  SimpleBannerComponent → SimpleBanner(Angular の部品)
 ⑦ その場で部品を作り、JSON をそのまま data として渡す
      <div class="cms-component" data-cms-type="SimpleBannerComponent" data-cms-uid="HomepageSplashBanner">
        <app-simple-banner> … 見出し・文・画像・リンク
 ⑧ 部品の中で、さらに api を呼ぶ物もある
      ProductCarouselComponent → productCodes の 1 件ずつ GET /products/{code}?fields=DEFAULT
```

1. **ルートの表**が「この URL はどの CMS のページか」を決めます。`/p/:code` なら `pageType: 'ProductPage'` と商品コード、`/c/:code`(例 `/c/kitchen`)なら `pageType: 'CategoryPage'` と分類コードです。
2. **設計図を取ります。** SSR 中なら内側の近道、ブラウザなら表の入口で呼びます。
3. **api は 4 つの表を順につないで** JSON を作ります(ページ・枠・並び・部品)。商品ページでは「同じ分類の商品」を、分類ページでは分類名やバナーを、返す直前に埋めます。
4. **JSON はページ → 枠(スロット)→ 部品** の入れ子です。部品には `uid`(部品の ID)・`typeCode`(部品の種類)・`name`・`modifiedTime` と、種類ごとの属性が入っています。
5. **枠を JSON の順に並べます。** 本物の Composable Storefront は、ページのテンプレートごとに「どの枠をどの順で置くか」を storefront 側の設定で決めますが、ラボは分かりやすさのため JSON の順のままです。
6. **対応表**で、`typeCode` から Angular の部品を引きます。
7. **その場で部品を作り**、JSON を丸ごと渡します。部品は `data().headline` などを読んで描きます。
8. **一部の部品は追加で api を呼びます。** カルーセルは CMS が「商品コードの一覧」しか持たないので、商品名・値段・画像を 1 件ずつ聞きに行きます(8 件なら 8 回。SSR が遅くなりやすい所)。

### 2.1 業務の人が backoffice でバナーを変えたとき {#s2-1}

```text
 ① 業務の人    http://backoffice.lab.localhost:18080/backoffice/ でバナーの見出しを「冬のセール」にして保存
 ② backoffice  UPDATE cms_components SET attrs = …, updated_at = now() WHERE uid = 'HomepageSplashBanner'
                (api と同じ DB。storefront は作り直さない)
 ③ お客さん    トップを開く
      cdn-waf にためた HTML がある(30 秒以内)     → 古い見出しのまま(X-Cache-Status: HIT)
      cdn-waf の api の cms/pages もためている(30 秒) → ブラウザで画面を移動しても古いまま
 ④ 30 秒たつ   cdn-waf のキャッシュが切れる → storefront が SSR → api が DB から新しい JSON → 「冬のセール」
```

- 画面に出るまでの遅れは、**最大でおよそキャッシュの時間(30 秒)** です。HTML と `cms/pages` はそれぞれ 30 秒ためているので、タイミングによっては少し長くなることもあります。
- 開発環境 d1 はキャッシュなし(`cdnCache: false`)なので、変えた物がすぐ見えます([仕組み-12](./12-manifest-and-environments))。
- 検索結果の価格・在庫は、本格版(Solr)では worker が索引を作り直すまで(最大 `CRON_INTERVAL_SECONDS` = 60 秒)古いままです([仕組み-9](./09-search-solr))。

## 3. 設定の読み方 {#s3}

### 3.1 対応表(アプリでただ 1 か所) {#s3-1}

ファイル: [apps/web/src/app/cms/cms-mapping.ts](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/apps/web/src/app/cms/cms-mapping.ts)

```ts
export const CMS_COMPONENT_MAPPING: Readonly<Record<string, Type<unknown>>> = {
  SimpleBannerComponent: SimpleBanner,
  CMSParagraphComponent: Paragraph,
  ProductCarouselComponent: ProductCarousel,
  ProductDetailsComponent: ProductDetails,
  SearchBoxComponent: SearchBox,
  NavigationComponent: Navigation,
};
```

| `typeCode`(JSON) | Angular の部品 | 使う属性 | 置いてある所(ページ・枠) |
| --- | --- | --- | --- |
| `SimpleBannerComponent` | `cms/components/simple-banner.ts` | `headline`・`content`・`media.url`・`urlLink` | トップ `Section1`(backoffice で変えられる)・分類ページ `Section1` |
| `CMSParagraphComponent` | `cms/components/paragraph.ts` | `content` | トップ `Section2`・すべての `Footer` |
| `ProductCarouselComponent` | `cms/components/product-carousel.ts` | `title`・`productCodes`(空白区切りの文字列) | トップ `Section3`・`Section4`、商品ページ `CrossSelling`、分類ページ `ProductList` |
| `ProductDetailsComponent` | `cms/components/product-details.ts` | なし(URL の商品コードで `fields=FULL` を取る) | 商品ページ `Summary` |
| `SearchBoxComponent` | `cms/components/search-box.ts` | `placeholder` | すべての `SearchBox` |
| `NavigationComponent` | `cms/components/navigation.ts` | `links` | すべての `NavigationBar` |

部品を増やすときは、Angular の部品を 1 つ作り、この表に 1 行足すだけです。画面(ルート)のコードは触りません。

### 3.2 JSON を部品にする所 {#s3-2}

ファイル: [apps/web/src/app/cms/cms-page.ts](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/apps/web/src/app/cms/cms-page.ts)

```ts
    @for (slot of slots(); track slot.slotId) {
      <div class="cms-slot" [attr.data-slot]="slot.position" [attr.data-slot-id]="slot.slotId">
        @for (c of slot.components; track c.uid) {
          <div class="cms-component" [attr.data-cms-type]="c.typeCode" [attr.data-cms-uid]="c.uid">
            <ng-container *ngComponentOutlet="c.type; inputs: { data: c.data }" />
          </div>
        }
      </div>
    }
```

- 外側の `@for` … 枠(スロット)を JSON の順に並べます。`data-slot` に枠の位置(`Section1` など)が入ります。
- 内側の `@for` … 枠の中の部品を並べます。`data-cms-type` と `data-cms-uid` は、開発者ツールで「どの JSON から作られたか」を見るための印です。
- `*ngComponentOutlet` … 「その場で、この種類の部品を作る」という Angular の仕組みです。`inputs: { data: c.data }` で JSON を丸ごと渡します。

```ts
        const type = CMS_COMPONENT_MAPPING[data.typeCode];
        if (!type) {
          this.warn('cms_unknown_component', {
            typeCode: data.typeCode,
            uid: data.uid,
            pageUid: page.uid,
            slotId: slot.slotId,
          });
          return [];
        }
```

- 対応表に無い `typeCode` は描かずに飛ばし、警告を出します(サーバーでは 1 行 JSON のログ、ブラウザではコンソール)。画面全体は落としません。CMS の担当者が新しい部品を置いた日に、storefront の更新がまだでもサイトが止まらないようにするためです。

### 3.3 api 側: 設計図を返す所 {#s3-3}

ファイル: [apps/api/src/occ/cms.js](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/apps/api/src/occ/cms.js)

```js
    `SELECT s.slot_id, s.position, c.uid, c.type_code, c.name, c.attrs, c.updated_at
       FROM cms_slots s
       LEFT JOIN cms_slot_components sc ON sc.page_uid = s.page_uid AND sc.slot_id = s.slot_id
       LEFT JOIN cms_components c ON c.uid = sc.component_uid
      WHERE s.page_uid = $1
      ORDER BY s.sort, sc.sort`,
```

- 枠(`cms_slots`)に、並び(`cms_slot_components`)と部品(`cms_components`)をつないで、枠の順・部品の順に並べます。
- 部品の属性は `attrs`(JSONB = JSON をそのまま入れられる列)にあり、そのまま JSON に展開されます。backoffice はこの `attrs` を書き換えます。

## 4. 確かめるコマンド {#s4}

::: code-group

```bash [Mac / Linux / WSL]
# 設計図(JSON)をそのまま見る。枠の位置と部品の種類だけを抜き出す
curl -s 'http://api.lab.localhost:18080/occ/v2/samplestore/cms/pages?pageType=ContentPage&pageLabelOrId=homepage' \
  | python3 -c 'import sys,json; p=json.load(sys.stdin); [print(s["position"], [c["typeCode"] for c in s["components"]["component"]]) for s in p["contentSlots"]["contentSlot"]]'
```

```powershell [PowerShell]
# 設計図(JSON)をそのまま見る。枠の位置と部品の種類だけを抜き出す(python3 の代わりに ConvertFrom-Json)
$p = curl.exe -s 'http://api.lab.localhost:18080/occ/v2/samplestore/cms/pages?pageType=ContentPage&pageLabelOrId=homepage' | ConvertFrom-Json
foreach ($s in $p.contentSlots.contentSlot) { "$($s.position) [$($s.components.component.typeCode -join ', ')]" }
```

:::

期待する出力(PowerShell では `['…']` の引用符が無く `[SearchBoxComponent]` のように出ます):

```text
SearchBox ['SearchBoxComponent']
NavigationBar ['NavigationComponent']
Section1 ['SimpleBannerComponent']
Section2 ['CMSParagraphComponent']
Section3 ['ProductCarouselComponent']
Section4 ['ProductCarouselComponent']
Footer ['CMSParagraphComponent']
```

::: code-group

```bash [Mac / Linux / WSL]
# 同じ並びが、SSR の HTML の印(data-slot と data-cms-type)になっている
curl -s http://www.lab.localhost:18080/ | grep -oE 'data-slot="[^"]*"|data-cms-type="[^"]*"'

# 無いページは 404
curl -s -o /dev/null -w '%{http_code}\n' 'http://api.lab.localhost:18080/occ/v2/samplestore/cms/pages?pageType=ContentPage&pageLabelOrId=nothing'
# → 404

# 知らない部品の警告(新しい typeCode を DB に足したときに出る)
docker compose logs storefront | grep cms_unknown_component
```

```powershell [PowerShell]
# 同じ並びが、SSR の HTML の印(data-slot と data-cms-type)になっている
curl.exe -s http://www.lab.localhost:18080/ | Select-String -Pattern 'data-slot="[^"]*"|data-cms-type="[^"]*"' -AllMatches | ForEach-Object { $_.Matches.Value }

# 無いページは 404
curl.exe -s -o NUL -w '%{http_code}\n' 'http://api.lab.localhost:18080/occ/v2/samplestore/cms/pages?pageType=ContentPage&pageLabelOrId=nothing'
# → 404

# 知らない部品の警告(新しい typeCode を DB に足したときに出る)
docker compose logs storefront | Select-String 'cms_unknown_component'
```

:::

**backoffice の変更が画面に出るまで** を測ります。

1. ブラウザで http://backoffice.lab.localhost:18080/backoffice/ を開き、`admin` / `admin` でログインします。
2. 「トップページのバナー」の見出しを変えて保存します。
3. すぐに次を打ちます。30 秒ほどは古い見出し、そのあと新しい見出しになります。

::: code-group

```bash [Mac / Linux / WSL]
while true; do
  printf '%s ' "$(date +%T)"
  curl -s -D - http://www.lab.localhost:18080/ -o /tmp/top.html | grep -i x-cache-status | tr -d '\r\n'
  printf ' '; grep -o '<h1[^>]*>[^<]*</h1>' /tmp/top.html | head -1
  sleep 5
done   # Ctrl+C で止める
```

```powershell [PowerShell]
while ($true) {
  $t = Get-Date -Format HH:mm:ss
  $cache = (curl.exe -s -D - http://www.lab.localhost:18080/ -o "$env:TEMP/top.html" | Select-String 'x-cache-status').Line -replace '[\r\n]', ''
  $h1 = (Select-String -Path "$env:TEMP/top.html" -Pattern '<h1[^>]*>[^<]*</h1>' | Select-Object -First 1).Matches.Value
  "$t $cache $h1"
  Start-Sleep 5
}   # Ctrl+C で止める
```

:::

キャッシュを切った状態(`EDGE_CACHE=off docker compose up -d cdn-waf`。PowerShell では `$env:EDGE_CACHE = 'off'; docker compose up -d cdn-waf`、戻すときは `Remove-Item Env:EDGE_CACHE; docker compose up -d cdn-waf`)で同じことをすると、すぐに変わります。これが d1 環境でキャッシュを切っている理由です。

## 5. CCv2 / Composable Storefront ではどこに当たるか {#s5}

| ラボ | CCv2 / Composable Storefront で当たるもの |
| --- | --- |
| `GET /occ/v2/samplestore/cms/pages` | OCC の CMS のページ API(ページ・スロット・コンポーネントを返す) |
| `cms_pages`・`cms_slots`・`cms_components` の表 | CMS のデータ(ページ・コンテンツスロット・CMS コンポーネント。カタログのバージョンで管理される) |
| `typeCode` | CMS コンポーネントの型(`SimpleBannerComponent` など) |
| `CMS_COMPONENT_MAPPING` | Composable Storefront の設定の `cmsComponents`(typeCode ごとに Angular の部品を登録する) |
| 枠を JSON の順に並べる | Composable Storefront のレイアウト設定(テンプレートごとのスロットの並び) |
| backoffice でバナーを変える | Backoffice や SmartEdit で CMS コンポーネントを編集する(ステージの版を直して、同期(公開)すると反映) |
| cdn-waf の 30 秒で画面に出るのが遅れる | CDN や Composable Storefront の SSR のキャッシュが効いている間は、公開しても古い画面が出る |

CCv2 では、編集した CMS のデータはふつう「作業用(Staged)」から「公開用(Online)」へ同期して初めてお客さんに見えます。ラボはこの段階を省き、保存するとすぐ公開用のデータが変わる形にしています。

## 6. よくある誤解 {#s6}

- **「CMS の JSON に HTML が入っている」** → 入っているのは「部品の種類と属性」だけです。見た目(HTML・CSS)は storefront が持っています。
- **「画面の並びを変えるには storefront のデプロイが必要」** → 並びと中身は CMS のデータです。storefront を作り直す必要があるのは、新しい **種類** の部品を足すときだけです。
- **「知らない部品が来たら画面がエラーになる」** → ラボ(と Composable Storefront の考え方)では、その部品だけ描かずに進みます。ログに警告が出るので見落とさないようにします。
- **「保存したらすぐ画面に出るはず。出ないのはバグ」** → キャッシュの時間(ラボは 30 秒)は、速さと引き換えの「わざとの遅れ」です。どれだけ遅れてよいかを業務の人と決めておきます。
- **「ヘッドレスなら api は 1 回しか呼ばれない」** → カルーセルのように、部品ごとに追加で呼ぶ物があります。SSR の遅さの原因になりやすいので、性能の演習で見ます。

## 7. 関係する演習と設計書 {#s7}

- 演習: [FE-1 SSR と CSR を見比べる](/exercises/01-fe-ssr-vs-csr)・[ネットワーク-1 前段のキャッシュ](/exercises/07-nw-cache)・[ヘッドレス-1 CMS の JSON が画面になるまで](/exercises/21-headless-cms)
- 設計書: [FE 方式 4.6 CMS 駆動の描画(ヘッドレス)](/design/architecture/01-frontend#s4-6)・[BE 方式 4.1 API の形(OCC 風)](/design/architecture/02-backend#s4-1)・[ネットワーク方式 4.2 キャッシュ](/design/architecture/04-network#s4-2)・[D-FE-04 商品詳細画面](/design/detail/D-FE-04-product-detail)・[D-FE-05 ヘッドレス CMS](/design/detail/D-FE-05-headless-cms)
- 前後のページ: [仕組み-4 storefront の SSR](./04-storefront-ssr) ・ [仕組み-6 api(OCC)](./06-api-occ)
