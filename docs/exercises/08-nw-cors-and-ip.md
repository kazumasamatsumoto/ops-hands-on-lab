---
title: ネットワーク-2 CORS と IP 制限
---

# ネットワーク-2 CORS と IP 制限

::: info この演習について
- 所要時間: 約 15 分
- 使うもの: 軽量版(docker compose)。`curl`、ブラウザの開発者ツール(コンソール)
- 関係する設計書: [ネットワーク方式](/design/architecture/04-network)・[D-NW-01 edge の経路とキャッシュ](/design/detail/D-NW-01-edge-route)・[セキュリティ方式](/design/architecture/10-security)
:::

## 1. この設計書はなぜ必要か

「誰が・どこから・どの入口を使ってよいか」を決めないと、便利にしたつもりの設定がそのまま穴になります。

> **よくある事故 1(CORS)**: スマホアプリの開発中、「ブラウザで API が呼べない」と言われた担当者が、API に「どのサイトからでも読んでよい」という設定を入れました。
> 本番にもそのまま出てしまい、罠のサイトを開いたお客様のブラウザから、ログイン中の会員情報が読み出せる状態になっていました。
>
> **よくある事故 2(IP 制限)**: 管理画面の URL を「推測されにくい名前」にしただけで公開していました。
> 検索サイトに URL が載ってしまい、世界中から管理画面のログイン画面に総当たりが来ていました。

入口ごとに「どのサイトの画面から呼んでよいか(CORS)」「どこのネットワークから入ってよいか(IP 制限)」を、ネットワークの方式設計書で決めます。

## 2. 何をやっているのか

サンプルストアは、画面(web)と API を **同じ入口 http://localhost:18080 の下にまとめています**(`/api/` は edge が api へ振り分け)。
ブラウザから見ると「同じオリジン(= 同じ住所の同じ番号の入口)」なので、CORS の許可を出す必要がなく、api は許可のヘッダを **何も返しません**。
そのため、別のオリジン(例: ポートが違う http://localhost:19094)の画面の JS からは、api の答えを読めません。
管理用の `/admin/` は、edge が「Docker の内部ネットワークと自分自身」以外を 403 で断ります(社内の IP だけ通す制限の代わり)。

たとえ: **CORS は「マンションの宅配ボックスの受け取り人の指定」** です。荷物(API の答え)は届いても、指定された住人(同じオリジンの画面)しか取り出せません。
**IP 制限は「社員証がないと入れない通用口」** です。通用口の場所(URL)を知っていても、社外からは開きません。

## 3. まず触ってみる

1. **別のオリジンの画面から API を読んでみる**(ブラウザ)。
   ラボの pager(http://localhost:19094)は、ポート番号が違うので「別のオリジン」です。pager を開き、開発者ツール(F12)の「コンソール」に次を貼ります。

   ```js
   fetch('http://localhost:18080/api/products/1').then(r => r.status).catch(e => 'ERROR ' + e)
   ```

   次に、お店の画面 http://localhost:18080/ を開いて、同じオリジンから読んでみます。

   ```js
   fetch('/api/products/1').then(r => r.json()).then(p => 'OK ' + p.name)
   ```

2. **サーバーには届いているかを見る**。ブラウザが止めたのは「答えを JS に渡すこと」で、リクエスト自体は届いています。

   ```bash
   docker compose logs edge --no-log-prefix --since 3m | grep '"uri":"/api/products/1"' | grep Mozilla | tail -1 | cut -c1-200
   ```

3. **CORS の許可ヘッダが無いことを `curl` で確かめる**。`Origin` はブラウザが自動で付ける「どのサイトの画面から来たか」のヘッダです。

   ```bash
   curl -s -D - -o /dev/null -H 'Origin: http://evil.example' http://localhost:18080/api/products/1 | grep -iE '^HTTP|access-control'
   curl -s -D - -o /dev/null -X OPTIONS -H 'Origin: http://evil.example' \
     -H 'Access-Control-Request-Method: POST' -H 'Access-Control-Request-Headers: content-type,authorization' \
     http://localhost:18080/api/login | grep -iE '^HTTP|access-control'
   ```

4. **管理画面の IP 制限を見る**。ホストの PC(社外の代わり)からと、Docker の内部ネットワーク(社内の代わり)からで比べます。

   ```bash
   curl -s -o /dev/null -w 'from host: %{http_code}\n' http://localhost:18080/admin/chaos
   docker compose exec -T api curl -s -w ' inside: %{http_code}\n' http://edge:8080/admin/chaos
   docker compose logs edge --no-log-prefix --since 1m | grep 'access forbidden' | tail -1
   ```

5. **設定を読む**。`edge/default.conf.template` の `location /admin/` の `allow` / `deny` の 4 行を読みます。上から順に当てはめ、最初に当たった行で決まります。

## 4. 何が見えたら成功か

**手順 1**: 別のオリジン(19094)からはエラー、同じオリジン(18080)からは読めます。

```text
19094 のコンソール:  'ERROR TypeError: Failed to fetch'
18080 のコンソール:  'OK ノート A5 方眼'
```

19094 のコンソールには、赤い文字で「`Access-Control-Allow-Origin` ヘッダが無いので、CORS の決まりにより止めた」という意味のメッセージも出ます(文面はブラウザによって違います)。

**手順 2**: edge の記録では、ブラウザからのリクエストに **200 で答えています**。止めたのはブラウザです。

```text
{"time":"2026-09-25T15:08:54+00:00","service":"edge",...,"method":"GET","uri":"/api/products/1","status":200,...,"cache":"HIT","user_agent":"Mozilla/5...
```

ここが大事な点です。**CORS は「サーバーを守る壁」ではなく「お客様のブラウザが、よそのサイトに情報を渡さないための決まり」** です。
`curl` や攻撃用の道具は CORS を無視します。サーバーを守るのは、認証・認可・IP 制限・WAF の仕事です。

**手順 3**: どちらにも `Access-Control-*` のヘッダが 1 つもありません(= どのよそのサイトにも許可を出していない)。事前の問い合わせ(OPTIONS)には 404 です。

```text
HTTP/1.1 200 OK
HTTP/1.1 404 Not Found
```

**手順 4**: ホストからは 403、内部ネットワークからは 200。断ったことは edge のログに残ります。

```text
from host: 403
{"latencyMs":0,"errorRate":0,"leakMb":0,"idorBug":false,"sqliBug":false,"leakedMb":0} inside: 200
[error] ... access forbidden by rule, client: …, server: _, request: "GET /admin/chaos HTTP/1.1", host: "localhost:18080"
```

(`client:` の後ろには、この PC から来た通信の住所が入ります。Docker Desktop では、PC の住所がそのまま見えないことがあります。)

## 5. ここで覚える言葉

| 言葉 | 一言でいうと | たとえ | この演習で見たもの |
| --- | --- | --- | --- |
| オリジン | 「方式(http/https)+ 住所 + ポート番号」の組 | マンションの部屋番号 | 18080 と 19094 は別のオリジン |
| 同一オリジンポリシー | よそのオリジンの答えを、ブラウザが JS に渡さない決まり | 宅配ボックスは本人しか開けられない | 19094 から `Failed to fetch` |
| CORS | よそのオリジンに「読んでよい」と許可を出す仕組み | 受け取り人に家族を追加する届け出 | `Access-Control-Allow-Origin` が無い |
| 事前の問い合わせ(プリフライト) | 本番のリクエストの前に、ブラウザが「送ってよいか」を OPTIONS で聞く | 荷物を送る前の「受け取れますか」の電話 | OPTIONS に 404 |
| IP 制限 | 送り元の住所で、入れるかどうかを決める | 社員証がないと入れない通用口 | `/admin/` がホストから 403 |
| 許可リスト | 通してよい物だけを書き、残りは全部断る書き方 | 入館者名簿 | `allow 172.30.89.0/24; deny all;` |

## 6. 設計書ではここに書く

- **[ネットワーク方式 4.1 振り分け](/design/architecture/04-network#s4-1)**: 「画面と API は同じオリジンにまとめ、`/api/` で振り分ける」。
- **[ネットワーク方式 4.5 CORS](/design/architecture/04-network#s4-5)**: 「同じオリジンなので CORS は開けない」「もし別オリジン(スマホアプリ用の API など)が必要になったら、許可するオリジンを 1 つずつ書く。`*`(どこからでも)は使わない」「CORS はサーバーの防御ではない。API は必ず認証・認可で守る」。
- **[ネットワーク方式 4.4 管理画面の IP 制限](/design/architecture/04-network#s4-4)**: 「`/admin/` は社内ネットワーク(○○.○○.0.0/16)と踏み台サーバーからだけ。インターネットからは 403」。
- **[セキュリティ方式 4.4 管理の入口](/design/architecture/10-security#s4-4)**: IP 制限を変える手続き(誰が承認するか)。
- **[D-NW-01 edge の経路とキャッシュ 4.1 location の一覧](/design/detail/D-NW-01-edge-route#s4-1)**(一般のカタログでは D-NW-01): URL の形ごとの表に **振り分け先・IP 制限・CORS の許可** の列を足します。

## 7. レビューで聞く質問

- 「画面と API は同じオリジンですか。違うなら、どのオリジンに許可を出しますか。`*` になっていませんか。」
- 「CORS の許可に、ログインの情報(Cookie など)を送ってよい設定は入っていますか。それは本当に必要ですか。」
- 「管理画面や運用の URL は、インターネットから届きますか。届かないことを、どのコマンドで確かめましたか。」
- 「IP 制限で『通す』側のリストは誰が管理し、変えるときは誰が承認しますか。」
- 「開発中に緩めた設定(CORS の `*` など)が、本番に出ないようにする仕組みはありますか。」

## 8. 片付け

この演習では何も変えていません。ブラウザのコンソールで試したことも、ページを閉じれば消えます。

```bash
tools/chaos.sh status        # すべて既定値(false / 0)のままならよい
```
