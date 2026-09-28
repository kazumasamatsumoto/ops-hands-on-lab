---
title: ネットワーク-1 前段のキャッシュ
---

# ネットワーク-1 前段のキャッシュ

::: info この演習について
- 所要時間: 約 20 分
- 使うもの: 軽量版(docker compose)。`curl`、ブラウザ(backoffice を開く)、`tools/chaos.sh`
- 仕組みはこちら: [仕組み-1 cdn-waf(CDN と WAF)](/how-it-works/01-cdn-waf)・[仕組み-5 ヘッドレスと CMS 駆動の描画](/how-it-works/05-headless-cms)
- 関係する設計書: [ネットワーク方式](/design/architecture/04-network)・[D-NW-01 cdn-waf と ingress の経路とキャッシュ](/design/detail/D-NW-01-edge-route)・[性能方式](/design/architecture/07-performance)
- 用語集: [キャッシュ](/guide/glossary#cache)・[CDN](/guide/glossary#cdn)・[TTL](/guide/glossary#ttl)・[X-Cache-Status](/guide/glossary#x-cache-status)
:::

## 1. この設計書はなぜ必要か

お客様の前にある入口(CDN)で「同じ答えを使い回す」と、奥のサーバーの仕事が何十分の一にもなります。
ただし、**何をためてよいか・何秒ためるか** を間違えると、別の事故になります。

> **よくある事故 1(ためなさすぎ)**: テレビで商品が紹介された瞬間、商品詳細の画面に 1 分で数万人が来ました。
> 毎回サーバーで画面を作っていたため、サーバーも DB も息切れして、お店全体が落ちました。同じ商品の同じ画面なのに、毎回作り直していたのです。
>
> **よくある事故 2(ためすぎ)**: 表示を速くしようと、全部の画面を入口でためる設定にしました。
> すると、ログインした人の「マイページ」まで入口にたまり、次に来た別のお客様に、前の人の名前と住所が表示されました。

だからネットワークの方式設計書で、「どの URL を・何秒・どんな条件のときだけ」ためるかを決めます。

## 2. 何をやっているのか

サンプルストアの入口 cdn-waf(nginx)は、**トップ・商品詳細・検索結果の HTML と、api の商品・CMS の GET を 30 秒だけためます**。商品画像(`/medias/`)は 1 日ためます。
応答ヘッダの `X-Cache-Status` で、ためた物を返したか(`HIT`)、奥に取りに行ったか(`MISS`)、ためる対象外として素通りさせたか(`BYPASS`)、期限切れで取り直したか(`EXPIRED`)が見えます。
`Authorization` か `Cookie` が付いたリクエスト(= ログインしているかもしれない人)は、ためません。キャッシュ全体の ON/OFF は `EDGE_CACHE` の 1 か所で切り替えられます。

たとえ: **人気の定食をあらかじめ何人分か作っておく食堂** です。注文のたびに一から作るより、ずっと早く出せます。
ただし作り置きは 30 秒で捨てます(古い物を出さないため)。そして **「名前入りのお弁当」(ログインした人専用の画面)は絶対に作り置きしません**。

::: tip CCv2 では
cdn-waf は、CCv2 の案件で別に契約する CDN(例: CloudFront)に当たります。「商品や CMS の GET を CDN でためる」「価格を変えたらすぐ消す(パージ)」といった設定を、CDN 側でします。
このラボの「backoffice で変えた値が、キャッシュが切れるまで画面に出ない」動きは、CCv2 でも同じ(SmartEdit で直しても CDN のキャッシュが切れるまで反映が遅れる)です。
:::

## 3. まず触ってみる

1. **同じ画面を 5 回取る**。1 回目と 2 回目以降で `X-Cache-Status` と速さを比べます。

   ::: code-group

   ```bash [Mac / Linux / WSL]
   for i in 1 2 3 4 5; do
     curl -s -o /dev/null -w "%{http_code} cache=%header{x-cache-status} ttfb=%{time_starttransfer}s\n" http://www.lab.localhost:18080/p/100005
   done
   ```

   ```powershell [PowerShell]
   foreach ($i in 1..5) {
     curl.exe -s -o NUL -w '%{http_code} cache=%header{x-cache-status} ttfb=%{time_starttransfer}s\n' http://www.lab.localhost:18080/p/100005
   }
   ```

   :::

2. **奥の storefront に何回届いたかを数える**。10 回取っても、ログに出るのは 1 回だけのはずです。

   ::: code-group

   ```bash [Mac / Linux / WSL]
   for i in $(seq 1 10); do curl -s -o /dev/null http://www.lab.localhost:18080/p/100008; done; sleep 1
   docker compose logs storefront --no-log-prefix --since 15s | grep -c '"url":"/p/100008"'
   ```

   ```powershell [PowerShell]
   foreach ($i in 1..10) { curl.exe -s -o NUL http://www.lab.localhost:18080/p/100008 }; Start-Sleep 1
   @(docker compose logs storefront --no-log-prefix --since 15s | Select-String '"url":"/p/100008"').Count
   ```

   :::

3. **ログインしているかもしれない人はためない**。`Authorization` や `Cookie` を付けると `BYPASS` になります。ためない画面(注文履歴)には、そもそも `X-Cache-Status` が付きません。

   ::: code-group

   ```bash [Mac / Linux / WSL]
   curl -s -o /dev/null -w "%{http_code} cache=%header{x-cache-status}\n" -H 'Authorization: Bearer x' http://api.lab.localhost:18080/occ/v2/samplestore/products/100005
   curl -s -o /dev/null -w "%{http_code} cache=%header{x-cache-status}\n" -H 'Cookie: a=b' http://www.lab.localhost:18080/p/100005
   curl -sI http://www.lab.localhost:18080/my-account/orders | grep -ci x-cache-status
   ```

   ```powershell [PowerShell]
   curl.exe -s -o NUL -w '%{http_code} cache=%header{x-cache-status}\n' -H 'Authorization: Bearer x' http://api.lab.localhost:18080/occ/v2/samplestore/products/100005
   curl.exe -s -o NUL -w '%{http_code} cache=%header{x-cache-status}\n' -H 'Cookie: a=b' http://www.lab.localhost:18080/p/100005
   @(curl.exe -sI http://www.lab.localhost:18080/my-account/orders | Select-String 'x-cache-status').Count
   ```

   :::

4. **商品画像は 1 日ためる**。api が `Cache-Control: public, max-age=86400` を返すので、nginx はそれに従います。

   ::: code-group

   ```bash [Mac / Linux / WSL]
   curl -s -o /dev/null -w "1回目 cache=%header{x-cache-status} cc=%header{cache-control}\n" http://api.lab.localhost:18080/medias/100005.svg
   curl -s -o /dev/null -w "2回目 cache=%header{x-cache-status}\n" http://api.lab.localhost:18080/medias/100005.svg
   ```

   ```powershell [PowerShell]
   curl.exe -s -o NUL -w '1回目 cache=%header{x-cache-status} cc=%header{cache-control}\n' http://api.lab.localhost:18080/medias/100005.svg
   curl.exe -s -o NUL -w '2回目 cache=%header{x-cache-status}\n' http://api.lab.localhost:18080/medias/100005.svg
   ```

   :::

   画像は 1 日ためるので、この 1 日のうちにお店のトップをブラウザで開いた(または [QA-1](./11-qa-e2e-regression) の E2E を流した)あとだと、トップに並ぶ画像はもう作り置きされていて、1 回目から `HIT` になります。そのときは `docker compose down -v` の後で試すか、トップに出ない画像(例: `100029.svg`)で試します。

5. **backoffice で変えた値が、キャッシュが切れるまで出ない様子を見る**。ブラウザで http://backoffice.lab.localhost:18080/backoffice/ を開き、`admin` / `admin` でログインし、「トップページのバナー」の見出しを変えて保存します。
   すぐに次を打つと、30 秒ほどは古い見出し、そのあと新しい見出しになります。

   ::: code-group

   ```bash [Mac / Linux / WSL]
   for i in $(seq 1 9); do
     printf '%s ' "$(date +%T)"
     curl -s -D - http://www.lab.localhost:18080/ -o /tmp/top.html | grep -i x-cache-status | tr -d '\r\n'
     printf ' '; grep -o '<h1[^>]*>[^<]*</h1>' /tmp/top.html | head -1
     sleep 5
   done   # Ctrl+C で止める
   ```

   ```powershell [PowerShell]
   foreach ($i in 1..9) {
     $t = Get-Date -Format HH:mm:ss
     $cache = (curl.exe -s -D - http://www.lab.localhost:18080/ -o "$env:TEMP/top.html" | Select-String 'x-cache-status').Line -replace '[\r\n]', ''
     $h1 = (Select-String -Path "$env:TEMP/top.html" -Pattern '<h1[^>]*>[^<]*</h1>' | Select-Object -First 1).Matches.Value
     "$t $cache $h1"
     Start-Sleep 5
   }   # Ctrl+C で止める
   ```

   :::

6. **api が遅いときにキャッシュが効く様子を見る**。api に 0.3 秒の遅延を入れ、キャッシュ OFF と ON で比べます。

   ::: code-group

   ```bash [Mac / Linux / WSL]
   tools/chaos.sh set latencyMs=300

   EDGE_CACHE=off docker compose up -d cdn-waf; docker compose ps cdn-waf     # (healthy) を待つ
   for i in $(seq 1 10); do curl -s -o /dev/null -w "%{time_starttransfer} %header{x-cache-status}\n" http://www.lab.localhost:18080/p/100007; done

   docker compose up -d cdn-waf; docker compose ps cdn-waf                    # 既定(on)に戻す
   for i in $(seq 1 10); do curl -s -o /dev/null -w "%{time_starttransfer} %header{x-cache-status}\n" http://www.lab.localhost:18080/p/100007; done
   ```

   ```powershell [PowerShell]
   tools/chaos.ps1 set latencyMs=300

   $env:EDGE_CACHE = 'off'; docker compose up -d cdn-waf; docker compose ps cdn-waf     # (healthy) を待つ
   foreach ($i in 1..10) { curl.exe -s -o NUL -w '%{time_starttransfer} %header{x-cache-status}\n' http://www.lab.localhost:18080/p/100007 }

   Remove-Item Env:EDGE_CACHE; docker compose up -d cdn-waf; docker compose ps cdn-waf   # 既定(on)に戻す
   foreach ($i in 1..10) { curl.exe -s -o NUL -w '%{time_starttransfer} %header{x-cache-status}\n' http://www.lab.localhost:18080/p/100007 }
   ```

   :::

   ::: tip PowerShell
   `$env:EDGE_CACHE = 'off'` は同じウィンドウで打つ以後のコマンド全部に効き続けます。「既定に戻す」ときは、上のように `Remove-Item Env:EDGE_CACHE` で消してから `docker compose up -d cdn-waf` します。
   :::

## 4. 何が見えたら成功か

**手順 1**: 1 回目だけ `MISS`(奥で作った)で 0.06 秒、2 回目からは `HIT`(作り置き)で 0.005 秒前後。

```text
200 cache=MISS ttfb=0.067430s
200 cache=HIT ttfb=0.004696s
200 cache=HIT ttfb=0.006682s
200 cache=HIT ttfb=0.004208s
200 cache=HIT ttfb=0.005234s
```

**手順 2**: 10 回のうち、storefront まで届いたのは 1 回。残り 9 回は cdn-waf だけで返しています。キャッシュ OFF で同じことをすると 10 回とも届きます。

```text
1      ← キャッシュ ON
```

**手順 3**: ログインの印になりうる物が付くと `BYPASS`、注文履歴にはヘッダ自体が無い(0 行)。

```text
200 cache=BYPASS
200 cache=BYPASS
0
```

**手順 4**: 商品画像は 1 回目 `MISS` で `Cache-Control: public, max-age=86400`、2 回目は `HIT`。

```text
1回目 cache=MISS cc=public, max-age=86400
2回目 cache=HIT
```

**手順 5**: 保存した瞬間はまだ古い見出しで、30 秒後の `EXPIRED` のところで新しい見出しに変わります。

```text
10:29:59 X-Cache-Status: HIT <h1>秋の文房具フェア</h1>
10:30:24 X-Cache-Status: HIT <h1>秋の文房具フェア</h1>
10:30:29 X-Cache-Status: EXPIRED <h1>冬のノート祭り</h1>
10:30:34 X-Cache-Status: HIT <h1>冬のノート祭り</h1>
```

キャッシュを切った状態(`EDGE_CACHE=off docker compose up -d cdn-waf`。PowerShell では `$env:EDGE_CACHE = 'off'; docker compose up -d cdn-waf`)で同じことをすると、保存の直後に変わります。これが d1 環境でキャッシュを切っている理由です。

**手順 6**: api が 0.3 秒遅いとき、キャッシュ OFF では毎回 0.66 秒(全部 BYPASS)。ON では最初の 1 回だけ遅く、あとは 0.008〜0.01 秒。

```text
キャッシュ OFF: 10 回の平均 TTFB = 0.658 秒(毎回 BYPASS)

キャッシュ ON:
0.665081 MISS
0.009720 HIT
0.008108 HIT
...
0.008523 HIT      → 10 回の平均 0.140 秒
```

「お客様が増えても、奥に届くのは 30 秒に 1 回」になるのが、キャッシュの本当の効き目です。速さより、奥のサーバーを守る効果の方が大きいのです。

## 5. ここで覚える言葉

| 言葉 | 一言でいうと | たとえ | この演習で見たもの |
| --- | --- | --- | --- |
| [キャッシュ](/guide/glossary#cache) | 一度作った答えをためて使い回す | 人気の定食の作り置き | `X-Cache-Status: HIT` |
| [CDN](/guide/glossary#cdn) | お客様の近くに置く、キャッシュ専門の入口の網 | 駅前の支店に作り置きを並べる | ラボでは cdn-waf がその代わり |
| HIT / MISS | ためた物を返した / 奥に取りに行った | 作り置きを出した / 一から作った | 1 回目 MISS、2 回目から HIT |
| [TTL](/guide/glossary#ttl)(有効期限) | 何秒ためておくか | 作り置きは 30 秒で捨てる | 30 秒後の `EXPIRED` |
| BYPASS | ためる対象外として素通り | 名前入りのお弁当は作り置きしない | `Authorization` / `Cookie` 付きで BYPASS |
| [X-Cache-Status](/guide/glossary#x-cache-status) | 今の返事がキャッシュから来たかを表すヘッダ | 「作り置き」か「作りたて」かの札 | HIT / MISS / BYPASS / EXPIRED |
| オリジン | 本物の答えを作る奥のサーバー | 厨房 | storefront(10 回中 1 回だけ届いた) |

## 6. 設計書ではここに書く

- **[ネットワーク方式 4.2 キャッシュ](/design/architecture/04-network#s4-2)**:
  「前段(CDN)でためるのは、ログインに関係ない画面と GET だけ。ためる時間は 30 秒(画像は 1 日)」「価格や在庫を変えたときに、すぐ消す手段(パージ)を用意する」。
- **[ネットワーク方式 4.3 ためてはいけない物](/design/architecture/04-network#s4-3)**: 「`Authorization` / `Cookie` 付きはためない」「SSR をあきらめた空の HTML と、注文・トークンの返事は `Cache-Control: no-store` でためさせない」。
- **[D-NW-01 4.2 キャッシュの設定値](/design/detail/D-NW-01-edge-route#s4-2)・[4.3 X-Cache-Status の読み方](/design/detail/D-NW-01-edge-route#s4-3)**: URL ごとの表を作ります。**URL の形・ためるか・何秒・キャッシュキー・ためない条件・どのヘッダで確かめるか**。
- **[性能方式 4.2 入口でためて減らす](/design/architecture/07-performance#s4-2)**: 「負荷の見積もりは、キャッシュが効いた後の、奥に届く件数で行う(HIT 率 ○% を前提)」と書き、前提の HIT 率も書きます。

## 7. レビューで聞く質問

- 「前段でためる URL はどれですか。その中に、ログインした人ごとに中身が変わる画面や API は入っていませんか。」
- 「何秒ためますか。価格や在庫が変わったとき、お客様に古い値が何秒見えてよいという合意ですか。」
- 「急いで消したい(パージ)とき、誰がどうやって消しますか。」
- 「キャッシュキー(同じ答えとみなす条件)に、通貨・会員区分・オリジンなど、中身を変える物は入っていますか。」
- 「キャッシュが効いているかは、どの指標(HIT 率)やヘッダで確かめますか。」
- 「キャッシュを止めたとき(全部 MISS になったとき)、奥のサーバーは耐えられますか。」

## 8. 片付け

::: code-group

```bash [Mac / Linux / WSL]
tools/chaos.sh reset                                  # latencyMs を 0 に戻す
docker compose up -d cdn-waf                           # EDGE_CACHE を付けずに起動 = on
docker compose exec -T cdn-waf printenv EDGE_CACHE     # on ならよい
rm -f /tmp/top.html
```

```powershell [PowerShell]
tools/chaos.ps1 reset                                                              # latencyMs を 0 に戻す
Remove-Item Env:EDGE_CACHE -ErrorAction SilentlyContinue; docker compose up -d cdn-waf   # EDGE_CACHE を消してから起動 = on
docker compose exec -T cdn-waf printenv EDGE_CACHE                                 # on ならよい
Remove-Item "$env:TEMP/top.html"
```

:::

手順 5 で backoffice のバナーを変えた場合は、[ヘッドレス-1](./21-headless-cms) の片付けと同じ要領で元の見出し(「秋の文房具フェア」)に戻すか、`docker compose down -v` でまっさらにできます。
