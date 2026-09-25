---
title: FE-1 SSR と CSR を見比べる
---

# FE-1 SSR と CSR を見比べる

::: info この演習について
- 所要時間: 約 15 分
- 使うもの: 軽量版(docker compose)。ブラウザと `curl`
- 関係する設計書: [FE 方式](/design/architecture/01-frontend)・[D-FE-22 SSR サーバー](/design/detail/D-FE-22-ssr-server)・[D-FE-04 商品詳細画面](/design/detail/D-FE-04-product-detail)
:::

## 1. この設計書はなぜ必要か

画面を「どこで組み立てるか」を決めないまま作り始めると、あとで取り返しがつきにくくなります。

> **よくある事故**: 新しいネットストアを公開して 1 か月。広告を出しているのに、検索サイトで商品名を検索しても自分のお店が出てきません。
> 調べると、サーバーが返している HTML には商品名が 1 つも入っておらず、「読み込み中…」の一文だけでした。
> 画面はブラウザの JavaScript が後から組み立てていたので、人がブラウザで見ると問題なく見えていたのです。
> さらに、古いスマートフォンのお客様からは「最初の数秒、真っ白」という苦情も来ていました。

どこで画面を組み立てるか(SSR か CSR か)は、検索に載るか・最初の表示が速いか・サーバーが何台要るか に直接効きます。
だから方式設計書で最初に決めて、理由を書いておきます。

## 2. 何をやっているのか

Web の画面は最終的に HTML です。この HTML を **サーバーで組み立ててから送る** のが SSR、**ほぼ空の HTML と JavaScript を送り、ブラウザが組み立てる** のが CSR です。
サンプルストアの web は、環境変数 `RENDER_MODE` を `ssr` にするか `csr` にするかで、同じアプリのまま両方を切り替えられます。

たとえ: **SSR は「組み立て済みの家具を届ける」、CSR は「部品と説明書を届けて、お客様の家で組み立ててもらう」** です。
組み立て済みなら届いた瞬間から使えます(最初の表示が速い・検索サイトにも中身が見える)が、お店(サーバー)の作業は増えます。
部品で届けるとお店は楽ですが、お客様の家(ブラウザ)で組み立てが終わるまで使えません。

## 3. まず触ってみる

ラボが起動していることが前提です(`docker compose up -d --build`、`docker compose ps` で web が `healthy`)。
コマンドは、リポジトリのいちばん上のフォルダ(`docker-compose.yml` がある場所)で打ちます。

1. **いまの SSR の HTML を見る**。`curl` は「ブラウザの代わりに HTML を取ってきて、そのまま表示する道具」です。JavaScript は動かしません(検索サイトのロボットに近い見え方です)。

   ```bash
   curl -s -D - -o /tmp/ssr.html http://localhost:18080/products | grep -iE 'x-render-mode|content-length'
   grep -o 'class="product-card"' /tmp/ssr.html | wc -l     # 商品のカードがいくつ入っているか
   grep -o '<span class="product-name">[^<]*' /tmp/ssr.html | head -3
   ```

2. **ブラウザで見る**。http://localhost:18080/products を開き、画面のいちばん下の「描画モード」を確かめます。
   次に、右クリック →「ページのソースを表示」で、サーバーから届いた HTML そのものを見ます(商品名が並んでいるはずです)。

3. **CSR に切り替える**。コマンドの前に `RENDER_MODE=csr` と書くと、その 1 回だけ web の設定を変えて作り直せます。

   ```bash
   RENDER_MODE=csr docker compose up -d web
   docker compose ps web        # STATUS が (healthy) になるまで待つ(10〜20 秒)
   ```

4. **CSR の HTML を見る**。ただし、edge(入口)が商品一覧を **30 秒ためている(キャッシュ)** ので、切り替え直後は古い SSR の HTML が返ることがあります。30 秒待ってから取ってください(キャッシュは [ネットワーク-1](./07-nw-cache) で詳しく見ます)。

   ```bash
   curl -s -D - -o /tmp/csr.html http://localhost:18080/products | grep -iE 'x-render-mode|content-length|cache-control'
   grep -o 'class="product-card"' /tmp/csr.html | wc -l
   sed -n '/<body/,$p' /tmp/csr.html
   ```

5. **ブラウザでもう一度見る**。http://localhost:18080/products を再読み込みします。見た目はほとんど同じで、下の「描画モード」だけが変わります。
   ところが「ページのソースを表示」では、商品名がどこにもありません。

6. **速さを比べる**。`time_starttransfer` は「最初の 1 バイトが届くまでの時間(TTFB)」です。

   ```bash
   curl -s -o /dev/null -w 'status=%{http_code} size=%{size_download}B ttfb=%{time_starttransfer}s\n' http://localhost:18080/products
   ```

   SSR に戻してから(手順 8 の片付け)同じコマンドを打つと、SSR のときの数字も取れます。

## 4. 何が見えたら成功か

**SSR のとき**: 応答ヘッダが `X-Render-Mode: ssr`、HTML に商品カードが 30 個、商品名がそのまま入っています。

```text
X-Render-Mode: ssr
      30
<span class="product-name">ノート A5 方眼
<span class="product-name">ノート B5 横罫
<span class="product-name">ゲルインクボールペン 0.5 黒
```

**CSR のとき**: `X-Render-Mode: csr`、HTML はわずか 1,228 バイトで、商品カードは 0 個。中身は「読み込み中…」だけです。

```text
Content-Length: 1228
X-Render-Mode: csr
Cache-Control: no-store
       0
<body ngcm="">
  <app-root>
    <!-- CSR のときは、JS が動くまでこの文だけが見えます -->
    <p style="padding:1rem">読み込み中…</p>
  </app-root>
<link rel="modulepreload" href="chunk-W2E5YAUG.js"><script src="main-VH6364XH.js" type="module"></script></body>
</html>
```

(ファイル名の英数字の部分は、ビルドのたびに変わります。)

ブラウザでは、どちらでも商品が 30 個並びます。違いは画面下の表示だけです。

| モード | 画面下の表示 | ソースに商品名 | HTML の大きさ | TTFB(実測の例) |
| --- | --- | --- | --- | --- |
| SSR | 描画モード: SSR(サーバーで描画) | ある | 18,725 バイト | 0.098 秒(キャッシュ無し)/ 0.004 秒(キャッシュ HIT) |
| CSR | 描画モード: CSR(ブラウザで描画) | ない | 1,228 バイト | 0.008〜0.012 秒 |

CSR の方が「最初の 1 バイト」は速いのに、利用者が商品を見られるのは、JS(約 320kB)を読み込み、さらに API から商品を取ってきた **後** です。
SSR はサーバーで API を呼んで組み立てるぶん最初の 1 バイトは遅めですが、届いた HTML にすでに商品が載っています。
「どの時点を速さと呼ぶか」を決めないと、比べ方そのものがずれる、というのもこの演習の大事な発見です。

## 5. ここで覚える言葉

| 言葉 | 一言でいうと | たとえ | この演習で見たもの |
| --- | --- | --- | --- |
| SSR(サーバーサイドレンダリング) | サーバーで HTML を組み立ててから送る | 組み立て済みの家具を届ける | `X-Render-Mode: ssr`、ソースに商品名が並ぶ |
| CSR(クライアントサイドレンダリング) | 空の HTML と JS を送り、ブラウザが組み立てる | 部品と説明書を届ける | 1,228 バイトの「読み込み中…」だけの HTML |
| ハイドレーション | SSR の HTML をそのまま使い、ブラウザは「動き」だけを後付けする | 届いた家具に電池を入れて動くようにする | SSR でもボタンやリンクがブラウザで動く |
| TTFB | 最初の 1 バイトが届くまでの時間 | 注文してから最初の品が出てくるまで | `curl -w` の `time_starttransfer` |
| 検索サイトのロボット(クローラー) | ページを集めて検索に載せる自動の読み手。JS を動かさないことがある | 表紙と目次だけで本を分類する司書 | `curl` で見た CSR の HTML に商品名が無い |
| 環境変数 | プログラムの外から渡す設定値 | 家電の設定スイッチ | `RENDER_MODE=csr docker compose up -d web` |

## 6. 設計書ではここに書く

- **[FE 方式 4.1 描画方式](/design/architecture/01-frontend#s4-1)**:
  「商品一覧・商品詳細は SSR。理由は検索に載せるためと、最初の表示を速くするため。注文履歴など、ログインした人だけの画面は SSR でもよいがキャッシュはしない」のように、**画面ごとに** どちらにするかと理由を書きます。
- **[FE 方式 5 目標](/design/architecture/01-frontend#s5)**: 「商品詳細の最初の表示を 2.5 秒以内」など、速さの目標を「どの時点で測るか」まで書きます。
- **[D-FE-22 SSR サーバー 4.1 環境変数](/design/detail/D-FE-22-ssr-server#s4-1)**(一般のカタログでは D-FE-22): `RENDER_MODE` などの環境変数の一覧、既定値、どの応答ヘッダで見分けられるか(`X-Render-Mode`)。
- **[D-FE-04 商品詳細画面 4.4 SSR とキャッシュの注意](/design/detail/D-FE-04-product-detail#s4-4)**(一般のカタログでは D-FE-04): この画面はサーバーで何の API を呼ぶか、その答えを edge でためてよいか。

## 7. レビューで聞く質問

- 「この画面は SSR と CSR のどちらで描画しますか。そう決めた理由(検索・速さ・サーバー負荷)は何ですか。」
- 「検索サイトに載せたい画面はどれですか。その画面を `curl` で取ったとき、HTML に商品名や説明文は入っていますか。」
- 「速さの目標は、どの時点(最初の 1 バイト・最初の表示・操作できるようになるまで)で測る前提ですか。」
- 「SSR をやめて CSR に切り替える必要が出たとき、設定 1 か所で切り替えられますか。それはどこに書いてありますか。」
- 「SSR のとき、サーバーの台数や CPU の見積もりに、画面を組み立てる処理のぶんは入っていますか。」

## 8. 片付け

SSR に戻します(`RENDER_MODE` を付けずに打つと、既定の `ssr` になります)。

```bash
docker compose up -d web
docker compose ps web                               # (healthy) を待つ
curl -sI http://localhost:18080/login | grep -i x-render-mode   # X-Render-Mode: ssr ならよい
rm -f /tmp/ssr.html /tmp/csr.html
```
