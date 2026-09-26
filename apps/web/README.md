# storefront(サンプルストアの画面。apps/web)

Angular 21 の SSR アプリです。Express サーバー(`src/server.ts`)がポート 4000 で動きます。
CCv2 でいうと **JS Storefront(Composable Storefront を SSR で動かすもの)** に当たります。
画面の中身は api の **CMS のページ(JSON)** で決まる「ヘッドレス」の作りです。

- ビルド: `docker build -t samplestore-web apps/web`
- 運用の口: `GET /healthz`(生きているか)、`GET /metrics`(指標)

## 画面(ルート)

| URL | 中身 | CMS 駆動? |
| --- | --- | --- |
| `/` | トップ。`cms/pages?pageType=ContentPage&pageLabelOrId=homepage` の部品を並べる | はい |
| `/p/:code` | 商品詳細(CCv2 の商品ページの URL の形)。`cms/pages?pageType=ProductPage&code=...` の部品を並べる。無い商品は **HTTP 404** | はい |
| `/c/:code` | 分類ページ(例 `/c/kitchen`。分類は `stationery`・`kitchen`・`living`・`digital`)。`cms/pages?pageType=CategoryPage&code=...` の部品(分類のバナーと商品の並び)を並べる。無い分類は **HTTP 404**。メニューの分類のリンクは今は検索(`/search?q=分類名`)を指しているので、`/c/...` は URL を直接開いて見る | はい |
| `/search?q=` | 検索結果。`products/search?query=...` | いいえ |
| `/login` | ログイン(OAuth のトークンをもらう) | いいえ |
| `/my-account/orders` | 注文履歴。**遅延読み込み**(別の JS ファイル = チャンク) | いいえ |
| `/my-account/orders/:code` | 注文の詳細(自分の注文でなければ api が 404) | いいえ |
| それ以外 | 「ページが見つかりません」(HTTP 404) | - |

## 環境変数(スイッチ)

| 名前 | 既定 | 意味 |
| --- | --- | --- |
| `RENDER_MODE` | `ssr` | `csr` にすると、サーバーで描画せず空の HTML を返します |
| `SSR_TIMEOUT_MS` | `3000` | SSR がこれより遅いとあきらめて空の HTML を返します(ログに `ssr_fallback`) |
| `SSR_WINDOW_BUG` | `false` | `true` でサーバーが `window` を触り、SSR が 500 になります |
| `API_INTERNAL_URL` | `http://api:3001` | **サーバー(SSR 中)** が api を呼ぶ住所(コンテナ同士の内側の住所) |
| `API_PUBLIC_URL` | `http://api.lab.localhost:18080` | **ブラウザ** が api を呼ぶ住所。画像(`/medias/...`)の URL にも使います |
| `NG_ALLOWED_HOSTS` | なし | Host ヘッダとして受け付ける名前を足します(カンマ区切り)。既定で `localhost`・`127.0.0.1`・`web`・`storefront`・`www.lab.localhost`・`host.docker.internal` を受け付けます。知らない名前は 400 |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | なし | あるときだけトレースを送ります(例: `http://otel-collector:4318`。`/v1/traces` に OTLP/HTTP で送る) |
| `OTEL_SERVICE_NAME` | `samplestore-storefront` | トレースに付くサービス名 |

## CMS 駆動の描画のしくみ(ヘッドレスの核心)

「トップに何を、どの順で出すか」は storefront のコードに書いてありません。api の CMS が JSON で返します。
storefront は **JSON の部品の種類(`typeCode`)を見て、Angular の部品を当てはめて並べるだけ** です。

1. **URL からページを決める**(`src/app/app.routes.ts`)
   `/` なら `{ pageType: 'ContentPage', pageLabelOrId: 'homepage' }`、`/p/100001` なら `{ pageType: 'ProductPage', code: '100001' }`、`/c/kitchen` なら `{ pageType: 'CategoryPage', code: 'kitchen' }`。
2. **設計図をもらう**(`src/app/cms/cms-route.ts`)
   `GET /occ/v2/samplestore/cms/pages?pageType=...` を呼びます。返事はこんな形です。
   ```json
   { "uid": "homepage", "template": "LandingPageTemplate", "title": "サンプルストア",
     "contentSlots": { "contentSlot": [
       { "slotId": "Section1Slot-Homepage", "position": "Section1",
         "components": { "component": [
           { "uid": "HomepageSplashBanner", "typeCode": "SimpleBannerComponent", "headline": "秋の文房具フェア",
             "media": { "url": "/medias/banner-homepage.svg", "altText": "秋の文房具フェア" } }
         ] } }
     ] } }
   ```
3. **枠(スロット)を順に並べる**(`src/app/cms/cms-page.ts`)
   `contentSlot` を api が返した順に `<div class="cms-slot" data-slot="Section1">` として並べます。
4. **部品の種類を対応表で引く**(`src/app/cms/cms-mapping.ts` ── アプリで 1 か所だけ)
   | typeCode | Angular の部品 |
   | --- | --- |
   | `SimpleBannerComponent` | `cms/components/simple-banner.ts`(見出し・文・画像・リンク) |
   | `CMSParagraphComponent` | `cms/components/paragraph.ts`(`content` を HTML として描く。`<script>` や `onclick` などの危ない物は Angular が取り除く = サニタイズ) |
   | `ProductCarouselComponent` | `cms/components/product-carousel.ts`(`productCodes` の商品を 1 件ずつ api に聞いて並べる) |
   | `ProductDetailsComponent` | `cms/components/product-details.ts`(URL の `:code` の商品を `fields=FULL` で表示。無ければ 404) |
   | `SearchBoxComponent` | `cms/components/search-box.ts`(入力欄の案内の文は CMS の `placeholder`) |
   | `NavigationComponent` | `cms/components/navigation.ts`(`links` を並べる) |
5. **その場で部品を作り、JSON を渡す**
   `<ng-container *ngComponentOutlet="部品; inputs: { data: JSON }">`。部品は `data` から見出しなどを読んで描きます。
   開発者ツールで `<div class="cms-component" data-cms-type="SimpleBannerComponent">` を探すと、どの JSON からできたかが見えます。
6. **知らない typeCode は描かない**
   画面は落とさず、その部品だけ飛ばします。サーバーでは JSON ログ、ブラウザではコンソールに警告が出ます。
   ```json
   {"service":"storefront","level":"warn","event":"cms_unknown_component","typeCode":"MysteryWidgetComponent","uid":"...","pageUid":"homepage","slotId":"...","trace_id":"..."}
   ```
   部品を増やすときは、Angular の部品を作って対応表に 1 行足すだけです。

backoffice でバナーの文言を変えると、storefront を作り直さなくてもトップの文が変わるのは、この仕組みのためです
(cdn-waf のキャッシュが効いている間は、変わるのが遅れます)。

## api の呼び方: サーバー(SSR)とブラウザで住所が違う

```
[SSR 中の storefront(Node.js)] ──GET http://api:3001/occ/v2/...──────────────→ api   (内側の住所 API_INTERNAL_URL)
[利用者のブラウザ]              ──GET http://api.lab.localhost:18080/occ/v2/...──→ cdn-waf → ingress → api
                                  (画面は www.lab.localhost、api は api.lab.localhost = 別オリジン → CORS)
```

- **サーバー(SSR)**: 内側の住所で呼びます。ブラウザを通らないので CORS は関係ありません。
  OpenTelemetry が有効なら `traceparent` ヘッダを付け、api 側のトレースとつなげます。
- **ブラウザ**: 外向きの住所で呼びます。画面(`http://www.lab.localhost:18080`)と api のオリジンが違うので、
  ブラウザは api の返事に `Access-Control-Allow-Origin: http://www.lab.localhost:18080` があるときだけ中身を読ませます(CORS)。
  - 商品・CMS の GET と、ログインの POST(`application/x-www-form-urlencoded`)は「単純なリクエスト」なので、そのまま 1 回で送ります。
  - 注文(`/users/current/...`)は `Authorization: Bearer ...` を付けるので、先に `OPTIONS`(プリフライト)で「送ってよいか」を確かめます。
    api は `Access-Control-Allow-Headers: Authorization` を返す必要があります。
  - `Authorization` は `/users/` の下にだけ付けます(商品に付けると、キャッシュが効かず、商品の URL ごとにプリフライトが飛ぶため)。
- **外向きの住所の渡し方**: `API_PUBLIC_URL` は JS に焼き込みません(同じイメージを d1・s1・p1 で使うため)。
  `server.ts` が返す HTML の `<head>` に `<meta name="api-public-url" content="http://api.lab.localhost:18080">` を書き足し、
  ブラウザはそれを読みます(`src/app/core/tokens.ts`)。SSR・CSR・フォールバックのどの HTML にも入ります。
  `<script>` でなく `<meta>` なのは、CSP(読み込んでよいスクリプトの一覧)に引っかからないためです。
- **画像**: SSR 中でも `<img src>` には外向きの住所を書きます(`http://api.lab.localhost:18080/medias/100001.svg`)。画像を読むのはブラウザだからです。
- **二度取りしない**: SSR で api から受け取った CMS・商品の JSON は、HTML の `<script id="ng-state">` でブラウザに申し送ります(TransferState)。
  ブラウザは最初の表示では api を呼び直しません(開発者ツールの Network で、最初の表示では api への fetch が 0 件)。
- **ログイン**: `POST /authorizationserver/oauth/token`(`grant_type=password&client_id=storefront&username=&password=`)。
  もらった `access_token` はメモリと sessionStorage に持ちます(タブを閉じると消える)。サーバーには置かないので、注文履歴はブラウザで読み込みます。

## 指標(/metrics)

`ssr_render_duration_seconds{route}`(ヒストグラム)、`ssr_fallback_total`、`ssr_errors_total`、
`http_requests_total{route,method,status}`、`http_request_duration_seconds{route,method}`、プロセスの基本の指標。
`route` は `/`・`/search`・`/p/:code`・`/c/:code`・`/login`・`/my-account/orders`・`/my-account/orders/:code`・`/metrics`・`/healthz`・`static`・`other` のどれかです。

## ログ(1 行 1 JSON、標準出力)

- 画面のリクエストごと: `{"service":"storefront","msg":"request","route":"/p/:code","status":200,"durationMs":..,"renderMode":"ssr","fallback":false,"trace_id":"...","reqId":"..."}`
- `event` 付き: `ssr_fallback`(時間切れ)、`ssr_error`(SSR で例外)、`cms_unknown_component`(知らない部品)、`ssr_api_call`(SSR 中の api 呼び出しのうち、失敗したもの・1 秒以上かかったもの)
- `trace_id` は OpenTelemetry が有効なときだけ入ります。`reqId` は cdn-waf が付けたリクエスト番号(`X-Request-Id`)で、cdn-waf・ingress のログの `request_id` と同じ値です(cdn-waf を通ったリクエストだけ)。

## トレース(OpenTelemetry。`OTEL_EXPORTER_OTLP_ENDPOINT` があるときだけ)

```
GET /p/:code                       … storefront が受けたリクエスト(前段が traceparent を付けてきたら、その続き)
  └ ssr.render                     … Angular が HTML を作っていた時間
      ├ GET /occ/v2/samplestore/cms/pages
      └ GET /occ/v2/samplestore/products/{code}   … ここで traceparent を api に渡す → api の区間が下につながる
```

## 描画モードの見分け方

画面のいちばん下の「描画モード」、応答ヘッダ `X-Render-Mode`(`ssr` / `csr` / `fallback`)、`<html data-render-mode="...">` の 3 か所に出ます。

## 確かめるコマンド(軽量版)

```sh
# SSR の HTML に CMS の部品が入っているか(JS なしで見える)
curl -s http://www.lab.localhost:18080/ | grep -o 'data-cms-type="[^"]*"'
# 外向きの api の住所がどう渡っているか
curl -s http://www.lab.localhost:18080/ | grep -o '<meta name="api-public-url"[^>]*>'
# 無い商品は 404
curl -s -o /dev/null -w '%{http_code}\n' http://www.lab.localhost:18080/p/NO-SUCH-CODE
# 知らない部品の警告
docker compose logs storefront | grep cms_unknown_component
```
