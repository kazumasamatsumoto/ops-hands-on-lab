---
title: ネットワーク-1 前段のキャッシュ
---

# ネットワーク-1 前段のキャッシュ

::: info この演習について
- 所要時間: 約 20 分
- 使うもの: 軽量版(docker compose)。`curl`、`tools/chaos.sh`
- 関係する設計書: [ネットワーク方式](/design/architecture/04-network)・[D-NW-01 edge の経路とキャッシュ](/design/detail/D-NW-01-edge-route)・[性能方式](/design/architecture/07-performance)
:::

## 1. この設計書はなぜ必要か

お客様の前にある入口(CDN やロードバランサ)で「同じ答えを使い回す」と、奥のサーバーの仕事が何十分の一にもなります。
ただし、**何をためてよいか・何秒ためるか** を間違えると、別の事故になります。

> **よくある事故 1(ためなさすぎ)**: テレビで商品が紹介された瞬間、商品詳細の画面に 1 分で数万人が来ました。
> 毎回サーバーで画面を作っていたため、サーバーも DB も息切れして、お店全体が落ちました。同じ商品の同じ画面なのに、毎回作り直していたのです。
>
> **よくある事故 2(ためすぎ)**: 表示を速くしようと、全部の画面を入口でためる設定にしました。
> すると、ログインした人の「マイページ」まで入口にたまり、次に来た別のお客様に、前の人の名前と住所が表示されました。

だからネットワークの方式設計書で、「どの URL を・何秒・どんな条件のときだけ」ためるかを決めます。

## 2. 何をやっているのか

サンプルストアの入口 edge(nginx)は、**商品一覧・商品詳細の HTML と `GET /api/products*` を 30 秒だけためます**。
応答ヘッダの `X-Cache-Status` で、ためた物を返したか(`HIT`)、奥に取りに行ったか(`MISS`)、ためる対象外として素通りさせたか(`BYPASS`)、期限切れで取り直したか(`EXPIRED`)が見えます。
`Authorization` か `Cookie` が付いたリクエスト(= ログインしているかもしれない人)は、ためません。キャッシュ全体の ON/OFF は `EDGE_CACHE` の 1 か所で切り替えられます。

たとえ: **人気の定食をあらかじめ何人分か作っておく食堂** です。注文のたびに一から作るより、ずっと早く出せます。
ただし作り置きは 30 秒で捨てます(古い物を出さないため)。そして **「名前入りのお弁当」(ログインした人専用の画面)は絶対に作り置きしません**。

## 3. まず触ってみる

1. **同じ画面を 5 回取る**。1 回目と 2 回目以降で `X-Cache-Status` と速さを比べます。

   ```bash
   for i in 1 2 3 4 5; do
     curl -s -o /dev/null -w "%{http_code} cache=%header{x-cache-status} ttfb=%{time_starttransfer}s\n" http://localhost:18080/products/5
   done
   ```

2. **30 秒待ってから、もう一度取る**。ためた物は 30 秒で古くなります。

   ```bash
   sleep 31; curl -s -o /dev/null -w "cache=%header{x-cache-status}\n" http://localhost:18080/products/5
   ```

3. **奥の web に何回届いたかを数える**。10 回取っても、web のログに出るのは 1 回だけのはずです。

   ```bash
   for i in $(seq 1 10); do curl -s -o /dev/null http://localhost:18080/products/8; done
   docker compose logs web --no-log-prefix --since 10s | grep -c '"url":"/products/8"'
   ```

4. **ログインしているかもしれない人はためない**。`Authorization` や `Cookie` を付けると `BYPASS` になります。ためない画面(ログイン画面)には、そもそも `X-Cache-Status` が付きません。

   ```bash
   curl -s -o /dev/null -w "%{http_code} cache=%header{x-cache-status}\n" -H 'Authorization: Bearer x' http://localhost:18080/api/products
   curl -s -o /dev/null -w "%{http_code} cache=%header{x-cache-status}\n" -H 'Cookie: a=b' http://localhost:18080/products/5
   curl -sI http://localhost:18080/login | grep -ci x-cache-status
   ```

5. **API が遅いときにキャッシュが効く様子を見る**。api に 0.3 秒の遅延を入れ、キャッシュ OFF と ON で比べます。

   ```bash
   tools/chaos.sh set latencyMs=300

   # キャッシュ OFF
   EDGE_CACHE=off docker compose up -d edge
   docker compose ps edge       # (healthy) を待つ
   for i in $(seq 1 10); do curl -s -o /dev/null -w "%{time_starttransfer} %header{x-cache-status}\n" http://localhost:18080/products/7; done

   # キャッシュ ON(既定に戻す)
   docker compose up -d edge
   docker compose ps edge       # (healthy) を待つ
   for i in $(seq 1 10); do curl -s -o /dev/null -w "%{time_starttransfer} %header{x-cache-status}\n" http://localhost:18080/products/7; done
   ```

6. **設定を読む**。`edge/default.conf.template` の「キャッシュ」の部分と、`proxy_cache_bypass` / `proxy_no_cache` の行を読みます。
   「ためる場所」「何秒」「ためない条件」がそれぞれ 1〜2 行で書いてあります。

## 4. 何が見えたら成功か

**手順 1**: 1 回目だけ `MISS`(奥で作った)で 0.064 秒、2 回目からは `HIT`(作り置き)で 0.005 秒前後。

```text
200 cache=MISS ttfb=0.064202s
200 cache=HIT ttfb=0.004749s
200 cache=HIT ttfb=0.004805s
200 cache=HIT ttfb=0.005237s
200 cache=HIT ttfb=0.004875s
```

**手順 2**: 30 秒を過ぎると `EXPIRED`(期限切れなので取り直した)。

```text
cache=EXPIRED
```

**手順 3**: 10 回のうち、web まで届いたのは 1 回。残り 9 回は edge だけで返しています。キャッシュ OFF で同じことをすると 10 回とも web に届きます。

```text
1      ← キャッシュ ON
10     ← キャッシュ OFF(EDGE_CACHE=off のとき)
```

**手順 4**: ログインの印になりうる物が付くと `BYPASS`、ログイン画面にはヘッダ自体が無い(0 行)。

```text
200 cache=BYPASS
200 cache=BYPASS
0
```

**手順 5**: api が 0.3 秒遅いとき、キャッシュ OFF では毎回 0.3 秒以上。ON では最初の 1 回だけ遅く、あとは 0.005〜0.03 秒。

```text
キャッシュ OFF: 10 回の平均 TTFB = 0.330 秒(毎回 BYPASS)

キャッシュ ON:
0.339064 MISS
0.016138 HIT
0.017960 HIT
...
0.004667 HIT      → 10 回の平均 0.045 秒
```

「お客様が増えても、奥に届くのは 30 秒に 1 回」になるのが、キャッシュの本当の効き目です。速さより、奥のサーバーを守る効果の方が大きいのです。

## 5. ここで覚える言葉

| 言葉 | 一言でいうと | たとえ | この演習で見たもの |
| --- | --- | --- | --- |
| キャッシュ | 一度作った答えをためて使い回す | 人気の定食の作り置き | `X-Cache-Status: HIT` |
| CDN | お客様の近くに置く、キャッシュ専門の入口の網 | 駅前の支店に作り置きを並べる | ラボでは edge(nginx)がその代わり |
| HIT / MISS | ためた物を返した / 奥に取りに行った | 作り置きを出した / 一から作った | 1 回目 MISS、2 回目から HIT |
| TTL(有効期限) | 何秒ためておくか | 作り置きは 30 秒で捨てる | 31 秒後の `EXPIRED` |
| BYPASS | ためる対象外として素通り | 名前入りのお弁当は作り置きしない | `Authorization` / `Cookie` 付きで BYPASS |
| キャッシュキー | 「同じ答え」とみなす条件 | 「同じ注文」とみなす決まり | 設定の `proxy_cache_key "$request_method$host$request_uri"` |
| オリジン | 本物の答えを作る奥のサーバー | 厨房 | web(10 回中 1 回だけ届いた) |

## 6. 設計書ではここに書く

- **[ネットワーク方式 4.2 キャッシュ](/design/architecture/04-network#s4-2)**:
  「前段(CDN)でためるのは、ログインに関係ない画面と API だけ。ためる時間は 30 秒」「価格や在庫を変えたときに、すぐ消す手段(パージ)を用意する」。
- **[ネットワーク方式 4.3 ためてはいけない物](/design/architecture/04-network#s4-3)**: 「`Authorization` / `Cookie` 付きはためない」「SSR をあきらめた空の HTML は `Cache-Control: no-store` でためさせない」。
- **[D-NW-01 edge の経路とキャッシュ 4.2 キャッシュの設定値](/design/detail/D-NW-01-edge-route#s4-2)・[4.3 X-Cache-Status の読み方](/design/detail/D-NW-01-edge-route#s4-3)**(一般のカタログでは D-NW-01): URL ごとの表を作ります。**URL の形・ためるか・何秒・キャッシュキー・ためない条件・どのヘッダで確かめるか**。
- **[性能方式 4.2 入口でためて減らす](/design/architecture/07-performance#s4-2)**: 「負荷の見積もりは、キャッシュが効いた後の、奥に届く件数で行う(HIT 率 ○% を前提)」と書き、前提の HIT 率も書きます。

## 7. レビューで聞く質問

- 「前段でためる URL はどれですか。その中に、ログインした人ごとに中身が変わる画面や API は入っていませんか。」
- 「何秒ためますか。価格や在庫が変わったとき、お客様に古い値が何秒見えてよいという合意ですか。」
- 「急いで消したい(パージ)とき、誰がどうやって消しますか。」
- 「キャッシュキー(同じ答えとみなす条件)に、言語・通貨・会員区分など、中身を変える物は入っていますか。」
- 「キャッシュが効いているかは、どの指標(HIT 率)やヘッダで確かめますか。」
- 「キャッシュを止めたとき(全部 MISS になったとき)、奥のサーバーは耐えられますか。」

## 8. 片付け

```bash
tools/chaos.sh reset                                  # latencyMs を 0 に戻す
docker compose up -d edge                             # EDGE_CACHE を付けずに起動 = on
docker compose exec -T edge printenv EDGE_CACHE       # on ならよい
```
