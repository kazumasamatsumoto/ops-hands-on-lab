---
title: ネットワーク-2 CORS と IP 制限
---

# ネットワーク-2 CORS と IP 制限

::: info この演習について
- 所要時間: 約 15 分
- 使うもの: 軽量版(docker compose)。`curl`、ブラウザの開発者ツール(コンソール)
- 仕組みはこちら: [仕組み-6 api(OCC・fields・CORS)](/how-it-works/06-api-occ)・[仕組み-2 ingress(エンドポイントと IP フィルタ)](/how-it-works/02-ingress-and-endpoints)
- 関係する設計書: [ネットワーク方式](/design/architecture/04-network)・[D-NW-01 cdn-waf と ingress](/design/detail/D-NW-01-edge-route)・[セキュリティ方式](/design/architecture/10-security)
- 用語集: [CORS](/guide/glossary#cors)・[オリジン](/guide/glossary#origin)・[プリフライト](/guide/glossary#preflight)・[IP フィルタ](/guide/glossary#ip-filter)・[X-Forwarded-For](/guide/glossary#x-forwarded-for)
:::

## 1. この設計書はなぜ必要か

「誰が・どこから・どの入口を使ってよいか」を決めないと、便利にしたつもりの設定がそのまま穴になります。

> **よくある事故 1(CORS)**: スマホアプリの開発中、「ブラウザで API が呼べない」と言われた担当者が、API に「どのサイトから来ても、そのサイトに読ませてよい(ログインの Cookie 付きでも)」という設定を入れました(送られてきた `Origin` をそのまま `Access-Control-Allow-Origin` に返し、`Access-Control-Allow-Credentials: true` も付ける形です。`*` だけなら、ブラウザは Cookie 付きの返事を読ませません)。
> 本番にもそのまま出てしまい、罠のサイトを開いたお客様のブラウザから、ログイン中の会員情報が読み出せる状態になっていました。
>
> **よくある事故 2(IP 制限)**: 管理画面の URL を「推測されにくい名前」にしただけで公開していました。
> 検索サイトに URL が載ってしまい、世界中から管理画面のログイン画面に総当たりが来ていました。

入口ごとに「どのサイトの画面から呼んでよいか(CORS)」「どこのネットワークから入ってよいか(IP 制限)」を、ネットワークの方式設計書で決めます。

## 2. 何をやっているのか

第 2 版のサンプルストアは、画面(`http://www.lab.localhost:18080`)と api(`http://api.lab.localhost:18080`)を **別のホスト名(= 別オリジン)** にしています。
ブラウザは、別オリジンの api から返事を読むとき、api が `Access-Control-Allow-Origin` で「この画面には読ませてよい」と言っているかを確かめます(CORS)。
api は、`Origin` が許可した住所(`CORS_ALLOWED_ORIGINS`、既定は www の住所)のときだけ許可を返し、知らない住所には返しません。

管理画面(backoffice)は、ingress が **社内の IP(`BACKOFFICE_IP_ALLOWLIST`)以外を 403** で断ります(社内だけ通す IP フィルタ)。
本当の利用者の IP は、cdn-waf が `X-Forwarded-For` に書き、ingress は **cdn-waf から来たときだけ** その値を信じます。

たとえ: **CORS は「マンションの宅配ボックスの受け取り人の指定」** です。荷物(API の答え)は届いても、指定された住人(許可された画面)しか取り出せません。
**IP 制限は「社員証がないと入れない通用口」** です。通用口の場所(URL)を知っていても、社外からは開きません。

::: tip CCv2 では
CORS の許可は、CCv2 の `corsfilter`(OCC の CORS の設定)に当たります。IP フィルタは、Cloud Portal のエンドポイントの「IP フィルタ」に当たり、
`backoffice` のエンドポイントを社内 IP だけに絞るのと同じです。第 1 版は画面と api を同じオリジンにまとめていましたが、第 2 版は CCv2 と同じく別オリジンにしたので、CORS が本当に効きます。
:::

## 3. まず触ってみる

1. **CORS の許可ヘッダを `curl` で確かめる**。`Origin` はブラウザが自動で付ける「どのサイトの画面から来たか」のヘッダです。ここでは手で付けて試します。

   ```bash
   A=http://api.lab.localhost:18080/occ/v2/samplestore/products/100001
   curl -s -D - -o /dev/null -H 'Origin: http://www.lab.localhost:18080' "$A" | grep -iE '^HTTP|access-control|^vary'
   echo ---
   curl -s -D - -o /dev/null -H 'Origin: http://evil.example' "$A" | grep -iE '^HTTP|access-control|^vary'
   ```

2. **下見(プリフライト)を試す**。注文の API は `Authorization` を付けるので、ブラウザは本番の前に `OPTIONS` で「送ってよいか」を確かめます。

   ```bash
   O=http://api.lab.localhost:18080/occ/v2/samplestore/users/current/orders
   curl -s -D - -o /dev/null -X OPTIONS -H 'Origin: http://www.lab.localhost:18080' \
     -H 'Access-Control-Request-Method: GET' -H 'Access-Control-Request-Headers: authorization' "$O" | grep -iE '^HTTP|access-control'
   echo ---
   curl -s -D - -o /dev/null -X OPTIONS -H 'Origin: http://evil.example' \
     -H 'Access-Control-Request-Method: GET' -H 'Access-Control-Request-Headers: authorization' "$O" | grep -iE '^HTTP'
   ```

3. **ブラウザで、別オリジンから読んでみる**。ラボの pager(http://localhost:19094)は、ポート番号が違うので「別のオリジン」です。pager を開き、開発者ツール(F12)の「コンソール」に次を貼ります。
   Chrome で初めてコンソールに貼ると、貼り付けについての警告が出て、貼れないことがあります。そのときは、コンソールに `allow pasting`(Chrome の表示が日本語なら `貼り付けを許可`)と手で打って Enter を押してから、もう一度貼ります。

   ```js
   fetch('http://api.lab.localhost:18080/occ/v2/samplestore/products/100002').then(r => 'OK ' + r.status).catch(e => 'ERROR ' + e)
   ```

   次に、お店の画面 http://www.lab.localhost:18080/ を開いて、同じことを試します(こちらは許可された住所なので読めます)。

4. **CORS は「サーバーの壁」ではないことを確かめる**。`Origin` を付けない `curl`(= ブラウザではない道具)は、CORS に関係なく答えを読めます。

   ```bash
   curl -s -o /dev/null -w 'curl(no Origin): %{http_code}\n' http://api.lab.localhost:18080/occ/v2/samplestore/products/100001
   ```

5. **管理画面の IP フィルタを見る**。この PC(社内扱い)からと、社外の代わりのネットワーク `lab_outside` からで比べます。

   ```bash
   docker compose exec -T ingress cat /etc/nginx/ip-filters/backoffice.conf
   curl -s -o /dev/null -w 'この PC → backoffice: %{http_code}\n' http://backoffice.lab.localhost:18080/backoffice/login
   docker run --rm --network lab_outside curlimages/curl:8.16.0 -s -o /dev/null -w '社外 → backoffice: %{http_code}\n' \
     -H 'Host: backoffice.lab.localhost' http://cdn-waf:18080/backoffice/login
   docker run --rm --network lab_outside curlimages/curl:8.16.0 -s -o /dev/null -w '社外 → www(お店): %{http_code}\n' \
     -H 'Host: www.lab.localhost' http://cdn-waf:18080/
   docker compose logs ingress --no-log-prefix --since 1m | grep 'access forbidden' | tail -1
   ```

6. **偽の IP は信じないことを確かめる**。社外から、自分で `X-Forwarded-For: 127.0.0.1`(= 社内のふり)を付けても通りません。cdn-waf が `X-Forwarded-For` を本当の送り元の IP で上書きし、ingress は cdn-waf から来たときだけその値を信じるからです。

   ```bash
   docker run --rm --network lab_outside curlimages/curl:8.16.0 -s -o /dev/null -w '社外+偽XFF → backoffice: %{http_code}\n' \
     -H 'Host: backoffice.lab.localhost' -H 'X-Forwarded-For: 127.0.0.1' http://cdn-waf:18080/backoffice/login
   ```

## 4. 何が見えたら成功か

**手順 1**: 許した住所には `Access-Control-Allow-Origin` が返り、知らない住所には返りません(でも `Vary: Origin` はどちらにも付きます。住所ごとに別々にキャッシュするためです)。

```text
HTTP/1.1 200 OK
Vary: Origin
Access-Control-Allow-Origin: http://www.lab.localhost:18080
Access-Control-Expose-Headers: X-Search-Provider
---
HTTP/1.1 200 OK
Vary: Origin
```

**手順 2**: 許した住所の下見は 204(送ってよい)で、許すヘッダ(`Authorization` など)が返ります。知らない住所の下見は 403。

```text
HTTP/1.1 204 No Content
Access-Control-Allow-Origin: http://www.lab.localhost:18080
Access-Control-Expose-Headers: X-Search-Provider
Access-Control-Allow-Methods: GET, POST, PUT, PATCH, DELETE, OPTIONS
Access-Control-Allow-Headers: Authorization, Content-Type, traceparent, tracestate, X-Request-Id
Access-Control-Max-Age: 600
---
HTTP/1.1 403 Forbidden
```

`Access-Control-Max-Age: 600` は「この下見の答えを 600 秒(10 分)覚えておいてよい」、`Access-Control-Expose-Headers` は「画面の JS に見せてよい応答ヘッダ」の一覧です。

**手順 3**: 別オリジン(pager、19094)からは `ERROR TypeError: Failed to fetch`、お店の画面(www)からは `OK 200`。
pager のコンソールには、赤い文字で「`Access-Control-Allow-Origin` が無いので CORS で止めた」という意味のメッセージも出ます(文面はブラウザによって違います)。

**手順 4**: `curl` は 200 で読めます。**CORS は「サーバーを守る壁」ではなく「お客様のブラウザが、よそのサイトに情報を渡さないための決まり」** です。
`curl` や攻撃用の道具は CORS を無視します。サーバーを守るのは、認証・認可・IP 制限・WAF の仕事です。

```text
curl(no Origin): 200
```

**手順 5**: 許す範囲の一覧(`allow`)の最後に「それ以外は拒否(`deny all`)」。この PC からは 200、社外からは 403(お店の www は社外でも 200)。断ったことは ingress のログに残ります。

```text
allow 127.0.0.1/32;
allow 172.30.89.0/24;
allow 172.30.91.0/24;
deny all;
この PC → backoffice: 200
社外 → backoffice: 403
社外 → www(お店): 200
[error] access forbidden by rule, client: 172.30.90.3, server: backoffice.lab.localhost, request: "GET /backoffice/login HTTP/1.1"
```

**手順 6**: 偽の `X-Forwarded-For` を付けても 403。cdn-waf が `X-Forwarded-For` を本当の送り元(172.30.90.x)で **上書き** し、ingress は「cdn-waf(172.30.89.10)から来たときだけ `X-Forwarded-For` を信じる」ので、社外から自分で書いた値は届く前に消えています。

```text
社外+偽XFF → backoffice: 403
```

## 5. ここで覚える言葉

| 言葉 | 一言でいうと | たとえ | この演習で見たもの |
| --- | --- | --- | --- |
| [オリジン](/guide/glossary#origin) | 「方式(http/https)+ 住所 + ポート番号」の組 | マンションの部屋番号 | www と api は別オリジン |
| 同一オリジンポリシー | よそのオリジンの答えを、ブラウザが JS に渡さない決まり | 宅配ボックスは指定の人しか開けられない | pager から `Failed to fetch` |
| [CORS](/guide/glossary#cors) | よそのオリジンに「読んでよい」と許可を出す仕組み | 受け取り人に家族を追加する届け出 | `Access-Control-Allow-Origin` が www にだけ返る |
| [プリフライト](/guide/glossary#preflight) | 本番の前に、ブラウザが「送ってよいか」を OPTIONS で聞く | 荷物を送る前の「受け取れますか」の電話 | 許した住所に 204、知らない住所に 403 |
| [IP フィルタ](/guide/glossary#ip-filter) | 送り元の住所で、入れるかどうかを決める | 社員証がないと入れない通用口 | backoffice が社外から 403 |
| [X-Forwarded-For](/guide/glossary#x-forwarded-for) | 前段が書く「本当の利用者の IP」のヘッダ。偽れる | 取次が書き添える「元の差出人」 | cdn-waf からのときだけ信じる |

## 6. 設計書ではここに書く

- **[ネットワーク方式 4.5 CORS](/design/architecture/04-network#s4-5)**: 「画面と api は別オリジン。許すのは www の住所だけ。`*`(どこからでも)は使わない」「CORS はサーバーの防御ではない。api は必ず認証・認可で守る」。
- **[ネットワーク方式 4.4 backoffice エンドポイントの IP フィルタ](/design/architecture/04-network#s4-4)・[4.8 エンドポイントごとの IP フィルタと環境の差](/design/architecture/04-network#s4-8)**: 「backoffice は社内ネットワークからだけ。d1・s1 はお店(www)・api も社内だけ」。
- **[D-NW-01 4.6 ingress の振り分けと閉じる口](/design/detail/D-NW-01-edge-route#s4-6)**: URL の形ごとの表に **振り分け先・IP フィルタ・CORS の許可** の列を足します。
- **[セキュリティ方式 4.4 管理の入口](/design/architecture/10-security#s4-4)**: IP フィルタを変える手続き(誰が承認するか)。

## 7. レビューで聞く質問

- 「画面と api のオリジンは分かれていますか。api の CORS は、どのオリジンに許可を出しますか。`*` になっていませんか。」
- 「CORS の許可に、ログインの情報(Cookie など)を送ってよい設定は入っていますか。それは本当に必要ですか。」
- 「管理画面や運用の URL は、インターネットから届きますか。届かないことを、どのコマンドで確かめましたか。」
- 「IP フィルタで『通す』側のリストは誰が管理し、変えるときは誰が承認しますか。」
- 「利用者の本当の IP を、どのヘッダから、どの相手から来たときだけ信じますか。偽の IP を弾けますか。」

## 8. 片付け

この演習では設定を変えていません(手順 5〜6 は読むだけです)。ブラウザのコンソールで試したことも、ページを閉じれば消えます。

```bash
tools/chaos.sh status        # すべて既定値(false / 0)のままならよい
```
