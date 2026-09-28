---
title: BE-1 API と認可の事故(他人の注文が見える)
---

# BE-1 API と認可の事故(他人の注文が見える)

::: info この演習について
- 所要時間: 約 15 分
- 使うもの: 軽量版(docker compose)。`curl`、`tools/chaos.sh`
- 仕組みはこちら: [仕組み-6 api(OCC・fields・CORS)](/how-it-works/06-api-occ)・[仕組み-7 OAuth のトークン](/how-it-works/07-oauth-token)
- 関係する設計書: [BE 方式](/design/architecture/02-backend)・[D-BE 注文 API と認可](/design/detail/D-BE-orders-api)・[セキュリティ方式](/design/architecture/10-security)
- 用語集: [認証](/guide/glossary#authentication)・[認可](/guide/glossary#authorization)・[IDOR](/guide/glossary#idor)・[OCC](/guide/glossary#occ)・[OAuth](/guide/glossary#oauth)・[アクセストークン](/guide/glossary#access-token)
:::

## 1. この設計書はなぜ必要か

「ログインしているか」を確かめることと、「その人がそのデータを見てよいか」を確かめることは、**別の仕事** です。
後者を忘れると、ログインさえすれば誰の情報でも見られる API になります。

> **よくある事故**: 会員が自分の注文の詳細を開くと、URL の末尾が `00001052` でした。何気なく `00001053` に変えてみると、
> 知らない人の名前・住所・買った物が表示されました。SNS に書き込まれて発覚し、個人情報の漏えいとして公表することになりました。
> プログラムは「ログインしているか」は確かめていましたが、「その注文の持ち主か」は確かめていませんでした。

この種の穴は画面を触っているだけでは見つかりにくく、試験でも「自分のデータで確かめた」だけでは通ってしまいます。
だから BE の方式設計書で「どこで・何を・どう確かめるか」を決め、詳細設計書で API ごとに書き、レビューで確かめます。

## 2. 何をやっているのか

サンプルストアの api は、CCv2 の OCC(商品や注文を返す REST API)の形をまねています。流れは次のとおりです。

1. **トークンをもらう**(認証): `POST /authorizationserver/oauth/token` に名前とパスワードを送ると、**アクセストークン**(ログインした印の、中身の無いランダムな文字列)が返ります。有効 15 分です。
2. **トークンを付けて呼ぶ**: `Authorization: Bearer <トークン>` を付けて `GET /occ/v2/samplestore/users/current/orders` を呼ぶと、**その人の** 注文だけが返ります。`current` は「トークンの持ち主」という意味で、URL に会員の名前は入りません。
3. **注文 1 件**(認可): `GET /occ/v2/samplestore/users/current/orders/{code}` は、トークンを確かめたうえで **注文の持ち主がトークンの人と同じか** を確かめ、違えば 404(見つかりません)を返します。

わざと壊すスイッチ `idorBug=true` を入れると、3 つ目の確かめが抜け、alice が bob や carol の注文を読めてしまいます。

たとえ: **ホテルのカードキー** です。「カードキーを持っているか(ログインしているか = 認証)」だけで通すと、宿泊客なら誰でも全部の部屋に入れてしまいます。
正しくは「そのカードキーで開けてよいのはこの部屋だけ(認可)」まで確かめます。

::: tip CCv2 では
`/occ/v2/{baseSiteId}/users/current/orders/{code}` は OCC の注文の URL と同じ形です。本物の OCC も「current の注文でなければ見つからない」と答えます。
CCv2 の案件では、OCC を **拡張して新しい API を足す** ときに、この「持ち主の確かめ」を自分で書く必要があります。そこが事故の起きやすい所です。
:::

## 3. まず触ってみる

1. **alice のトークンをもらう**。まず返事の全体を見て、次にトークンだけを `TOKEN` という名前でシェルに覚えさせます。

   ::: code-group

   ```bash [Mac / Linux / WSL]
   curl -s http://api.lab.localhost:18080/authorizationserver/oauth/token \
     -d 'grant_type=password&client_id=storefront&username=alice&password=password'; echo
   TOKEN=$(curl -s http://api.lab.localhost:18080/authorizationserver/oauth/token \
     -d 'grant_type=password&client_id=storefront&username=alice&password=password' \
     | python3 -c 'import json,sys;print(json.load(sys.stdin)["access_token"])')
   echo ${TOKEN:0:12}...
   ```

   ```powershell [PowerShell]
   curl.exe -s http://api.lab.localhost:18080/authorizationserver/oauth/token `
     -d 'grant_type=password&client_id=storefront&username=alice&password=password'; ''
   $TOKEN = (curl.exe -s http://api.lab.localhost:18080/authorizationserver/oauth/token `
     -d 'grant_type=password&client_id=storefront&username=alice&password=password' `
     | ConvertFrom-Json).access_token
   "$($TOKEN.Substring(0,12))..."
   ```

   :::

   PowerShell では python3 の代わりに、JSON を読む標準のコマンド `ConvertFrom-Json` を使います(以降の手順も同じです)。

2. **トークン無しと、有りで呼ぶ**。トークン無しは 401、有りなら「誰か」と alice の注文だけが返ります。

   ::: code-group

   ```bash [Mac / Linux / WSL]
   A=http://api.lab.localhost:18080/occ/v2/samplestore
   curl -s -w ' %{http_code}\n' $A/users/current/orders
   curl -s -H "Authorization: Bearer $TOKEN" $A/users/current; echo
   curl -s -H "Authorization: Bearer $TOKEN" $A/users/current/orders \
     | python3 -c 'import json,sys;[print(o["code"],o["status"],o["total"]["formattedValue"],o["placed"][:10]) for o in json.load(sys.stdin)["orders"]]'
   ```

   ```powershell [PowerShell]
   $A = 'http://api.lab.localhost:18080/occ/v2/samplestore'
   curl.exe -s -w ' %{http_code}\n' "$A/users/current/orders"
   curl.exe -s -H "Authorization: Bearer $TOKEN" "$A/users/current"; ''
   (curl.exe -s -H "Authorization: Bearer $TOKEN" "$A/users/current/orders" | ConvertFrom-Json).orders `
     | ForEach-Object { '{0} {1} {2} {3}' -f $_.code, $_.status, $_.total.formattedValue, $_.placed.ToString('yyyy-MM-dd') }
   ```

   :::

3. **他人の注文番号を試す(正しい状態)**。alice の注文は `00001001`〜`00001003` です。`00001004` は bob の注文、`00009999` は存在しない番号です。

   ::: code-group

   ```bash [Mac / Linux / WSL]
   curl -s -w ' %{http_code}\n' -H "Authorization: Bearer $TOKEN" $A/users/current/orders/00001004
   curl -s -w ' %{http_code}\n' -H "Authorization: Bearer $TOKEN" $A/users/current/orders/00009999
   ```

   ```powershell [PowerShell]
   curl.exe -s -w ' %{http_code}\n' -H "Authorization: Bearer $TOKEN" "$A/users/current/orders/00001004"
   curl.exe -s -w ' %{http_code}\n' -H "Authorization: Bearer $TOKEN" "$A/users/current/orders/00009999"
   ```

   :::

4. **認可の穴を開ける**。

   ::: code-group

   ```bash [Mac / Linux / WSL]
   tools/chaos.sh set idorBug=true
   for c in 00001004 00001005 00001006 00001007 00001008 00001009; do
     curl -s -H "Authorization: Bearer $TOKEN" $A/users/current/orders/$c \
       | python3 -c 'import json,sys;d=json.load(sys.stdin);print(d.get("code"),d.get("user",{}).get("uid"),d.get("total",{}).get("formattedValue"),d.get("errors",[{}])[0].get("type",""))'
   done
   ```

   ```powershell [PowerShell]
   tools/chaos.ps1 set idorBug=true
   foreach ($c in '00001004', '00001005', '00001006', '00001007', '00001008', '00001009') {
     $d = curl.exe -s -H "Authorization: Bearer $TOKEN" "$A/users/current/orders/$c" | ConvertFrom-Json
     '{0} {1} {2} {3}' -f $d.code, $d.user.uid, $d.total.formattedValue, $d.errors.type
   }
   ```

   :::

   PowerShell では、無い項目は `None` ではなく空白で出ます(最後の 1 行は `   UnknownIdentifierError` のように見えます)。

   番号を 1 つずつ変えるだけで、他人の注文が次々に読めます。ブラウザで alice としてログインし(http://www.lab.localhost:18080/login)、
   http://www.lab.localhost:18080/my-account/orders/00001004 を開いても同じで、bob の注文が表示されます。

5. **ログに残っているか見る**。この演習の api は、他人の注文を返したときに警告を出すようにしてあります(本物の事故では、たいてい何も残っていません)。

   ::: code-group

   ```bash [Mac / Linux / WSL]
   docker compose logs api --no-log-prefix | grep idorBug | tail -1
   ```

   ```powershell [PowerShell]
   docker compose logs api --no-log-prefix | Select-String 'idorBug' | Select-Object -Last 1
   ```

   :::

6. **穴を閉じて、もう一度試す**。

   ::: code-group

   ```bash [Mac / Linux / WSL]
   tools/chaos.sh reset
   curl -s -w ' %{http_code}\n' -H "Authorization: Bearer $TOKEN" $A/users/current/orders/00001004
   ```

   ```powershell [PowerShell]
   tools/chaos.ps1 reset
   curl.exe -s -w ' %{http_code}\n' -H "Authorization: Bearer $TOKEN" "$A/users/current/orders/00001004"
   ```

   :::

7. **トークンが DB にどう置かれているか見る**(おまけ)。トークンそのものではなく、SHA-256 で変換した値(ハッシュ)と期限だけが入っています。
   DB を盗み見られても、そこからトークンを作り直せないようにするためです。

   ::: code-group

   ```bash [Mac / Linux / WSL]
   docker compose exec -T db psql -U store -d store \
     -c "select left(token_hash,16)||'…' as token_hash, user_id, client_id, expires_at from oauth_access_tokens order by expires_at desc limit 2"
   ```

   ```powershell [PowerShell]
   docker compose exec -T db psql -U store -d store `
     -c "select left(token_hash,16)||'…' as token_hash, user_id, client_id, expires_at from oauth_access_tokens order by expires_at desc limit 2"
   ```

   :::

## 4. 何が見えたら成功か

**手順 1**: トークンは有効 900 秒(15 分)。`token_type` は `bearer`(持っている人を本人とみなす札)です。

```text
{"access_token":"5Xp-3LfbDoTpYuDNYXdr8Gh6iOgkfKyuQt39_SaCalQ","token_type":"bearer","expires_in":900,"scope":"basic"}
_tAFi9Jz3-Yq...
```

**手順 2**: トークン無しは 401、有りなら本人(`alice`)と、alice の注文 3 件だけ。

```text
{"errors":[{"type":"UnauthorizedError","message":"ログインが必要です(Authorization: Bearer <トークン>)"}]} 401
{"uid":"alice","name":"アリス"}
00001003 PROCESSING ￥5,960 2026-09-25
00001002 SHIPPED ￥990 2026-09-14
00001001 SHIPPED ￥1,485 2026-08-27
```

(日付は、ラボを起動した日から数えて作るので、あなたの環境では変わります。)

**手順 3**: 他人の注文(bob の `00001004`)も、存在しない注文(`00009999`)も、**同じ 404** です。

```text
{"errors":[{"type":"UnknownIdentifierError","message":"注文が見つかりません"}]} 404
{"errors":[{"type":"UnknownIdentifierError","message":"注文が見つかりません"}]} 404
```

「403(見てはいけない)」ではなく 404 にしているのは、「その番号の注文が存在する」こと自体を他人に教えないためです。

**手順 4**: `idorBug=true` にすると、alice のトークンで bob と carol の注文がすべて読めます(`00001009` は存在しないので 404 のまま)。

```text
{"latencyMs":0,"errorRate":0,"leakMb":0,"idorBug":true,"sqliBug":false,"cronFail":false,"leakedMb":0}
00001004 bob ￥2,480
00001005 bob ￥3,190
00001006 carol ￥3,960
00001007 carol ￥1,320
00001008 carol ￥3,300
None None None UnknownIdentifierError
```

**手順 5**: 「見た人(`viewer`)」と「持ち主(`owner`)」が違う、という記録。

```text
{"level":40,"time":1790386044753,"service":"samplestore-api","aspect":"api","reqId":"0fd51d21498b57732d0de2189b9b7b52","chaos":"idorBug","viewer":"alice","owner":"carol","order":"00001008","msg":"chaos: 他人の注文を返します"}
```

`reqId` は cdn-waf が付けたリクエストの番号です。同じ番号で cdn-waf・ingress のログを探すと、どこから来たリクエストかまでたどれます。

**手順 6**: 閉じると、また 404 に戻ります。

```text
{"latencyMs":0,"errorRate":0,"leakMb":0,"idorBug":false,"sqliBug":false,"cronFail":false,"leakedMb":0}
{"errors":[{"type":"UnknownIdentifierError","message":"注文が見つかりません"}]} 404
```

**手順 7**: トークンの控えは先頭 16 文字だけ表示しています(実物は 64 文字のハッシュ)。

```text
    token_hash     | user_id | client_id  |          expires_at
-------------------+---------+------------+-------------------------------
 fb08683e0956a2e0… |       1 | storefront | 2026-09-26 01:42:24.517212+00
 9dcb01800f166a9a… |       1 | storefront | 2026-09-26 01:42:18.117379+00
```

## 5. ここで覚える言葉

| 言葉 | 一言でいうと | たとえ | この演習で見たもの |
| --- | --- | --- | --- |
| [認証](/guide/glossary#authentication) | あなたは誰かを確かめる | カードキーを持っているか | トークンの発行と、トークン無しの 401 |
| [認可](/guide/glossary#authorization) | その人がそれをしてよいかを確かめる | そのカードキーでこの部屋を開けてよいか | 他人の注文 `00001004` が 404 になる |
| [アクセストークン](/guide/glossary#access-token) | ログインした印の文字列。持っている人を本人とみなす | 期限付きの入館証 | `"token_type":"bearer","expires_in":900` |
| [OAuth](/guide/glossary#oauth)・[パスワードグラント](/guide/glossary#password-grant) | トークンをもらう決まり。名前とパスワードを渡して交換する形 | 受付で身分証を見せて入館証をもらう | `grant_type=password&client_id=storefront` |
| [IDOR](/guide/glossary#idor) | 番号を変えるだけで他人のデータに届いてしまう穴 | 部屋番号を変えれば隣の部屋が開くカードキー | `idorBug=true` で `00001004`〜`00001008` が読める |
| 401 と 403 と 404 | 401 = 誰か分からない、403 = 分かったが駄目、404 = 無い(ことにする) | 受付で「どなた?」「ご案内できません」「そんな部屋はありません」 | トークン無し 401、他人の注文 404 |
| 監査ログ | 誰が何を見た・変えたかの記録 | 入退室の記録簿 | `viewer` と `owner` の入ったログ |

## 6. 設計書ではここに書く

- **[BE 方式 4.2 認証(OAuth パスワードグラント)](/design/architecture/02-backend#s4-2)**: 「トークンは中身の無い文字列、有効 15 分。DB にはハッシュだけを置く」「受け付けるクライアントは `storefront` だけ」。
- **[BE 方式 4.3 認可](/design/architecture/02-backend#s4-3)**:
  「認可は **API の中で、データを読んだ後に持ち主を確かめる**。画面側で隠すだけの対策は認可と呼ばない」「持ち主でないときは 404 を返す(存在を教えない)」と書きます。
- **[D-BE 注文 API と認可 4.3 GET …/users/current/orders/{code}](/design/detail/D-BE-orders-api#s4-3)**・**[4.4 認証の確かめ方](/design/detail/D-BE-orders-api#s4-4)**: API ごとに「誰が呼べるか」「どの行を返してよいか(トークンの人の行だけ)」「駄目なときの応答」を表にします。
- **[QA 方式 4.4 守りの確認](/design/architecture/06-qa#s4-4)**: 試験では **2 人の会員で互いのデータを読みに行く** 手順を必ず入れる、と書きます([QA-1](./11-qa-e2e-regression) の `authz.spec.ts` がそれです)。
- **[セキュリティ方式 4.8 OAuth のクライアントとトークン](/design/architecture/10-security#s4-8)**: 「他人のデータへの到達(IDOR)」を脅威の一覧に入れ、個人のデータを返した API は見た人・対象の ID を記録する(監査ログ)と書きます。

## 7. レビューで聞く質問

- 「この API は、ログインしているかに加えて、『そのデータの持ち主か(見てよい人か)』をどこで確かめていますか。コードの行を教えてください。」
- 「URL や本文の ID を別の人の ID に変えたとき、何が返りますか。試験項目にありますか。」
- 「持ち主でないときに 403 ではなく 404 を返す(または返さない)理由は何ですか。」
- 「認可の確かめを、画面(ボタンを隠すなど)だけでやっていませんか。」
- 「トークンの有効期限は何分ですか。DB やログに、トークンそのものが残っていませんか。」
- 「誰が誰のデータを見たかは、ログに残りますか。何日残しますか。」

## 8. 片付け

::: code-group

```bash [Mac / Linux / WSL]
tools/chaos.sh reset          # "idorBug":false に戻ったことを確かめる
unset TOKEN A
```

```powershell [PowerShell]
tools/chaos.ps1 reset         # "idorBug":false に戻ったことを確かめる
Remove-Variable TOKEN, A
```

:::
