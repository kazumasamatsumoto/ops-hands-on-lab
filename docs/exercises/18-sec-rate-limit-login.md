---
title: セキュリティ-2 ログインの連打を止める
---

# セキュリティ-2 ログインの連打を止める

::: info この演習について
- 所要時間: 約 10 分
- 使うもの: 軽量版(docker compose)。`curl`(PowerShell は `curl.exe`)
- 仕組みはこちら: [仕組み-2 ingress(エンドポイントと IP フィルタ)](/how-it-works/02-ingress-and-endpoints)・[仕組み-7 OAuth のトークン](/how-it-works/07-oauth-token)
- 関係する設計書: [セキュリティ方式](/design/architecture/10-security)・[D-SEC-01 WAF とレート制限](/design/detail/D-SEC-01-waf-and-rate-limit)
- 用語集: [レート制限](/guide/glossary#rate-limit)・[バースト](/guide/glossary#burst)・[429](/guide/glossary#http-429)
:::

::: warning この演習は、この手元のラボにだけ
ここで送るのは、**このラボのログイン口(api.lab.localhost)に、わざと間違ったパスワードを数回** 送るだけです。
実在のサイトや他人のサーバーに、大量のパスワードを試す(総当たり)ことはしないでください。許可なく行うと法律に触れます。この演習では、パスワードの一覧も使いません。
:::

## 1. この設計書はなぜ必要か

ログイン口は、インターネットのどこからでも何度でも試せます。何も制限がないと、機械で 1 秒に何百回もパスワードを試されます。

> **よくある事故**: 会員が「password」「123456」のような弱いパスワードを使っていました。ログインの回数に制限がなかったため、機械で次々に試され、数時間で何百人分ものアカウントが乗っ取られました。登録されていたポイントが勝手に使われ、お客様への返金とお詫びの対応が続きました。

「同じ人(同じ IP)からのログインは、1 秒に何回まで」と入口で決めておけば、機械で大量に試すことができなくなります。どこで・何回まで・超えたら何を返すかを、セキュリティの方式設計書に書きます。

## 2. 何をやっているのか

第 2 版のログインは、OAuth のトークンをもらう口 `POST /authorizationserver/oauth/token` です。
入口の ingress(nginx)が、この口への送信を **IP ごとに 1 秒 1 回** に制限しています。人がうっかり続けて押す程度は許すため、**5 回までの「ため」(バースト)** があります。
これを超えると、アプリ(api)に届く前に ingress が **429 Too Many Requests** を返します。

api はわざと「何度失敗してもロックしない」作りにしています(アカウントを止める方式だと、他人が本人のアカウントをわざと止めて困らせられるため)。だから **ここ(入口の回数制限)が唯一の歯止め** です。
制限はログインにだけ厳しくかけていて、商品を見るなど普通の操作は別の、ゆるい制限(cdn-waf の IP ごとに 1 秒 20 回)です。ログインを止められている人でも、買い物の画面は見られます。

たとえ: **銀行の ATM の暗証番号** です。何度も間違えると、しばらく操作できなくなります。ただし ATM と違って、ここでは「アカウントそのものを止める」のではなく「その場所(IP)からの試行を少し待たせる」やり方です。

::: tip CCv2 では
ログインの回数制限は、CCv2 の案件では CDN・WAF やエンドポイントのレート制限で設けます(Cloud Portal のエンドポイントのレート制限は、そのエンドポイントへの IP ごとの回数をまとめて数えるもので、ログインの URL だけに絞るものではありません。前に CDN を置くときは使わないよう SAP が注意しています)。「アプリではロックせず、入口で回数を絞る」という置き場所の考え方は共通です。
どこで制限をかけているか(入口か、アプリか)を設計書に書いておくと、障害時に「どこが 429 を返しているか」を追いやすくなります。
:::

## 3. まず触ってみる

1. まず正しいパスワードでトークンをもらえることを確かめます(`alice` / `password`)。

   ::: code-group

   ```bash [Mac / Linux / WSL]
   A=http://api.lab.localhost:18080/authorizationserver/oauth/token
   curl -s -o /dev/null -w '%{http_code}\n' $A -d 'grant_type=password&client_id=storefront&username=alice&password=password'
   ```

   ```powershell [PowerShell]
   $A = 'http://api.lab.localhost:18080/authorizationserver/oauth/token'
   curl.exe -s -o NUL -w '%{http_code}\n' $A -d 'grant_type=password&client_id=storefront&username=alice&password=password'
   ```

   :::

2. 6 秒待ってから(手順 1 で使った 1 回分の「ため」が戻るのを待ちます)、**間違ったパスワード** を 10 回続けて送ります(この手元のラボにだけ)。

   ::: code-group

   ```bash [Mac / Linux / WSL]
   sleep 6
   for i in $(seq 1 10); do
     printf '%2d回目: ' $i
     curl -s -o /dev/null -w '%{http_code}\n' $A -d 'grant_type=password&client_id=storefront&username=alice&password=wrong'
   done
   ```

   ```powershell [PowerShell]
   Start-Sleep 6
   foreach ($i in 1..10) {
     Write-Host -NoNewline ("{0,2}回目: " -f $i)
     curl.exe -s -o NUL -w '%{http_code}\n' $A -d 'grant_type=password&client_id=storefront&username=alice&password=wrong'
   }
   ```

   :::

3. 止められているあいだに、商品の一覧が見られるかを確かめます。

   ::: code-group

   ```bash [Mac / Linux / WSL]
   curl -s -o /dev/null -w '%{http_code}\n' http://api.lab.localhost:18080/occ/v2/samplestore/products/100001
   ```

   ```powershell [PowerShell]
   curl.exe -s -o NUL -w '%{http_code}\n' http://api.lab.localhost:18080/occ/v2/samplestore/products/100001
   ```

   :::

4. 6 秒待ってから、正しいパスワードでもう一度もらいます。

   ::: code-group

   ```bash [Mac / Linux / WSL]
   sleep 6
   curl -s -o /dev/null -w '%{http_code}\n' $A -d 'grant_type=password&client_id=storefront&username=alice&password=password'
   ```

   ```powershell [PowerShell]
   Start-Sleep 6
   curl.exe -s -o NUL -w '%{http_code}\n' $A -d 'grant_type=password&client_id=storefront&username=alice&password=password'
   ```

   :::

5. ingress のログで、止めた記録を見ます。

   ::: code-group

   ```bash [Mac / Linux / WSL]
   docker compose logs ingress --no-log-prefix | grep 'limiting requests' | tail -2 | cut -c1-160
   ```

   ```powershell [PowerShell]
   docker compose logs ingress --no-log-prefix | Select-String 'limiting requests' | Select-Object -Last 2 `
     | ForEach-Object { $_.Line.Substring(0, [Math]::Min(160, $_.Line.Length)) }
   ```

   :::

## 4. 何が見えたら成功か

**手順 1**: 正しいパスワードは `200` です。

**手順 2**: **6 回目までは `400`(パスワードが違う)、7 回目から `429`(回数が多すぎる)** になれば成功です。

```text
 1回目: 400
 2回目: 400
 3回目: 400
 4回目: 400
 5回目: 400
 6回目: 400
 7回目: 429
 8回目: 429
 9回目: 429
10回目: 429
```

6 回まで通るのは、「1 秒に 1 回」+「ため 5 回」だからです。7 回目以降は、ためが 1 秒に 1 回ずつしか戻らないので止められます。

**手順 3**: 商品の一覧は `200`。ログインの制限とは別に見られます。

```text
200
```

**手順 4**: 少し待てば、正しいパスワードで `200` に戻ります。本人は、待てば普通に使えます。

**手順 5**: ingress が止めた記録が残ります(`cut -c1-160`(PowerShell は `Substring`)で行の後ろを切っています。時刻は世界標準時です)。

```text
2026/09/26 03:39:57 [warn] 45#45: *68703 limiting requests, excess: 5.678 by zone "login", client: 127.0.0.1, server: api.lab.localhost, request: "POST /authori
2026/09/26 03:39:57 [warn] 45#45: *68704 limiting requests, excess: 5.666 by zone "login", client: 127.0.0.1, server: api.lab.localhost, request: "POST /authori
```

`client: 127.0.0.1` は、cdn-waf が伝えた「ホスト PC から来た」という意味の番号です。

429 は ingress が返しているので、api のログや `http_requests_total` には出ません(429 の返事の中身も、api の JSON ではなく nginx が作る短い HTML「429 Too Many Requests」です)。**アプリに届く前に止まっている** ことが、ここから分かります。

## 5. ここで覚える言葉

| 言葉 | 一言でいうと | たとえ | この演習で見たもの |
| --- | --- | --- | --- |
| [レート制限](/guide/glossary#rate-limit) | 同じ人からの回数を、時間あたりで絞る | ATM の暗証番号の試行回数 | ログインは 1 秒 1 回 |
| [バースト](/guide/glossary#burst) | 少しの「ため」。連続を一定回数まで許す | 続けて押してもすぐは怒られない | 1 回 + ため 5 回で、続けて 6 回までは通る |
| [429](/guide/glossary#http-429) | 「回数が多すぎる」という応答 | 「少し待ってください」の札 | 7 回目から 429 |
| 入口で止める | アプリに届く前に入口で断る | 受付でお引き取り願う | 429 が api のログに出ない |
| ロックしない | アカウントを止めず、場所(IP)を待たせる | 本人を締め出さず、その窓口だけ待たせる | 待てば本人はログインできる |

## 6. 設計書ではここに書く

- **[セキュリティ方式 4.3 レート制限](/design/architecture/10-security#s4-3)**: ログインは何回まで、超えたら何を返すか、どこ(入口)でかけるか、アカウントをロックしない理由。
- **[D-SEC-01 4.3 レート制限](/design/detail/D-SEC-01-waf-and-rate-limit#s4-3)**: ゾーンの設定値(1 秒 1 回・バースト 5)、対象の URL、返すコード(429)。
- **[セキュリティ方式 4.8 OAuth のクライアントとトークン](/design/architecture/10-security#s4-8)**: 何度失敗してもロックしない(入口の回数制限が歯止め)。

## 7. レビューで聞く質問

- 「ログイン口に回数制限はありますか。何回まで、どこ(入口・アプリ)でかけていますか。」
- 「制限を超えたとき、何を返しますか。それは api に届く前に止まりますか。」
- 「アカウントをロックする方式ですか、場所(IP)を待たせる方式ですか。他人にわざと締め出される危険はありませんか。」
- 「ログインを止められている人でも、買い物の画面は見られますか(制限が広すぎないか)。」
- 「弱いパスワードを試す攻撃を、ほかにどう防いでいますか(パスワードの強さの決まりなど)。」

## 8. 片付け

この演習は設定を変えていません。少し待てば「ため」が戻り、いつも通りログインできます。

::: code-group

```bash [Mac / Linux / WSL]
sleep 6
curl -s -o /dev/null -w '%{http_code}\n' http://api.lab.localhost:18080/authorizationserver/oauth/token \
  -d 'grant_type=password&client_id=storefront&username=alice&password=password'   # 200 ならよい
```

```powershell [PowerShell]
Start-Sleep 6
curl.exe -s -o NUL -w '%{http_code}\n' http://api.lab.localhost:18080/authorizationserver/oauth/token `
  -d 'grant_type=password&client_id=storefront&username=alice&password=password'   # 200 ならよい
```

:::
