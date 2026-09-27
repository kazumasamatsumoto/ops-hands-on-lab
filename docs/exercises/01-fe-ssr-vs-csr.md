---
title: FE-1 SSR と CSR を見比べる
---

# FE-1 SSR と CSR を見比べる

::: info この演習について
- 所要時間: 約 15 分
- 使うもの: 軽量版(docker compose)。ブラウザと `curl`
- 仕組みはこちら: [仕組み-4 storefront の SSR](/how-it-works/04-storefront-ssr)・[仕組み-5 ヘッドレスと CMS 駆動の描画](/how-it-works/05-headless-cms)
- 関係する設計書: [FE 方式](/design/architecture/01-frontend)・[D-FE-22 SSR サーバー](/design/detail/D-FE-22-ssr-server)・[D-FE-04 商品詳細画面](/design/detail/D-FE-04-product-detail)
- 用語集: [SSR](/guide/glossary#ssr)・[CSR](/guide/glossary#csr)・[ハイドレーション](/guide/glossary#hydration)・[TransferState](/guide/glossary#transferstate)・[SEO](/guide/glossary#seo)
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
サンプルストアの storefront(お店の画面の係)は、環境変数 `RENDER_MODE` を `ssr` にするか `csr` にするかで、同じアプリのまま両方を切り替えられます。

SSR のとき、storefront はサーバーの中で api に「このページの設計図(CMS の JSON)」と「商品の中身」を聞き、HTML に組み立ててから返します。
api への道は、ブラウザが使う表の入口(`http://api.lab.localhost:18080`)ではなく、コンテナ同士の内側の近道(`http://api:3001`)です。

たとえ: **SSR は「組み立て済みの家具を届ける」、CSR は「部品と説明書を届けて、お客様の家で組み立ててもらう」** です。
組み立て済みなら届いた瞬間から使えます(最初の表示が速い・検索サイトにも中身が見える)が、お店(サーバー)の作業は増えます。
部品で届けるとお店は楽ですが、お客様の家(ブラウザ)で組み立てが終わるまで使えません。

::: tip CCv2 では
storefront は、CCv2 の **JS Storefront**(Composable Storefront を SSR で動かすもの)に当たります。CCv2 でも SSR を使うかどうか、時間切れで CSR に切り替えるかどうかは、storefront の設定で決めます。
:::

## 3. まず触ってみる

ラボが起動していることが前提です(`docker compose up -d --build`、`docker compose ps` で storefront が `healthy`)。
コマンドは、リポジトリのいちばん上のフォルダ(`docker-compose.yml` がある場所)で打ちます。

1. **いまの SSR の HTML を見る**。`curl` は「ブラウザの代わりに HTML を取ってきて、そのまま表示する道具」です。JavaScript は動かしません(検索サイトのロボットに近い見え方です)。

   ```bash
   curl -s -D - -o /tmp/ssr.html http://www.lab.localhost:18080/p/100001 | grep -iE 'x-render-mode|content-length|x-cache'
   grep -oE '<h1[^>]*>[^<]*' /tmp/ssr.html                     # 商品名の見出し
   grep -o 'data-cms-type="[^"]*"' /tmp/ssr.html | sort | uniq -c   # CMS の部品がいくつ入っているか
   ```

2. **ブラウザで見る**。http://www.lab.localhost:18080/p/100001 を開き、画面のいちばん下の「描画モード」を確かめます。
   次に、右クリック →「ページのソースを表示」で、サーバーから届いた HTML そのものを見ます(商品名や説明が並んでいるはずです)。
   Safari で開けないときは [準備と起動](/guide/setup) の「`*.localhost` の名前」を見てください。

3. **CSR に切り替える**。コマンドの前に `RENDER_MODE=csr` と書くと、その 1 回だけ storefront の設定を変えて作り直せます。

   ```bash
   RENDER_MODE=csr docker compose up -d storefront
   docker compose ps storefront        # STATUS が (healthy) になるまで待つ(10〜20 秒)
   ```

4. **CSR の HTML を見る**。ただし、入口の cdn-waf が商品詳細の HTML を **30 秒ためている(キャッシュ)** ので、切り替え直後は古い SSR の HTML が返ることがあります。
   ここでは URL の後ろに `?t=csr` を付けて「別の URL」にし、キャッシュを避けます(キャッシュは [ネットワーク-1](./07-nw-cache) で詳しく見ます)。

   ```bash
   curl -s -D - -o /tmp/csr.html "http://www.lab.localhost:18080/p/100001?t=csr" | grep -iE 'x-render-mode|content-length|cache-control'
   grep -c 'data-cms-type' /tmp/csr.html
   sed -n '/<body/,$p' /tmp/csr.html
   ```

   zsh(Mac の標準のシェル)では、`?` の入った URL は必ず `"..."` で囲んでください。囲まないと `no matches found` と言われます。

5. **ブラウザでもう一度見る**。http://www.lab.localhost:18080/p/100001?t=csr2 を開きます。見た目はほとんど同じで、下の「描画モード」だけが変わります。
   ところが「ページのソースを表示」では、商品名がどこにもありません。

6. **速さを比べる**。`time_starttransfer` は「最初の 1 バイトが届くまでの時間(TTFB)」です。`$RANDOM` で毎回違う URL にして、キャッシュを避けます。

   ```bash
   for i in 1 2 3; do
     curl -s -o /dev/null -w 'status=%{http_code} size=%{size_download}B ttfb=%{time_starttransfer}s\n' "http://www.lab.localhost:18080/p/100001?t=$i$RANDOM"
   done
   ```

   SSR に戻してから(手順 8 の片付け)同じコマンドを打つと、SSR のときの数字も取れます。

## 4. 何が見えたら成功か

**SSR のとき(手順 1)**: 応答ヘッダが `X-Render-Mode: ssr`、HTML に商品名と CMS の部品(`data-cms-type`)がそのまま入っています。

```text
Content-Length: 21525
X-Render-Mode: ssr
X-Cache-Status: MISS
<h1>ノート A5 方眼
   1 data-cms-type="CMSParagraphComponent"
   1 data-cms-type="NavigationComponent"
   1 data-cms-type="ProductCarouselComponent"
   1 data-cms-type="ProductDetailsComponent"
   1 data-cms-type="SearchBoxComponent"
```

(`Content-Length` は 21,400〜21,500 ほどです。HTML には在庫の数も入っていて、worker の定期ジョブが在庫を 1 分ごとに少し動かすので、100 バイトほど変わることがあります。)

**CSR のとき(手順 4)**: `X-Render-Mode: csr`、HTML はわずか 1,300 バイトで、CMS の部品は 0 個。中身は「読み込み中…」だけです。

```text
Content-Length: 1300
X-Render-Mode: csr
Cache-Control: no-store
0
<body ngcm="">
  <app-root>
    <!-- CSR のときは、JS が動くまでこの文だけが見えます -->
    <p style="padding:1rem">読み込み中…</p>
  </app-root>
<link rel="modulepreload" href="chunk-MLVPJDFE.js"><script src="main-QGHRXANE.js" type="module"></script></body>
</html>
```

(ファイル名の英数字の部分は、ビルドのたびに変わります。)
`Cache-Control: no-store` は「この空の HTML はためないで」という印です。空の HTML が入口にたまると、SSR に戻したあとも 30 秒間、空の画面が配られてしまうからです。

ブラウザでは、どちらでも商品が表示されます。違いは画面下の表示と、ソースの中身だけです。

| モード | 画面下の表示 | ソースに商品名 | HTML の大きさ | TTFB(実測の例) |
| --- | --- | --- | --- | --- |
| SSR | 描画モード: SSR(サーバーで描画) | ある | 約 21,400〜21,500 バイト | 0.03〜0.05 秒(キャッシュ無し)/ 0.006 秒(キャッシュ HIT) |
| CSR | 描画モード: CSR(ブラウザで描画) | ない | 1,300 バイト | 0.007〜0.009 秒 |

CSR の方が「最初の 1 バイト」は速いのに、利用者が商品を見られるのは、JS(約 336kB)を読み込み、さらにブラウザが api(`http://api.lab.localhost:18080`)から CMS の JSON と商品を取ってきた **後** です。
SSR はサーバーで api を呼んで組み立てるぶん最初の 1 バイトは遅めですが、届いた HTML にすでに商品が載っています。
「どの時点を速さと呼ぶか」を決めないと、比べ方そのものがずれる、というのもこの演習の大事な発見です。

## 5. ここで覚える言葉

| 言葉 | 一言でいうと | たとえ | この演習で見たもの |
| --- | --- | --- | --- |
| [SSR](/guide/glossary#ssr)(サーバーサイドレンダリング) | サーバーで HTML を組み立ててから送る | 組み立て済みの家具を届ける | `X-Render-Mode: ssr`、ソースに商品名が並ぶ |
| [CSR](/guide/glossary#csr)(クライアントサイドレンダリング) | 空の HTML と JS を送り、ブラウザが組み立てる | 部品と説明書を届ける | 1,300 バイトの「読み込み中…」だけの HTML |
| [ハイドレーション](/guide/glossary#hydration) | SSR の HTML をそのまま使い、ブラウザは「動き」だけを後付けする | 届いた家具に電池を入れて動くようにする | SSR でもボタンやリンクがブラウザで動く |
| [TransferState](/guide/glossary#transferstate) | SSR で取った JSON を HTML に入れてブラウザに申し送る | 「部品はもうそろっています」のメモを同梱する | SSR の HTML の中の `<script id="ng-state">` |
| TTFB | 最初の 1 バイトが届くまでの時間 | 注文してから最初の品が出てくるまで | `curl -w` の `time_starttransfer` |
| [SEO](/guide/glossary#seo)(検索サイトのロボット) | ページを集めて検索に載せる自動の読み手。JS を動かさないことがある | 表紙と目次だけで本を分類する司書 | `curl` で見た CSR の HTML に商品名が無い |
| [環境変数](/guide/glossary#env-var) | プログラムの外から渡す設定値 | 家電の設定スイッチ | `RENDER_MODE=csr docker compose up -d storefront` |

## 6. 設計書ではここに書く

- **[FE 方式 4.1 描画方式](/design/architecture/01-frontend#s4-1)**:
  「トップ・商品詳細・検索結果は SSR。理由は検索に載せるためと、最初の表示を速くするため。注文履歴など、ログインした人だけの画面は SSR でもよいがキャッシュはしない」のように、**画面ごとに** どちらにするかと理由を書きます。
- **[FE 方式 4.7 api の住所を SSR とブラウザで分ける](/design/architecture/01-frontend#s4-7)**: SSR 中は内側の近道(`API_INTERNAL_URL`)、ブラウザからは表の入口(`API_PUBLIC_URL`)。
- **[FE 方式 5 目標](/design/architecture/01-frontend#s5)**: 「商品詳細の最初の表示を 2.5 秒以内」など、速さの目標を「どの時点で測るか」まで書きます。
- **[D-FE-22 SSR サーバー 4.1 環境変数](/design/detail/D-FE-22-ssr-server#s4-1)**・**[4.5 HTML に書き足す印](/design/detail/D-FE-22-ssr-server#s4-5)**: `RENDER_MODE` などの環境変数の一覧、既定値、どの応答ヘッダで見分けられるか(`X-Render-Mode`)。
- **[D-FE-04 商品詳細画面 4.4 SSR とキャッシュの注意](/design/detail/D-FE-04-product-detail#s4-4)**: この画面はサーバーで何の API を呼ぶか、その答えを入口でためてよいか。

## 7. レビューで聞く質問

- 「この画面は SSR と CSR のどちらで描画しますか。そう決めた理由(検索・速さ・サーバー負荷)は何ですか。」
- 「検索サイトに載せたい画面はどれですか。その画面を `curl` で取ったとき、HTML に商品名や説明文は入っていますか。」
- 「速さの目標は、どの時点(最初の 1 バイト・最初の表示・操作できるようになるまで)で測る前提ですか。」
- 「SSR をやめて CSR に切り替える必要が出たとき、設定 1 か所で切り替えられますか。それはどこに書いてありますか。」
- 「SSR のとき、サーバーの台数や CPU の見積もりに、画面を組み立てる処理のぶんは入っていますか。」
- 「CSR の空の HTML や、SSR をあきらめた HTML が、入口(CDN)にためられないようになっていますか。」

## 8. 片付け

SSR に戻します(`RENDER_MODE` を付けずに打つと、既定の `ssr` になります)。

```bash
docker compose up -d storefront
docker compose ps storefront                                              # (healthy) を待つ
curl -sI http://www.lab.localhost:18080/login | grep -i x-render-mode    # X-Render-Mode: ssr ならよい
rm -f /tmp/ssr.html /tmp/csr.html
```
