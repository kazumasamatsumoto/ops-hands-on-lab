---
title: BE-1 API と認可の事故(他人の注文が見える)
---

# BE-1 API と認可の事故(他人の注文が見える)

::: info この演習について
- 所要時間: 約 15 分
- 使うもの: 軽量版(docker compose)。`curl`、`tools/chaos.sh`
- 関係する設計書: [BE 方式](/design/architecture/02-backend)・[D-BE 注文 API と認可](/design/detail/D-BE-orders-api)・[セキュリティ方式](/design/architecture/10-security)
:::

## 1. この設計書はなぜ必要か

「ログインしているか」を確かめることと、「その人がそのデータを見てよいか」を確かめることは、**別の仕事** です。
後者を忘れると、ログインさえすれば誰の情報でも見られる API になります。

> **よくある事故**: 会員が自分の注文履歴を開くと、URL が `/me/orders/1052` でした。何気なく末尾を `1053` に変えてみると、
> 知らない人の名前・住所・買った物が表示されました。SNS に書き込まれて発覚し、個人情報の漏えいとして公表することになりました。
> プログラムは「ログインしているか」は確かめていましたが、「その注文の持ち主か」は確かめていませんでした。

この種の穴は画面を触っているだけでは見つかりにくく、試験でも「自分のデータで確かめた」だけでは通ってしまいます。
だから BE の方式設計書で「どこで・何を・どう確かめるか」を決め、詳細設計書で API ごとに書き、レビューで確かめます。

## 2. 何をやっているのか

サンプルストアの api は、ログイン(`POST /api/login`)すると **JWT**(ログインした印の入った、改ざんできない札)を返します。
注文詳細(`GET /api/orders/:orderId`)は JWT を確かめたうえで、**注文の持ち主が JWT の人と同じか** を確かめ、違えば 404(見つかりません)を返します。
わざと壊すスイッチ `idorBug=true` を入れると、この 2 つ目の確かめが抜け、alice が bob や carol の注文を読めてしまいます。

たとえ: **ホテルのカードキー** です。「カードキーを持っているか(ログインしているか = 認証)」だけで通すと、宿泊客なら誰でも全部の部屋に入れてしまいます。
正しくは「そのカードキーで開けてよいのはこの部屋だけ(認可)」まで確かめます。

## 3. まず触ってみる

1. **alice でログインして、札(JWT)を受け取る**。受け取った札は `TOKEN` という名前でシェルに覚えさせます。

   ```bash
   TOKEN=$(curl -s -X POST -H 'Content-Type: application/json' \
     -d '{"username":"alice","password":"password"}' http://localhost:18080/api/login \
     | python3 -c 'import json,sys;print(json.load(sys.stdin)["token"])')
   echo ${TOKEN:0:30}...
   ```

2. **札の中身をのぞく**。JWT の真ん中の部分は、ただの文字の書き換え(Base64)なので誰でも読めます(秘密は入れない、ということです)。

   ```bash
   python3 -c "import sys,base64;p=sys.argv[1].split('.')[1];print(base64.urlsafe_b64decode(p+'='*(-len(p)%4)).decode())" "$TOKEN"
   ```

3. **自分の注文を見る**。札なしだと 401、札ありだと alice の注文だけが返ります。

   ```bash
   curl -s -w ' %{http_code}\n' http://localhost:18080/api/me/orders
   curl -s -H "Authorization: Bearer $TOKEN" http://localhost:18080/api/me/orders \
     | python3 -c 'import json,sys;[print(o["id"],o["username"],o["total"],o["status"]) for o in json.load(sys.stdin)]'
   ```

4. **他人の注文番号を試す(正しい状態)**。alice の注文は 1〜3 です。4 は bob の注文です。

   ```bash
   curl -s -w ' %{http_code}\n' -H "Authorization: Bearer $TOKEN" http://localhost:18080/api/orders/4
   ```

5. **認可の穴を開ける**。

   ```bash
   tools/chaos.sh set idorBug=true
   for id in 4 5 6 7 8 9; do
     curl -s -H "Authorization: Bearer $TOKEN" http://localhost:18080/api/orders/$id \
       | python3 -c 'import json,sys;d=json.load(sys.stdin);print(d.get("id"),d.get("username"),d.get("total"),d.get("error",""))'
   done
   ```

   番号を 1 つずつ変えるだけで、他人の注文が次々に読めます。ブラウザで alice としてログインし、http://localhost:18080/me/orders/4 を開いても同じで、画面に「注文 4 … 会員番号: 2」(bob の注文)が表示されます。

6. **ログに残っているか見る**。この演習の api は、他人の注文を返したときに警告を出すようにしてあります(本物の事故では、たいてい何も残っていません)。

   ```bash
   docker compose logs api --no-log-prefix | grep idorBug | tail -1
   ```

7. **穴を閉じて、もう一度試す**。

   ```bash
   tools/chaos.sh reset
   curl -s -w ' %{http_code}\n' -H "Authorization: Bearer $TOKEN" http://localhost:18080/api/orders/4
   curl -s -w ' %{http_code}\n' -H "Authorization: Bearer $TOKEN" http://localhost:18080/api/orders/999
   ```

## 4. 何が見えたら成功か

**手順 2**: 札に入っているのは「誰か(`sub` = 会員番号 1、`username`)」と「いつまで有効か(`exp`)」だけです。

```text
{"sub":"1","username":"alice","iat":1790348349,"exp":1790349249}
```

**手順 3〜4**: 札なしは 401、自分の注文は 3 件、他人の注文 4 は 404。

```text
{"error":"unauthorized","message":"ログインが必要です"} 401
3 alice 5960 準備中
2 alice 990 発送済み
1 alice 1485 発送済み
{"error":"not_found","message":"注文が見つかりません"} 404
```

**手順 5**: `idorBug=true` にすると、alice の札で bob と carol の注文がすべて読めます(9 は存在しないので not_found)。

```text
{"latencyMs":0,"errorRate":0,"leakMb":0,"idorBug":true,"sqliBug":false,"leakedMb":0}
4 bob 2480
5 bob 3190
6 carol 3960
7 carol 1320
8 carol 3300
None None None not_found
```

**手順 6**: 「見た人」と「持ち主」が違う、という記録。

```text
{"level":40,"service":"api","chaos":"idorBug","viewer":"alice","owner":"carol","orderId":8,"msg":"chaos: 他人の注文を返します"}
```

**手順 7**: 他人の注文(4)も、存在しない注文(999)も、**同じ 404** になります。
「403(見てはいけない)」ではなく 404 にしているのは、「その番号の注文が存在する」こと自体を他人に教えないためです。

```text
{"error":"not_found","message":"注文が見つかりません"} 404
{"error":"not_found","message":"注文が見つかりません"} 404
```

## 5. ここで覚える言葉

| 言葉 | 一言でいうと | たとえ | この演習で見たもの |
| --- | --- | --- | --- |
| 認証 | あなたは誰かを確かめる | カードキーを持っているか | `POST /api/login` と、札なしの 401 |
| 認可 | その人がそれをしてよいかを確かめる | そのカードキーでこの部屋を開けてよいか | 他人の注文 4 が 404 になる |
| JWT | ログインした印を入れた、署名付きの札 | 偽造防止の透かし入りの入館証 | `{"sub":"1","username":"alice",...}` |
| IDOR | 番号を変えるだけで他人のデータに届いてしまう穴 | 部屋番号を変えれば隣の部屋が開くカードキー | `idorBug=true` で 4〜8 が読める |
| 401 と 403 と 404 | 401 = 誰か分からない、403 = 分かったが駄目、404 = 無い(ことにする) | 受付で「どなた?」「ご案内できません」「そんな部屋はありません」 | 札なし 401、他人の注文 404 |
| 監査ログ | 誰が何を見た・変えたかの記録 | 入退室の記録簿 | `viewer` と `owner` の入ったログ |

## 6. 設計書ではここに書く

- **[BE 方式 4.2 認証](/design/architecture/02-backend#s4-2)**: 「認証は JWT(有効 15 分)。札には会員番号と期限だけを入れ、秘密は入れない」。
- **[BE 方式 4.3 認可](/design/architecture/02-backend#s4-3)**:
  「認可は **API の中で、データを読んだ後に持ち主を確かめる**。画面側で隠すだけの対策は認可と呼ばない」「持ち主でないときは 404 を返す(存在を教えない)」と書きます。
- **[D-BE 注文 API と認可 4.3 GET /api/orders/:orderId](/design/detail/D-BE-orders-api#s4-3)**(一般のカタログでは D-BE 系の API 設計書): API ごとに「誰が呼べるか」「どの行を返してよいか(自分の `user_id` の行だけ)」「駄目なときの応答」を表にします。
- **[QA 方式 4.1 テストの種類](/design/architecture/06-qa#s4-1)**: 試験では **2 人の会員で互いのデータを読みに行く** 手順を必ず入れる、と書きます。
- **[セキュリティ方式](/design/architecture/10-security)**: 「他人のデータへの到達(IDOR)」を脅威の一覧に入れ、個人のデータを返した API は見た人・対象の ID を記録する(監査ログ)と書きます。

## 7. レビューで聞く質問

- 「この API は、ログインしているかに加えて、『そのデータの持ち主か(見てよい人か)』をどこで確かめていますか。コードの行を教えてください。」
- 「URL や本文の ID を別の人の ID に変えたとき、何が返りますか。試験項目にありますか。」
- 「持ち主でないときに 403 ではなく 404 を返す(または返さない)理由は何ですか。」
- 「認可の確かめを、画面(ボタンを隠すなど)だけでやっていませんか。」
- 「誰が誰のデータを見たかは、ログに残りますか。何日残しますか。」

## 8. 片付け

```bash
tools/chaos.sh reset          # "idorBug":false に戻ったことを確かめる
unset TOKEN
```
