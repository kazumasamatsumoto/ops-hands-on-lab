# web(サンプルストアの画面)

Angular 21 の SSR アプリです。Express サーバー(`src/server.ts`)がポート 4000 で動きます。

- ビルド: `docker build -t samplestore-web apps/web`
- 画面: `/`、`/products`(`?q=` で検索)、`/products/:id`、`/login`、`/me/orders`(遅延読み込み)、`/me/orders/:orderId`
- 運用の口: `GET /healthz`、`GET /metrics`

## 環境変数(スイッチ)

| 名前 | 既定 | 意味 |
| --- | --- | --- |
| `RENDER_MODE` | `ssr` | `csr` にすると、サーバーで描画せず空の HTML を返します |
| `SSR_TIMEOUT_MS` | `3000` | SSR がこれより遅いとあきらめて空の HTML を返します(ログに `ssr_fallback`) |
| `SSR_WINDOW_BUG` | `false` | `true` でサーバーが `window` を触り、SSR が 500 になります |
| `API_INTERNAL_URL` | `http://api:3001` | サーバーから見た api の住所 |
| `NG_ALLOWED_HOSTS` | なし | Host ヘッダとして受け付ける名前を足します(カンマ区切り)。既定で `localhost`・`127.0.0.1`・`web`・`host.docker.internal` を受け付けます |

## 指標(/metrics)

`ssr_render_duration_seconds{route}`(ヒストグラム)、`ssr_fallback_total`、`ssr_errors_total`、
`http_requests_total{route,method,status}`、`http_request_duration_seconds{route,method}`、プロセスの基本の指標。

## 描画モードの見分け方

画面のいちばん下の「描画モード」、応答ヘッダ `X-Render-Mode`(`ssr` / `csr` / `fallback`)、`<html data-render-mode="...">` の 3 か所に出ます。
