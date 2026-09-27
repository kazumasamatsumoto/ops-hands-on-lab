---
title: 仕組み-0 クリックから DB まで(全体の流れ)
---

# 仕組み-0 クリックから DB まで(全体の流れ)

::: tip このページで分かること
- ブラウザで商品ページを開いたとき、リクエストが **どの部品を、どの順で、何のために** 通るか。
- 画面が出たあと、ブラウザが **自分で** api を呼ぶ「2 回目の流れ」(ハイドレーション・別オリジン・CORS)。
- 各部品の詳しい話は、仕組み-1〜12 のページにあります。ここはその「目次を兼ねた地図」です。
:::

## 1. 一言でいうと {#s1}

お店の画面は、**入口で 2 回チェックされ、サーバーで組み立てられ、DB のデータで中身が埋まってから** ブラウザに届きます。
届いたあとは、ブラウザが画面を「動くように」し、そこから先は **ブラウザが直接 api と話します**。

**たとえ: 出前の注文**

| ラボの部品 | 出前でいうと |
| --- | --- |
| ブラウザ | 注文するお客さん |
| cdn-waf | ビルの入口の警備員。怪しい人を止め、よく頼まれる品(キャッシュ)は自分で渡す |
| ingress | お店の受付。「どの窓口の注文か」を宛名(ホスト名)で振り分ける |
| storefront(SSR) | 盛り付け係。注文に合わせて料理(HTML)を皿に盛る |
| api | 厨房。材料(データ)をそろえて渡す |
| db | 冷蔵庫・倉庫。材料そのもの |

盛り付け係(storefront)は、厨房(api)に **お店の中の近道**(`http://api:3001`)で材料を頼みます。
一方、料理を受け取ったお客さん(ブラウザ)が「追加でこれも」と頼むときは、**表の入口からもう一度**(`http://api.lab.localhost:18080`)頼みます。
この「近道」と「表の入口」の 2 本があることが、このラボ(そして CCv2 のヘッドレス構成)を理解するいちばんの鍵です。

## 2. 1 リクエストの流れ {#s2}

### 2.1 1 回目: 画面(HTML)が届くまで {#s2-1}

例として、商品ページ `http://www.lab.localhost:18080/p/100001` を開いたときの流れです(軽量版)。

```text
 ① ブラウザ   GET http://www.lab.localhost:18080/p/100001
      │         www.lab.localhost は自分の PC(127.0.0.1)。18080 番は cdn-waf の入口
      ▼
 ② cdn-waf    (クラスタの外の CDN + WAF の役)
      │         WAF の検査 → レート制限 → キャッシュにあれば ここで返す(HIT)
      │         無ければ Host: www.lab.localhost を付けたまま ingress:8080 へ
      ▼
 ③ ingress    (クラスタの入口 = エンドポイント)
      │         Host を見て「www → storefront:4000」と決める
      ▼
 ④ storefront (Angular の SSR)
      │         /p/:code の画面を組み立てる。材料が要るので api に聞く(近道)
      │           GET http://api:3001/occ/v2/samplestore/cms/pages?pageType=ProductPage&code=100001
      │           GET http://api:3001/occ/v2/samplestore/products/100001?fields=FULL
      │           GET http://api:3001/occ/v2/samplestore/products/{同じ分類の商品}?fields=DEFAULT(最大 8 回)
      ▼
 ⑤ api        (ASPECT=api。OCC 風の REST API)
      │         SQL で DB に問い合わせ、JSON にして返す
      ▼
 ⑥ db         (PostgreSQL)

  帰り道: db → api(JSON)→ storefront(HTML を完成)→ ingress → cdn-waf(30 秒ためる・ヘッダを足す)→ ブラウザ
```

1. **ブラウザ**: `www.lab.localhost` という名前を IP アドレスに直します。`.localhost` で終わる名前は、Chrome・Edge・Firefox と curl(7.85 以降)なら設定しなくても自分の PC(127.0.0.1)になります(macOS 26 より前の Safari など、自動では解決しないブラウザもあるので、そのときは [はじめに](/guide/setup) の `/etc/hosts` の 1 行を足します)。ポート 18080 に TCP でつなぎ、HTTP の `GET /p/100001` と `Host: www.lab.localhost` ヘッダを送ります。
2. **cdn-waf**: 最初に WAF(ModSecurity)が中身を検査し、攻撃らしければ 403 で止めます。次に「同じ IP から 1 秒 20 回まで」のレート制限を数えます。商品ページはキャッシュの対象なので、30 秒以内に同じ URL が来ていれば、奥に行かずにここで返します(`X-Cache-Status: HIT`)。無ければ ingress に渡します。→ [仕組み-1](./01-cdn-waf)
3. **ingress**: `Host` ヘッダの名前を見て、行き先(storefront)を決めます。backoffice なら IP も確かめます。→ [仕組み-2](./02-ingress-and-endpoints)
4. **storefront**: Angular がサーバーの中で画面を組み立てます(SSR)。画面の「設計図」を api の CMS から取り、設計図に書かれた部品ごとに商品のデータも取ります。このときの api の住所は **内側の近道**(`API_INTERNAL_URL` = `http://api:3001`)で、cdn-waf も ingress も通りません。3000 ミリ秒以内に終わらなければ、あきらめて空の HTML を返します(フォールバック)。→ [仕組み-4](./04-storefront-ssr)・[仕組み-5](./05-headless-cms)
5. **api**: URL の形(`/occ/v2/samplestore/...`)で処理を選び、DB に SQL を投げ、結果を OCC 風の JSON にして返します。→ [仕組み-6](./06-api-occ)
6. **db**: 表(テーブル)から行を探して返します。→ [仕組み-10](./10-db-and-backup)

帰り道で、storefront は完成した HTML に次の 3 つを入れて返します。

| 入っている物 | 何のためか |
| --- | --- |
| 画面の中身(`data-cms-type="..."` の付いた部品) | JS が動く前から、画面が見える・検索エンジンにも読める |
| `<script id="ng-state">`(TransferState = 申し送り) | サーバーが api から受け取った JSON。ブラウザが同じ物を取り直さないため |
| `<meta name="api-public-url" content="http://api.lab.localhost:18080">` | ブラウザが api を呼ぶときの「表の入口」の住所 |

cdn-waf は返事を 30 秒ためて、CSP などのセキュリティヘッダを足してからブラウザに渡します。

### 2.2 2 回目: 画面が届いたあと、ブラウザがすること {#s2-2}

```text
 ⑦ ブラウザが HTML を表示 → <script src="main-xxxx.js"> などを www から取る(同じオリジン)
 ⑧ ハイドレーション: サーバーが作った画面(DOM)を捨てずに、ボタンなどの「動き」だけを付ける
      ng-state に api の JSON があるので、最初の表示では api を呼ばない
 ⑨ 画像: <img src="http://api.lab.localhost:18080/medias/100001.svg">
      → cdn-waf(1 日ためる)→ ingress → api
 ⑩ 利用者が検索する・別の商品を押す(画面の中の移動)
      ブラウザの JS が直接 api を呼ぶ(表の入口)
        GET http://api.lab.localhost:18080/occ/v2/samplestore/products/search?query=ペン...
        Origin: http://www.lab.localhost:18080   ← ブラウザが自動で付ける
      → cdn-waf → ingress → api
      ← Access-Control-Allow-Origin: http://www.lab.localhost:18080(api が「見せてよい」と返す)
 ⑪ ログインして注文を見る
      POST /authorizationserver/oauth/token → トークンをもらう
      OPTIONS /occ/v2/samplestore/users/current/orders(下見 = プリフライト)
      GET     /occ/v2/samplestore/users/current/orders  Authorization: Bearer <トークン>
```

7. **JS を取る**: HTML の中の `<script src>` で、Angular の JS ファイルを www から取ります。ファイル名に中身のハッシュが入っているので、storefront は「1 年ためてよい」と返します。
8. **ハイドレーション**: たとえると「組み立て済みの家具が届き、最後にネジを締めて動くようにする」作業です。サーバーが作った画面をそのまま使い、クリックなどの動きだけを付けます。TransferState で JSON が申し送られているので、この時点では api を呼びません(開発者ツールの Network で確かめられます)。
9. **画像**: `<img>` の画像は、別オリジンでも CORS の確認なしに読み込めます(画像を「表示する」だけなら、ページの JS に中身を渡さないため)。
10. **画面の中の移動**: ここからは、ページを丸ごと読み直さず、ブラウザの JS が api を呼んで画面を書き換えます(CSR)。画面(`www.lab.localhost`)と api(`api.lab.localhost`)はホスト名が違う = **別オリジン** なので、ブラウザは api の返事に `Access-Control-Allow-Origin` が付いているときだけ、JS に中身を渡します(CORS)。→ [仕組み-6](./06-api-occ)
11. **ログイン後**: トークンをもらい、注文の API に `Authorization` ヘッダを付けて呼びます。`Authorization` を付けた別オリジンへの呼び出しは、ブラウザが先に `OPTIONS` で「この呼び方をしてよいか」を聞きます(プリフライト)。→ [仕組み-7](./07-oauth-token)

::: info 本格版(Kubernetes)では
流れの形は同じです。違いは、② の cdn-waf がクラスタの外の Docker コンテナ(`lab-cdn-waf`)として動き、kind のノードの 80 番 = ③ の ingress-nginx(Ingress リソース)に渡すこと、④⑤ が複数の Pod に分かれて Service が振り分けること、⑤ の検索が Solr になること、全体に OpenTelemetry のトレースが付くことです。→ [仕組み-3](./03-kubernetes-basics)・[仕組み-9](./09-search-solr)・[仕組み-11](./11-observability)
cdn-waf のコンテナ名は `<クラスタ名>-cdn-waf`(既定のクラスタ名 `lab` なら `lab-cdn-waf`)です。cdn-waf と kind のノード(Docker のコンテナ `lab-control-plane`)は同じ Docker のネットワーク `lab-kind`(172.30.91.0/24)にいて、cdn-waf は行き先 `INGRESS_UPSTREAM=lab-control-plane:80` に送ります。ノードの 80 番で ingress-nginx が待っています。
:::

## 3. 設定の読み方 {#s3}

流れを決めているのは、次の 4 か所です。

**(1) ブラウザの入口は cdn-waf の 1 か所だけ** — [docker-compose.yml](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/docker-compose.yml)

```yaml
  cdn-waf:
    ports:
      - "127.0.0.1:18080:8081"
      - "[::1]:18080:8081"
    environment:
      INGRESS_UPSTREAM: ingress:8080
```

- `127.0.0.1:18080:8081` … 「この PC の 127.0.0.1 の 18080 番」を「cdn-waf コンテナの 8081 番」につなぎます。ports を持つのは cdn-waf だけなので、ほかの部品にはブラウザから直接届きません。
- `INGRESS_UPSTREAM: ingress:8080` … cdn-waf が次に渡す相手です。振り分けは ingress の仕事なので、cdn-waf は全部 ingress に渡します。

**(2) ingress の行き先** — [ingress/default.conf.template](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/ingress/default.conf.template)

```nginx
  server_name www.lab.localhost;
  set $backend http://storefront:4000;
```

- `server_name` … この `server { }` の塊が受け持つホスト名です。
- `set $backend` … 行き先です。`storefront` はコンテナの名前で、Docker の中の DNS が IP に直します。

**(3) storefront から api への近道と、ブラウザ向けの表の入口** — [docker-compose.yml](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/docker-compose.yml)

```yaml
      API_INTERNAL_URL: http://api:3001
      API_PUBLIC_URL: http://api.lab.localhost:18080
```

- `API_INTERNAL_URL` … SSR 中(サーバーの中)に api を呼ぶ住所。コンテナ同士の内側の近道です。
- `API_PUBLIC_URL` … ブラウザが api を呼ぶ住所。HTML の `<meta name="api-public-url">` に入れて渡します。

**(4) api が CORS で「見せてよい」相手** — [docker-compose.yml](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/docker-compose.yml)

```yaml
      CORS_ALLOWED_ORIGINS: http://www.lab.localhost:18080
```

- ブラウザが付けてくる `Origin` がこれと一致したときだけ、api は `Access-Control-Allow-Origin` を返します。

## 4. 確かめるコマンド {#s4}

軽量版を `docker compose up -d --build` で起動してから試します。

```bash
# ① 1 回目の流れ: SSR の HTML に CMS の部品が入っている(JS なしで見える)
curl -s http://www.lab.localhost:18080/p/100001 | grep -o 'data-cms-type="[^"]*"' | sort -u
```

期待する出力(順番は違ってもかまいません):

```text
data-cms-type="CMSParagraphComponent"
data-cms-type="NavigationComponent"
data-cms-type="ProductCarouselComponent"
data-cms-type="ProductDetailsComponent"
data-cms-type="SearchBoxComponent"
```

```bash
# ② 誰が描いたか・キャッシュに当たったか(2 回続けて打つ)
curl -sI http://www.lab.localhost:18080/p/100001 | grep -iE 'x-render-mode|x-cache-status'
```

```text
X-Render-Mode: ssr
X-Cache-Status: MISS      ← 1 回目。2 回目(30 秒以内)は HIT
```

```bash
# ③ ブラウザ向けの「表の入口」の住所が HTML に入っている
curl -s http://www.lab.localhost:18080/ | grep -o '<meta name="api-public-url"[^>]*>'
# → <meta name="api-public-url" content="http://api.lab.localhost:18080">

# ④ 2 回目の流れ(ブラウザのまね): Origin を付けて api を呼ぶと、CORS の許可が返る
curl -sI -H 'Origin: http://www.lab.localhost:18080' \
  'http://api.lab.localhost:18080/occ/v2/samplestore/products/search?query=%E3%83%9A%E3%83%B3' | grep -i access-control-allow-origin   # %E3%83%9A%E3%83%B3 =「ペン」
# → Access-Control-Allow-Origin: http://www.lab.localhost:18080

# ⑤ 同じリクエストが各部品のログに残っているのを見る(新しい順に数行)
docker compose logs --tail=3 cdn-waf ingress storefront api
```

ブラウザでは、開発者ツールの **Network** を開いてから `http://www.lab.localhost:18080/p/100001` を開きます。

- 最初の表示: `100001`(HTML)と JS・CSS・画像だけ。`occ/v2` への fetch は **0 件**(TransferState のおかげ)。
- 画面上のメニューの「文房具」をクリック: `products/search?...` への fetch が出ます。その行の **Request Headers** に `Origin`、**Response Headers** に `Access-Control-Allow-Origin` が見えます。
  (検索ボックスは普通の HTML のフォームなので、検索するとページごと読み直され、SSR の HTML が届きます。そのため fetch は出ません。)

::: details 本格版(Kubernetes)で同じことを見る
URL とコマンドの形は同じです。ログは `kubectl -n lab logs` で見ます。
```bash
docker logs --tail=3 lab-cdn-waf                                        # cdn-waf(クラスタの外なので docker で見る)
kubectl -n ingress-nginx logs deploy/ingress-nginx-controller --tail=3  # ingress-nginx(アクセスログは 1 行 1 JSON。remote_addr・ingress・status。JSON でない行は ingress-nginx 自身のメッセージ)
kubectl -n lab logs deploy/storefront --tail=3
kubectl -n lab logs deploy/api --tail=3
```
Deployment の名前は `storefront`・`api`・`backoffice`・`worker` で、ラベル `app.kubernetes.io/name=<名前>` が付いています。`deploy/api` と書くと 2 つある Pod の片方だけのログです。全部の Pod をまとめて見るときは `kubectl -n lab logs -l app.kubernetes.io/name=api --tail=3` とします。
:::

## 5. CCv2 / Composable Storefront ではどこに当たるか {#s5}

| ラボ | CCv2 / Composable Storefront で当たるもの |
| --- | --- |
| cdn-waf | お客さんが別に用意する CDN・WAF(例: CloudFront + AWS WAF) |
| ingress のホスト名ごとの振り分け | Cloud Portal の「エンドポイント」(URL → どの aspect に渡すか) |
| storefront | JS Storefront(Composable Storefront を SSR で動かすもの) |
| `API_INTERNAL_URL` / `API_PUBLIC_URL` | Composable Storefront の設定の「OCC の baseUrl」。SSR とブラウザで同じ api のホスト名を使う構成が多い |
| api の `/occ/v2/samplestore/...` | OCC の REST API(api aspect) |
| db | CCv2 が用意するデータベース |
| `CORS_ALLOWED_ORIGINS` | api の corsfilter の設定(許可するオリジンの一覧) |

## 6. よくある誤解 {#s6}

- **「画面を表示するたびに、ブラウザが api を呼んでいる」** → 最初の表示では、storefront(サーバー)が内側の近道で呼んでいます。ブラウザが api を呼ぶのは、画面の中を移動したときや、ログインした人だけの画面です。
- **「SSR 中の api 呼び出しも cdn-waf と ingress を通る」** → 通りません(`http://api:3001` に直接)。だから SSR 中の呼び出しには cdn-waf のキャッシュも WAF も効きません。
- **「CORS はサーバーを守る仕組み」** → CORS は **ブラウザ** が守る仕組みです。curl からは Origin を付けなくても api を呼べます。api を守るのは認証・認可・WAF です。
- **「www と api は同じ PC の同じポート(18080)だから同じオリジン」** → オリジンは「スキーム + ホスト名 + ポート」の 3 つの組です。ホスト名が違うので別オリジンです。
- **「HTML がキャッシュされたら、ログインした人の情報も混ざる」** → cdn-waf は `Authorization` や `Cookie` の付いたリクエストはためません。さらにラボのトークンはブラウザだけが持ち、HTML には入りません。

## 7. 関係する演習と設計書 {#s7}

- 演習: [FE-1 SSR と CSR を見比べる](/exercises/01-fe-ssr-vs-csr)・[ネットワーク-1 前段のキャッシュ](/exercises/07-nw-cache)・[ネットワーク-2 CORS と IP 制限](/exercises/08-nw-cors-and-ip)・[ネットワーク-3 Ingress とエンドポイント](/exercises/20-nw-ingress-endpoints)・[ヘッドレス-1 CMS の JSON が画面になるまで](/exercises/21-headless-cms)
- 設計書: [全体方式 4.1 利用者の通り道は cdn-waf の 1 か所だけ](/design/architecture/00-overall#s4-1)・[4.6 CCv2 + ヘッドレスの形に寄せる](/design/architecture/00-overall#s4-6)・[ネットワーク方式 4.1 振り分け](/design/architecture/04-network#s4-1)・[FE 方式 4.1 描画方式](/design/architecture/01-frontend#s4-1)・[4.7 api の住所を SSR とブラウザで分ける](/design/architecture/01-frontend#s4-7)・[D-NW-01 edge の経路とキャッシュ](/design/detail/D-NW-01-edge-route)
- 次に読む: [仕組み-1 cdn-waf](./01-cdn-waf)
