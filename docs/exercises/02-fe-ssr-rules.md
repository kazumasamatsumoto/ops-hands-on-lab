---
title: FE-2 SSR で壊れる書き方
---

# FE-2 SSR で壊れる書き方

::: info この演習について
- 所要時間: 約 15 分
- 使うもの: 軽量版(docker compose)。`curl`、Prometheus(http://localhost:19090)、pager(http://localhost:19094)
- 仕組みはこちら: [仕組み-4 storefront の SSR](/how-it-works/04-storefront-ssr)・[仕組み-11 観測(指標・ログ・トレース)](/how-it-works/11-observability)
- 関係する設計書: [FE 方式](/design/architecture/01-frontend)・[D-FE-22 SSR サーバー](/design/detail/D-FE-22-ssr-server)・[SRE 方式](/design/architecture/05-sre)
- 用語集: [SSR](/guide/glossary#ssr)・[ヘルスチェック](/guide/glossary#health-check)・[指標](/guide/glossary#metrics)・[アラートルール](/guide/glossary#alerting-rule)・[pager](/guide/glossary#pager)
:::

## 1. この設計書はなぜ必要か

SSR では、同じ画面のプログラムが **サーバー(Node.js)とブラウザの 2 か所で動きます**。
サーバーには「ブラウザにしか無い物」(`window`・`document`・`localStorage` など)がありません。
これを知らずに書くと、開発者の手元のブラウザでは動くのに、本番のサーバーでだけ全画面が落ちます。

> **よくある事故**: 金曜の夕方、「画面の幅に合わせてバナーを切り替える」小さな修正をリリースしました。
> 開発者はブラウザで確かめて OK を出しています。ところがリリース直後から、全画面が「500 エラー」に。
> サーバーの死活監視(ヘルスチェック)は緑のままなので、自動では切り戻されず、お客様からの問い合わせで気づきました。
> 原因は、修正したコードの 1 行 `window.innerWidth` でした。

だから FE の方式設計書には「サーバーでも動くコードの書き方の決まり(規約)」を書き、レビューで確かめます。

## 2. 何をやっているのか

storefront には、`SSR_WINDOW_BUG=true` にすると **「ブラウザかどうか確かめずに `window` を触る」** 1 行が動くスイッチがあります(`apps/web/src/app/app.ts`)。
これを入れると、サーバーで画面を組み立てる途中で `window is not defined`(window が無い)という例外になり、どの画面も 500 になります。
同じコードでも、CSR(ブラウザで組み立てる)にすると問題なく動くことも確かめます。

たとえ: **「家(ブラウザ)にはコンセントがある」前提で作った家電を、コンセントの無い屋外の作業場(サーバー)でも使おうとした** ようなものです。
家で試している限りは絶対に気づけません。「屋外でも使うなら電池でも動くように作る」という決まりが要ります。

::: tip CCv2 では
Composable Storefront を SSR で動かすときも、まったく同じ決まりがあります。SSR のエラー処理が有効な設定(新しく作ったアプリの既定)では、SSR のサーバーで例外が続くと、JS Storefront の Pod は生きているのに画面がエラー(500 など)になります(エラー処理が無い古い設定では、壊れた HTML が 200 で返ることもあり、なおさら気づきにくくなります)。
CCv2 の見張り(Dynatrace)では「storefront の 5xx の割合」で気づくように設定します。このラボでは Prometheus と pager がその役です。
:::

## 3. まず触ってみる

1. **壊すスイッチを入れる**(storefront を作り直します)。

   ::: code-group

   ```bash [Mac / Linux / WSL]
   SSR_WINDOW_BUG=true docker compose up -d storefront
   docker compose ps storefront        # (healthy) になるのを待つ
   ```

   ```powershell [PowerShell]
   $env:SSR_WINDOW_BUG = 'true'; docker compose up -d storefront
   docker compose ps storefront        # (healthy) になるのを待つ
   ```

   :::

   ::: tip PowerShell
   `$env:SSR_WINDOW_BUG = 'true'` は同じウィンドウで打つ以後のコマンド全部に効き続けます。戻すときは `Remove-Item Env:SSR_WINDOW_BUG` を先に打ちます(片付けの PowerShell タブに入れてあります)。
   :::

   `healthy` になることに注目してください。**死活監視は「プロセスが生きているか」しか見ていない** ので、画面が壊れていても緑です。

2. **画面を取ってみる**。

   ::: code-group

   ```bash [Mac / Linux / WSL]
   curl -s -D - "http://www.lab.localhost:18080/?t=bug" | grep -iE '^HTTP|x-render-mode|<h1>'
   for p in / /p/100001 /login; do curl -s -o /dev/null -w "$p %{http_code}\n" "http://www.lab.localhost:18080$p"; done
   ```

   ```powershell [PowerShell]
   curl.exe -s -D - 'http://www.lab.localhost:18080/?t=bug' | Select-String -Pattern '^HTTP|x-render-mode|<h1>'
   foreach ($p in '/', '/p/100001', '/login') { curl.exe -s -o NUL -w "$p %{http_code}\n" "http://www.lab.localhost:18080$p" }
   ```

   :::

   直前の 30 秒以内にトップや商品の画面を開いていると、その URL だけは cdn-waf の作り置き(壊す前の 200)が返ることがあります。30 秒待ってからもう一度打つと 500 になります。

3. **storefront のログを見る**。1 行が 1 つの JSON になっています。

   ::: code-group

   ```bash [Mac / Linux / WSL]
   docker compose logs storefront --no-log-prefix | grep ssr_error | tail -2
   ```

   ```powershell [PowerShell]
   docker compose logs storefront --no-log-prefix | Select-String 'ssr_error' | Select-Object -Last 2
   ```

   :::

4. **指標とアラートを見る**。1 秒おきに 20 回画面を開いてから(約 20 秒)、1〜2 分待ちます。

   ::: code-group

   ```bash [Mac / Linux / WSL]
   for i in $(seq 1 20); do curl -s -o /dev/null http://www.lab.localhost:18080/login; sleep 1; done
   ```

   ```powershell [PowerShell]
   foreach ($i in 1..20) { curl.exe -s -o NUL http://www.lab.localhost:18080/login; Start-Sleep 1 }
   ```

   :::

   `sleep 1`(PowerShell では `Start-Sleep 1`)を外して一瞬で 20 回開くと、Prometheus が数字を集める(5 秒ごと)前に全部終わってしまい、「500 が増えた」ことが記録されにくくなります。

   - Prometheus(http://localhost:19090)の「Query」で `ssr_errors_total` と `job:ssr_errors:rate5m` を実行します。
   - 「Alerts」を開くと `SSRErrors` が `firing`(鳴っている)になります。
   - pager(http://localhost:19094)に通知が届きます。storefront の 500 は SLO(成功率の目標)も削るので、`ErrorBudgetBurnPage`(緊急)も一緒に鳴ります。
     ただし Alertmanager には「緊急(page)が鳴っている間は、同じサービスの警告(ticket)を黙らせる」決まり(`observability/alertmanager/alertmanager.yml` の `inhibit_rules`)があります。
     `SSRErrors` は警告(ticket)なので、`ErrorBudgetBurnPage` が先に届くと pager には届かず、Alertmanager(http://localhost:19093)で `suppressed`(黙らされた)と表示されます。どちらが先になるかは、そのときの数秒の差で変わります。

5. **同じバグのまま CSR にする**。ブラウザで組み立てるなら、`window` があるので動きます。

   ::: code-group

   ```bash [Mac / Linux / WSL]
   SSR_WINDOW_BUG=true RENDER_MODE=csr docker compose up -d storefront
   docker compose ps storefront        # (healthy) を待つ
   for p in / /login /p/100001; do curl -s -o /dev/null -w "$p %{http_code} %header{x-render-mode}\n" "http://www.lab.localhost:18080$p?t=2"; done
   docker compose logs storefront --no-log-prefix | grep '"storefront started"' | tail -1
   ```

   ```powershell [PowerShell]
   $env:SSR_WINDOW_BUG = 'true'; $env:RENDER_MODE = 'csr'; docker compose up -d storefront
   docker compose ps storefront        # (healthy) を待つ
   foreach ($p in '/', '/login', '/p/100001') { curl.exe -s -o NUL -w "$p %{http_code} %header{x-render-mode}\n" "http://www.lab.localhost:18080${p}?t=2" }
   docker compose logs storefront --no-log-prefix | Select-String '"storefront started"' | Select-Object -Last 1
   ```

   :::

   PowerShell の URL で `${p}` と書いているのは、`$p?` と続けると `?` まで変数の名前だと思われるためです。

   ブラウザで http://www.lab.localhost:18080/?t=3 を開くと、トップが普通に表示され、画面下は「描画モード: CSR(ブラウザで描画)」です。

6. **正しい書き方を読む**。`apps/web/src/app/app.ts` のコメントに、サーバーでも安全な書き方(`isPlatformBrowser` で確かめる、`afterNextRender()` の中で触る)が書いてあります。

## 4. 何が見えたら成功か

**手順 1〜2**: storefront は `healthy` なのに、画面はすべて 500。

```text
HTTP/1.1 500 Internal Server Error
X-Render-Mode: ssr
<!doctype html><html lang="ja"><meta charset="utf-8"><title>エラー</title><h1>ただいま表示できません(500)</h1><p>サーバーで画面を作る途中で問題が起きました。</p></html>
/ 500
/p/100001 500
/login 500
```

**手順 3**: ログに原因がそのまま出ます。どの URL(`url`)・どの画面の型(`route`)で、何が起きたか(`error`)が分かります。

```text
{"time":"2026-09-26T01:24:03.899Z","service":"storefront","level":"error","event":"ssr_error","url":"/p/100001","route":"/p/:code","error":"window is not defined"}
{"time":"2026-09-26T01:24:03.914Z","service":"storefront","level":"error","event":"ssr_error","url":"/login","route":"/login","error":"window is not defined"}
```

**手順 4**: 指標が増え、アラートが鳴ります(実測の例。pager の時刻は日本時間です。ログの `time` は世界標準時なので、9 時間ずれて見えます)。

```text
ssr_errors_total{job="storefront"}           25
job:ssr_errors:rate5m{job="storefront"}      0.0837      ← 1 秒あたり約 0.08 件の SSR エラー

Alerts:  SSRErrors (storefront) firing / ErrorBudgetBurnPage (storefront) firing
pager:   15:08:42 発生中 ErrorBudgetBurnDemo storefront
         15:09:42 発生中 ErrorBudgetBurnPage storefront
         (SSRErrors は Alertmanager で suppressed。ErrorBudgetBurnPage より先に届いた回は、pager に「発生中 SSRErrors」も並びます)
```

いちばん早く届く `ErrorBudgetBurnDemo` は演習用の「早く鳴る」アラートです([SRE-2](./10-sre-burn-rate-alert) で詳しく見ます)。

**手順 5**: 同じバグでも CSR なら 200。起動ログにも両方のスイッチが出ます。

```text
/ 200 csr
/login 200 csr
/p/100001 200 csr
{"time":"2026-09-26T01:25:30.938Z","service":"storefront","level":"info","msg":"storefront started","port":4000,"renderMode":"csr","ssrTimeoutMs":3000,"ssrWindowBug":true,"apiInternalUrl":"http://api:3001","apiPublicUrl":"http://api.lab.localhost:18080","otel":false}
```

「ブラウザで確かめたから大丈夫」は SSR では通用しない、ということが数字で分かれば成功です。

## 5. ここで覚える言葉

| 言葉 | 一言でいうと | たとえ | この演習で見たもの |
| --- | --- | --- | --- |
| ブラウザ専用の物(`window` など) | ブラウザにだけあり、サーバーには無い道具 | 家にしか無いコンセント | `window is not defined` |
| プラットフォーム判定 | 今サーバーで動いているかブラウザかを確かめる書き方 | 「屋外なら電池で動かす」切り替えスイッチ | `app.ts` のコメントの `isPlatformBrowser` |
| [ヘルスチェック](/guide/glossary#health-check)(死活監視) | 生きているかを定期的に確かめる仕組み | 「呼んだら返事をするか」だけを見る点呼 | 500 なのに `healthy` のまま |
| 例外 | プログラムが続けられなくなった知らせ | 作業中に「部品が無い」と手が止まること | `ssr_error` のログ |
| [指標(メトリクス)](/guide/glossary#metrics) | 後で数えたり比べたりするための数字 | 体温計の目盛り | `ssr_errors_total` |
| [アラートルール](/guide/glossary#alerting-rule) | 数字が決めた線を越えたら人に知らせる決まり | 火災報知器 | `SSRErrors` が firing、pager に届く |

## 6. 設計書ではここに書く

- **[FE 方式 4.2 SSR で壊れない書き方](/design/architecture/01-frontend#s4-2)**:
  「`window`・`document`・`localStorage` は、`isPlatformBrowser` で確かめるか `afterNextRender()` の中でだけ使う」「サーバーで動く部分はレビューで必ず見る」「リリース前に SSR の状態で主要な画面を `curl` か E2E テストで開き、200 を確かめる(ブラウザだけの確認で済ませない)」と書きます。
- **[D-FE-22 SSR サーバー 4.2 SSR の流れ](/design/detail/D-FE-22-ssr-server#s4-2)・[4.3 指標](/design/detail/D-FE-22-ssr-server#s4-3)・[4.6 ログとトレース](/design/detail/D-FE-22-ssr-server#s4-6)**: SSR で例外が起きたときに返す画面(500 の固定の HTML)、出すログの項目(`event=ssr_error`、`url`、`error`)、数える指標(`ssr_errors_total`)。
- **[SRE 方式 4.4 SSR のアラート](/design/architecture/05-sre#s4-4)**: `SSRErrors` アラートの条件と通知先。死活監視だけでは気づけないので、**画面の 5xx の割合** で見張ることを書きます。

## 7. レビューで聞く質問

- 「このコードはサーバー(SSR)でも動きますか。`window`・`document`・`localStorage` を触る所は、ブラウザのときだけ動くようになっていますか。」
- 「この修正は、ブラウザだけでなく、SSR で HTML を取って(`curl` などで)確かめましたか。」
- 「SSR が失敗したとき、利用者には何が表示されますか。ログには何が残りますか。」
- 「ヘルスチェックが緑のまま画面が全部 500 になる場合、誰がどの指標で気づきますか。」
- 「SSR の不具合が本番で出たとき、CSR に切り替えて逃げる手順はありますか。」

## 8. 片付け

スイッチを戻して、SSR に戻します。

::: code-group

```bash [Mac / Linux / WSL]
docker compose up -d storefront
docker compose ps storefront                                                      # (healthy) を待つ
curl -s -o /dev/null -w '%{http_code} %header{x-render-mode}\n' http://www.lab.localhost:18080/login   # 200 ssr ならよい
```

```powershell [PowerShell]
Remove-Item Env:SSR_WINDOW_BUG, Env:RENDER_MODE -ErrorAction SilentlyContinue; docker compose up -d storefront   # 環境変数を消してから作り直す
docker compose ps storefront                                                      # (healthy) を待つ
curl.exe -s -o NUL -w '%{http_code} %header{x-render-mode}\n' http://www.lab.localhost:18080/login   # 200 ssr ならよい
```

:::

アラートは 5 分ほどで自然に `resolved`(解決)になり、pager にも状態が「解消」の通知が届きます。
警告(`ErrorBudgetBurnTicket`)は長い窓(30 分・6 時間)を見ているので、しばらく残ることがあります。次の演習に進んでかまいません。
