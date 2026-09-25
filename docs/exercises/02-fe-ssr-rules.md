---
title: FE-2 SSR で壊れる書き方
---

# FE-2 SSR で壊れる書き方

::: info この演習について
- 所要時間: 約 15 分
- 使うもの: 軽量版(docker compose)。ブラウザ、`curl`、Prometheus(http://localhost:19090)、pager(http://localhost:19094)
- 関係する設計書: [FE 方式](/design/architecture/01-frontend)・[D-FE-22 SSR サーバー](/design/detail/D-FE-22-ssr-server)
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

サンプルストアの web には、`SSR_WINDOW_BUG=true` にすると **「ブラウザかどうか確かめずに `window` を触る」** 1 行が動くスイッチがあります(`apps/web/src/app/app.ts`)。
これを入れると、サーバーで画面を組み立てる途中で `window is not defined`(window が無い)という例外になり、どの画面も 500 になります。
同じコードでも、CSR(ブラウザで組み立てる)にすると問題なく動くことも確かめます。

たとえ: **「家(ブラウザ)にはコンセントがある」前提で作った家電を、コンセントの無い屋外の作業場(サーバー)でも使おうとした** ようなものです。
家で試している限りは絶対に気づけません。「屋外でも使うなら電池でも動くように作る」という決まりが要ります。

## 3. まず触ってみる

1. **壊すスイッチを入れる**(web を作り直します)。

   ```bash
   SSR_WINDOW_BUG=true docker compose up -d web
   docker compose ps web        # (healthy) になるのを待つ
   ```

   `healthy` になることに注目してください。**死活監視は「プロセスが生きているか」しか見ていない** ので、画面が壊れていても緑です。

2. **画面を取ってみる**。

   ```bash
   curl -s -D - http://localhost:18080/ | grep -iE '^HTTP|x-render-mode|<h1>'
   for p in / /products/3 /login; do curl -s -o /dev/null -w "$p %{http_code}\n" http://localhost:18080$p; done
   ```

3. **web のログを見る**。1 行が 1 つの JSON になっています。

   ```bash
   docker compose logs web --no-log-prefix | grep ssr_error | tail -2
   ```

4. **指標とアラートを見る**。1 秒おきに 20 回画面を開いてから(約 20 秒)、1〜2 分待ちます。

   ```bash
   for i in $(seq 1 20); do curl -s -o /dev/null http://localhost:18080/login; sleep 1; done
   ```

   `sleep 1` を外して一瞬で 20 回開くと、Prometheus が数字を集める(5 秒ごと)前に全部終わってしまい、「500 が増えた」ことが記録されません。その場合 `ErrorBudgetBurnPage` は鳴りません。

   - Prometheus(http://localhost:19090)で `ssr_errors_total` と `job:ssr_errors:rate5m` を実行します。
   - 「Alerts」を開くと `SSRErrors` が `firing`(鳴っている)になります。
   - pager(http://localhost:19094)に通知が届きます。web の 500 は SLO(成功率の目標)も削るので、`ErrorBudgetBurnPage`(緊急)も一緒に届きます。

5. **同じバグのまま CSR にする**。ブラウザで組み立てるなら、`window` があるので動きます。

   ```bash
   SSR_WINDOW_BUG=true RENDER_MODE=csr docker compose up -d web
   docker compose ps web        # (healthy) を待つ
   for p in / /login; do curl -s -o /dev/null -w "$p %{http_code} %header{x-render-mode}\n" http://localhost:18080$p; done
   ```

   ブラウザで http://localhost:18080/products を開くと、商品が普通に 30 個並び、画面下は「描画モード: CSR(ブラウザで描画)」です。

6. **正しい書き方を読む**。`apps/web/src/app/app.ts` のコメントに、サーバーでも安全な書き方(`isPlatformBrowser` で確かめる、`afterNextRender()` の中で触る)が書いてあります。

## 4. 何が見えたら成功か

**手順 1〜2**: web は `healthy` なのに、画面はすべて 500。

```text
HTTP/1.1 500 Internal Server Error
X-Render-Mode: ssr
<!doctype html><html lang="ja"><meta charset="utf-8"><title>エラー</title><h1>ただいま表示できません(500)</h1>...
/ 500
/products/3 500
/login 500
```

**手順 3**: ログに原因がそのまま出ます。

```text
{"time":"2026-09-25T14:51:04.533Z","service":"web","level":"error","event":"ssr_error","url":"/login","route":"/login","error":"window is not defined"}
```

**手順 4**: 指標が増え、アラートが鳴ります(実測の例)。

```text
ssr_errors_total{job="web"}           24
job:ssr_errors:rate5m{job="web"}      0.0818      ← 1 秒あたり約 0.08 件の SSR エラー

Alerts:  SSRErrors (web) firing / ErrorBudgetBurnPage (web) firing
pager:   14:52:20 firing SSRErrors web
         14:52:32 firing ErrorBudgetBurnPage web
```

pager には、演習用の早く鳴る `ErrorBudgetBurnDemo`(デモ用)も一緒に届きます([SRE-2](./10-sre-burn-rate-alert) で詳しく見ます)。

**手順 5**: 同じバグでも CSR なら 200。起動ログにも両方のスイッチが出ます。

```text
/ 200 csr
/login 200 csr
{"service":"web","level":"info","msg":"web started","port":4000,"renderMode":"csr","ssrTimeoutMs":3000,"ssrWindowBug":true,...}
```

「ブラウザで確かめたから大丈夫」は SSR では通用しない、ということが数字で分かれば成功です。

## 5. ここで覚える言葉

| 言葉 | 一言でいうと | たとえ | この演習で見たもの |
| --- | --- | --- | --- |
| ブラウザ専用の物(`window` など) | ブラウザにだけあり、サーバーには無い道具 | 家にしか無いコンセント | `window is not defined` |
| プラットフォーム判定 | 今サーバーで動いているかブラウザかを確かめる書き方 | 「屋外なら電池で動かす」切り替えスイッチ | `app.ts` のコメントの `isPlatformBrowser` |
| 死活監視(ヘルスチェック) | 生きているかを定期的に確かめる仕組み | 「呼んだら返事をするか」だけを見る点呼 | 500 なのに `healthy` のまま |
| 例外 | プログラムが続けられなくなった知らせ | 作業中に「部品が無い」と手が止まること | `ssr_error` のログ |
| 指標(メトリクス) | 後で数えたり比べたりするための数字 | 体温計の目盛り | `ssr_errors_total` |
| アラート | 数字が決めた線を越えたら人に知らせる仕組み | 火災報知器 | `SSRErrors` が firing、pager に届く |

## 6. 設計書ではここに書く

- **[FE 方式 4.2 SSR で壊れない書き方](/design/architecture/01-frontend#s4-2)**:
  「`window`・`document`・`localStorage` は、`isPlatformBrowser` で確かめるか `afterNextRender()` の中でだけ使う」「サーバーで動く部分はレビューで必ず見る」「リリース前に SSR の状態で主要な画面を `curl` か E2E テストで開き、200 を確かめる(ブラウザだけの確認で済ませない)」と書きます。
- **[D-FE-22 SSR サーバー 4.2 SSR の流れ](/design/detail/D-FE-22-ssr-server#s4-2)・[4.3 指標](/design/detail/D-FE-22-ssr-server#s4-3)**(一般のカタログでは D-FE-22): SSR で例外が起きたときに返す画面(500 の固定の HTML)、出すログの項目(`event=ssr_error`、`url`、`error`)、数える指標(`ssr_errors_total`)。
- **[SRE 方式 4.4 SSR のアラート](/design/architecture/05-sre#s4-4)**: `SSRErrors` アラートの条件と通知先。死活監視だけでは気づけないので、**画面の 5xx の割合** で見張ることを書きます。

## 7. レビューで聞く質問

- 「このコードはサーバー(SSR)でも動きますか。`window`・`document`・`localStorage` を触る所は、ブラウザのときだけ動くようになっていますか。」
- 「この修正は、ブラウザだけでなく、SSR で HTML を取って(`curl` などで)確かめましたか。」
- 「SSR が失敗したとき、利用者には何が表示されますか。ログには何が残りますか。」
- 「ヘルスチェックが緑のまま画面が全部 500 になる場合、誰がどの指標で気づきますか。」
- 「SSR の不具合が本番で出たとき、CSR に切り替えて逃げる手順はありますか。」

## 8. 片付け

スイッチを戻して、SSR に戻します。

```bash
docker compose up -d web
docker compose ps web                                  # (healthy) を待つ
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:18080/login   # 200 ならよい
```

アラートは 5 分ほどで自然に `resolved`(解決)になり、pager にも「解決」の通知が届きます。
