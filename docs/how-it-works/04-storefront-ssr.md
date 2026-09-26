---
title: 仕組み-4 storefront の SSR(サーバーで画面を作る)
---

# 仕組み-4 storefront の SSR(サーバーで画面を作る)

::: tip このページで分かること
- SSR・CSR・ハイドレーション・フォールバックが、それぞれ **何を・どこで・いつ** しているか。
- `server.ts` の中で、1 つの画面のリクエストがどう処理されるか(時間切れ・エラー・指標・ログ)。
- 環境変数 `RENDER_MODE`・`SSR_TIMEOUT_MS`・`SSR_WINDOW_BUG` の意味と、効き方の確かめ方。
:::

## 1. 一言でいうと {#s1}

storefront は、**画面(HTML)をサーバーで組み立ててから渡す係** です。組み立てに時間がかかりすぎたら(既定 3000 ミリ秒)、あきらめて「組み立てキット(空の HTML と JS)」を渡し、ブラウザに組み立ててもらいます。

**たとえ: 家具の配達**

| 言葉 | 一言 | 家具でいうと |
| --- | --- | --- |
| SSR(サーバーサイドレンダリング) | サーバーで HTML を作ってから返す | 組み立て済みの家具を届ける。届いた瞬間に使える(見える) |
| CSR(クライアントサイドレンダリング) | 空の HTML と JS を返し、ブラウザが画面を作る | 組み立てキットを届け、お客さんが組み立てる。届いてもしばらく使えない |
| ハイドレーション | SSR で届いた画面に、ブラウザが「動き」を付ける | 組み立て済みの家具に、最後に引き出しのレールを付ける。作り直しはしない |
| フォールバック | SSR が時間内に終わらず、CSR に切り替えること | 組み立てが間に合わないので、キットのまま届ける(真っ白よりはまし) |
| TransferState | SSR で api から取ったデータを HTML に入れて申し送る | 「部品はもう全部そろっています」というメモを同梱する |

SSR の良いところは、**最初の表示が速い** ことと、**検索エンジンや SNS が中身を読める** ことです。
その代わり、**サーバーが api を待つ時間がそのまま画面の遅さになる** ので、時間切れの逃げ道(フォールバック)が要ります。

## 2. 1 リクエストの流れ {#s2}

```text
 ingress ──▶ storefront:4000   GET /p/100001
   ① 共通の受付      route を決める(/p/100001 → "/p/:code")・トレースの区間を始める・時間を計り始める
   ② /healthz・/metrics・JS や CSS のファイル → ここで返す(ファイルは 1 年キャッシュしてよい)
   ③ RENDER_MODE=csr なら → 空の HTML を返す(X-Render-Mode: csr)
   ④ SSR を始める    Angular に画面を作らせる(angularApp.handle)
        │             画面の中で api を呼ぶ(内側の近道 http://api:3001)
        │               cms/pages → 部品ごとに products/{code}
        │
        ├ 3000 ms 以内に終わった → HTML に印を足して返す(X-Render-Mode: ssr)
        ├ 3000 ms を超えた       → あきらめて空の HTML(X-Render-Mode: fallback、Cache-Control: no-store)
        │                          ログ event=ssr_fallback、指標 ssr_fallback_total を +1
        └ 途中で例外             → 500 の HTML(ログ event=ssr_error、指標 ssr_errors_total を +1)
   ⑤ 終わり          1 行の JSON ログ・http_requests_total などを数える
```

1. **共通の受付**: URL を「画面の種類」にまとめます(`/p/100001` と `/p/100002` を同じ `/p/:code` として数える)。URL をそのまま指標のラベルにすると種類が増えすぎて Prometheus が重くなるためです。
2. **ファイル**: `main-xxxx.js` のようにファイル名に中身の指紋が入っているので、1 年ためても古い物が使われることはありません。
3. **CSR モード**: 比べる演習のために、サーバーでは何も描かずに返すこともできます。
4. **SSR 本体**: Angular の「描画」と「3000 ミリ秒のタイマー」を競争させ(`Promise.race`)、先に終わった方を採ります。
   - 間に合った: 返す HTML の `<html>` に `data-render-mode="ssr"` を、`<head>` に `<meta name="api-public-url">` を足します。
   - 間に合わなかった: 空の HTML を返します。`Cache-Control: no-store` を付けるのは、cdn-waf に「時間切れの空の画面」をためさせないためです。
   - 例外: たとえばサーバーに無い `window` を触ると「window is not defined」で落ちます(`SSR_WINDOW_BUG=true` で体験できます)。
5. **ブラウザ側**: SSR の HTML なら、JS が読み込まれたあとハイドレーションをします。TransferState の申し送りがあるので、最初の表示では api を呼びません。空の HTML なら、JS が api を呼んで一から画面を作ります。

```text
 ブラウザで見える速さの違い(目安)
   SSR        : HTML が届く ─ すぐ中身が見える ─ JS が届く ─ ハイドレーション(ボタンが効く)
   CSR/逃げ道 : HTML が届く ─ 真っ白 ─ JS が届く ─ api を呼ぶ ─ やっと中身が見える
```

## 3. 設定の読み方 {#s3}

ファイル: [apps/web/src/server.ts](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/apps/web/src/server.ts)。値は [docker-compose.yml](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/docker-compose.yml) の `storefront:` にあります。

### 3.1 スイッチ(環境変数) {#s3-1}

```yaml
      RENDER_MODE: ${RENDER_MODE:-ssr} # ssr または csr
      SSR_TIMEOUT_MS: ${SSR_TIMEOUT_MS:-3000}
      SSR_WINDOW_BUG: ${SSR_WINDOW_BUG:-false}
      NG_ALLOWED_HOSTS: www.lab.localhost,storefront,localhost,127.0.0.1
```

- `RENDER_MODE` … `ssr`(既定)か `csr`。
- `SSR_TIMEOUT_MS` … SSR をあきらめるまでの時間(ミリ秒)。既定 3000。
- `SSR_WINDOW_BUG` … `true` でサーバーが `window` を触り、SSR が 500 になります(FE の規約の体験用)。
- `NG_ALLOWED_HOSTS` … Angular の SSR は、知らない `Host` ヘッダを 400 で断ります(なりすましの対策)。ingress から来る `www.lab.localhost` と、中から直接呼ぶときの名前を許します。

### 3.2 時間切れの仕組み {#s3-2}

```ts
    const render = angularApp.handle(req, requestContext).then(async (response) => {
      if (!response) return null;
      return { status: response.status, headers: response.headers, html: await response.text() };
    });
    const timeout = new Promise<typeof TIMEOUT>((resolve) => {
      timer = setTimeout(() => resolve(TIMEOUT), SSR_TIMEOUT_MS);
    });
    const result = await Promise.race([render, timeout]);
```

- `angularApp.handle` … Angular に画面を作らせる本体です。中で api の返事を待つので、api が遅いとここも遅くなります。
- `setTimeout(..., SSR_TIMEOUT_MS)` … 3000 ミリ秒後に「時間切れ」の印を返すタイマー。
- `Promise.race` … 2 つのうち、先に終わった方の結果を使います。

```ts
    if (result === TIMEOUT) {
      endTimer();
      ssrFallbackTotal.inc();
      ...
      log({ level: 'warn', event: 'ssr_fallback', url: req.originalUrl, route, timeoutMs: SSR_TIMEOUT_MS, trace_id: res.locals['traceId'] });
      render.catch(() => undefined);
      sendCsrShell(res, 'fallback');
      return;
    }
```

- 時間切れなら、指標を +1 し、`ssr_fallback` のログを出し、空の HTML を返します。
- `render.catch(() => undefined)` … 裏で続いている描画があとで失敗しても、もう返事は済んでいるので無視します。

```ts
function sendCsrShell(res: Response, mode: 'csr' | 'fallback'): void {
  ...
  res.set('X-Render-Mode', mode);
  res.set('Cache-Control', 'no-store'); // 時間切れの空の HTML を cdn-waf にキャッシュさせない
```

### 3.3 指標 {#s3-3}

```ts
const ssrRenderDuration = new client.Histogram({
  name: 'ssr_render_duration_seconds',
  labelNames: ['route'],
  buckets: [0.05, 0.1, 0.25, 0.5, 1, 2, 3, 5, 10],
});
const ssrFallbackTotal = new client.Counter({ name: 'ssr_fallback_total', ... });
const ssrErrorsTotal = new client.Counter({ name: 'ssr_errors_total', ... });
```

- `ssr_render_duration_seconds` … SSR にかかった時間のヒストグラム(「0.05 秒以下が何回、0.1 秒以下が何回…」と数える箱の並び)。フォールバックやエラーの回も 1 回として数えます。
- `ssr_fallback_total` … あきらめた回数。
- `ssr_errors_total` … SSR の途中で失敗して 500 を返した回数。
- Prometheus のルールが「フォールバック率 = `ssr_fallback_total` の増え方 ÷ `ssr_render_duration_seconds_count` の増え方」を計算し、5% を超えたら `SSRFallbackRatioHigh` を鳴らします([仕組み-11](./11-observability))。

### 3.4 どこから描いたかの印と、ブラウザへの申し送り {#s3-4}

```ts
function decorateHtml(html: string, mode: 'ssr' | 'csr' | 'fallback'): string {
  const meta = `<meta name="api-public-url" content="${escapeAttr(API_PUBLIC_URL)}">`;
  return html.replace(/<html\b/i, `<html data-render-mode="${mode}"`).replace(/<head>/i, `<head>\n  ${meta}`);
}
```

- `data-render-mode` … 画面のいちばん下の「描画モード」の表示はこれを読みます。応答ヘッダ `X-Render-Mode` と合わせて 3 か所で見分けられます。
- `<meta name="api-public-url">` … ブラウザが api を呼ぶ住所です。JS に焼き込まないので、同じイメージを d1・s1・p1 で使えます。`<script>` でなく `<meta>` なのは CSP に引っかからないためです。

ハイドレーションの設定は [apps/web/src/app/app.config.ts](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/apps/web/src/app/app.config.ts) にあります。

```ts
    provideClientHydration(withEventReplay(), withNoHttpTransferCache()),
```

- `provideClientHydration` … ハイドレーションを有効にします。
- `withEventReplay` … JS の準備ができる前に押されたクリックを覚えておき、準備ができたらやり直します。
- `withNoHttpTransferCache` … Angular の自動の申し送りは切り、`ApiService` が自前の TransferState で申し送ります(サーバーとブラウザで api の住所が違うため、自動の物では一致しないからです)。

どの画面もリクエストのたびに SSR します([apps/web/src/app/app.routes.server.ts](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/apps/web/src/app/app.routes.server.ts) の `renderMode: RenderMode.Server`)。商品や在庫は変わるので、ビルドのときに作り置き(事前描画)はしません。

## 4. 確かめるコマンド {#s4}

```bash
# 誰が描いたか
curl -sI http://www.lab.localhost:18080/ | grep -i x-render-mode
# → X-Render-Mode: ssr

# SSR の HTML には中身がある / CSR の HTML には <app-root> しかない
curl -s http://www.lab.localhost:18080/ | grep -c 'data-cms-type'      # → 1 以上
RENDER_MODE=csr docker compose up -d storefront
docker compose ps storefront                                           # (healthy) を待つ(10 秒ほど)
curl -s "http://www.lab.localhost:18080/?t=csr" | grep -c 'data-cms-type'   # → 0(?t= でキャッシュを避ける)
docker compose up -d storefront                                        # 元に戻す
docker compose ps storefront                                           # (healthy) を待つ

# フォールバック: api を 3.5 秒遅くすると、SSR が 3 秒であきらめる
tools/chaos.sh set latencyMs=3500
curl -s -o /dev/null -w '%{http_code} %{time_total}s\n' http://www.lab.localhost:18080/p/100002
curl -sI http://www.lab.localhost:18080/p/100003 | grep -iE 'x-render-mode|cache-control'
# → 200 3.0 秒ほど / X-Render-Mode: fallback / Cache-Control: no-store
docker compose logs storefront | grep ssr_fallback | tail -1
tools/chaos.sh reset

# SSR で壊れる書き方: サーバーで window を触る → 500(ブラウザでは動くのに)
SSR_WINDOW_BUG=true docker compose up -d storefront
docker compose ps storefront                                           # (healthy) を待つ。待たずに打つと 502(まだ起動中)
curl -s -o /dev/null -w '%{http_code}\n' http://www.lab.localhost:18080/p/100004     # → 500
docker compose logs storefront | grep ssr_error | tail -1
docker compose up -d storefront
docker compose ps storefront                                           # (healthy) を待つ

# 指標(storefront の /metrics は外から閉じているので、中から見る)
docker compose exec storefront node -e "fetch('http://127.0.0.1:4000/metrics').then(r=>r.text()).then(t=>console.log(t.split('\n').filter(l=>/^ssr_/.test(l)).join('\n')))"
```

::: warning キャッシュに注意
cdn-waf は `/`・`/p/…`・`/search` の HTML を 30 秒ためます。試すたびに別の商品コード(`100002`・`100003`…)を使うか、`EDGE_CACHE=off docker compose up -d cdn-waf` でキャッシュを切ってから試してください。
:::

ブラウザでは、JavaScript を無効にして比べると分かりやすいです(Chrome なら開発者ツールを開いて command+shift+P(Windows は Ctrl+Shift+P)→「Disable JavaScript」(日本語の表示では「JavaScript を無効にする」)と打って選び、再読み込みします)。SSR なら JS なしでも商品名が見え、CSR なら真っ白です。

::: details 本格版(Kubernetes)では
環境変数は manifest.json の `storefront.ssr.renderMode`・`storefront.ssr.timeoutMs` から Deployment に入ります。一時的に変えるなら次のようにします(戻すときは `k8s/up.sh` をやり直す)。
```bash
kubectl -n lab set env deploy/storefront RENDER_MODE=csr
kubectl -n lab rollout status deploy/storefront

# 指標を Pod の中から見る(deploy/storefront は 2 つの Pod の片方だけ)
kubectl -n lab exec deploy/storefront -- node -e "fetch('http://127.0.0.1:4000/metrics').then(r=>r.text()).then(t=>console.log(t.split('\n').filter(l=>/^ssr_/.test(l)).join('\n')))"

# 戻す(どちらでも可)
kubectl -n lab set env deploy/storefront RENDER_MODE=ssr
LAB_SKIP_BUILD=1 k8s/up.sh        # manifest.json の値(ssr)に戻る。d1・s1 なら LAB_ENV も付ける
```
全部の Pod をまとめた数は、Prometheus(http://localhost:19090)で `sum(ssr_fallback_total)` や `sum by (route) (rate(ssr_render_duration_seconds_count[1m]))` のように見ます。Grafana の「サンプルストア SLO」の「storefront(SSR)」の段にも出ます。
:::

## 5. CCv2 / Composable Storefront ではどこに当たるか {#s5}

| ラボ | Composable Storefront / CCv2 で当たるもの |
| --- | --- |
| storefront(Angular SSR) | JS Storefront。Composable Storefront を SSR で動かす Node.js のサーバー |
| `server.ts` | Composable Storefront の SSR サーバーの入口(同じく Express で動く) |
| `SSR_TIMEOUT_MS` と `Promise.race` | Composable Storefront の SSR エンジンの設定にある「時間切れで CSR に切り替える」仕組み(タイムアウトの値を案件で決める) |
| `RENDER_MODE=csr` | SSR を使わない構成(JS Storefront の設定で SSR を無効にする) |
| `NG_ALLOWED_HOSTS` | SSR サーバーが受け付けるホスト名の設定 |
| `ssr_fallback_total` などの指標 | CCv2 では Dynatrace などで SSR の応答時間・エラーを見る([仕組み-11](./11-observability)) |
| `renderMode: RenderMode.Server` | すべての画面をリクエストのたびに SSR する設定 |

## 6. よくある誤解 {#s6}

- **「SSR にすれば、ブラウザの JS は要らない」** → 画面を動かす(ボタン・検索・ログイン)のは、ハイドレーションのあとのブラウザの JS です。SSR は「最初の 1 枚」を速く見せる仕組みです。
- **「フォールバックは失敗だから 500 を返すべき」** → 利用者には少し遅く見えるだけで、画面は出ます。だから 200 で返し、指標とアラートで「起きている割合」を見張ります。
- **「タイムアウトは長いほど安全」** → 長くすると、api が遅いときに利用者が真っ白な画面を長く待ち、storefront のメモリと接続もふさがります。
- **「ブラウザで動くコードは、SSR でも動く」** → サーバーには `window`・`document`・`localStorage` がありません。触るとサーバーでだけ落ちます。
- **「SSR の HTML にログインした人の情報を入れてもよい」** → cdn-waf がためて別の人に見せる事故になります。ラボでは、ログインした人だけの画面はブラウザで描きます([仕組み-7](./07-oauth-token))。

## 7. 関係する演習と設計書 {#s7}

- 演習: [FE-1 SSR と CSR を見比べる](/exercises/01-fe-ssr-vs-csr)・[FE-2 SSR で壊れる書き方](/exercises/02-fe-ssr-rules)・[FE-3 遅延読み込みと JS の予算](/exercises/03-fe-lazy-loading)・[障害-1 API が遅い → SSR が逃げる](/exercises/14-incident-slow-api)
- 設計書: [FE 方式 4.1 描画方式](/design/architecture/01-frontend#s4-1)・[4.2 SSR で壊れない書き方](/design/architecture/01-frontend#s4-2)・[4.3 SSR のタイムアウトと逃げ道](/design/architecture/01-frontend#s4-3)・[4.7 api の住所を SSR とブラウザで分ける](/design/architecture/01-frontend#s4-7)・[SRE 方式 4.4 SSR のアラート](/design/architecture/05-sre#s4-4)・[障害対応方式 4.2 逃げ道を先に決める](/design/architecture/08-incident-response#s4-2)・[D-FE-22 SSR サーバー](/design/detail/D-FE-22-ssr-server)・[D-INC-03 API の応答遅延](/design/detail/D-INC-03-slow-api)
- 前後のページ: [仕組み-3 Kubernetes の基本](./03-kubernetes-basics) ・ [仕組み-5 ヘッドレス CMS](./05-headless-cms)
