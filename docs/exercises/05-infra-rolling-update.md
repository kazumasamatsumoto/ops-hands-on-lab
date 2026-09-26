---
title: インフラ-1 止めずに版を上げる(ローリング更新)
---

# インフラ-1 止めずに版を上げる(ローリング更新)

::: info この演習について
- 所要時間: 約 20 分(本格版もやるなら +20 分)
- 使うもの: 軽量版(docker compose)。ターミナルを 2 つ。本格版(kind)があれば比べられます
- 仕組みはこちら: [仕組み-3 Kubernetes の基本](/how-it-works/03-kubernetes-basics)・[仕組み-2 ingress](/how-it-works/02-ingress-and-endpoints)
- 関係する設計書: [インフラ方式](/design/architecture/03-infrastructure)・[D-INF-01 起動構成(compose と Kubernetes)](/design/detail/D-INF-01-compose-and-k8s)
- 用語集: [ローリング更新](/guide/glossary#rolling-update)・[レプリカ](/guide/glossary#replica)・[readiness プローブ](/guide/glossary#readiness-probe)・[ロールバック](/guide/glossary#rollback)・[穏やかな停止](/guide/glossary#graceful-shutdown)
:::

## 1. この設計書はなぜ必要か

新しい版を出すたびにお店を止めていると、リリースは「夜中の作業」になり、回数も減り、1 回あたりの変更が大きくなって、かえって事故が増えます。

> **よくある事故**: 昼休みに、画面の文言を 1 か所直すだけの軽いリリースをしました。手順は「古い版を止める → 新しい版を起動する」。
> 新しい版の起動には 40 秒かかりました。その間、ちょうど昼休みに買い物をしていたお客様は、真っ白な画面とエラーを見ていました。
> カートに入れていた商品の購入をやめた人も出ました。「止めないと版を上げられない」作りだったことに、誰も疑問を持っていませんでした。

「止めずに入れ替えられるか」は、アプリの作りではなく **台数と入れ替えの順番** で決まります。だからインフラの方式設計書で決めます。

## 2. 何をやっているのか

軽量版(docker compose)では storefront は 1 台だけです。入れ替えは「止める → 起動する」しかできないので、その間お客様はエラーになります。
これを、1 秒に 5 回ほど画面を取り続けながら実際に見ます。

本格版(Kubernetes)では、storefront を 2 台(p1 環境)にしておき、**新しい版を 1 台起動 → 準備ができたと確認(readiness)→ 古い版を 1 台止める** を繰り返します。
これがローリング更新で、お客様からは止まって見えません。

たとえ: **2 車線の道路工事** です。全部の車線を一度に閉めると通行止めになりますが、1 車線ずつ工事して、終わった車線を開けてから次の車線を閉めれば、車は流れ続けます。
「工事が終わった車線を開けてよいか」の確認が readiness(準備ができたか)の検査です。

::: tip CCv2 では
CCv2 の「デプロイ」は、Cloud Portal でビルドを選んで環境に入れる操作です。デプロイの方式には、止めずに入れ替える方式(ローリング)と、止めて入れ替える方式があり、
DB の形を変えるリリースかどうかで選びます。裏では、aspect ごとの Pod がこの演習の本格版と同じように 1 台ずつ入れ替わります。台数は manifest で決まるので、
**1 台の aspect は入れ替えの間に止まる** ことも覚えておきます。
:::

## 3. まず触ってみる

### 軽量版(docker compose)

1. **ターミナル A で、画面を取り続ける**。1 行に「時刻 と 結果の番号 と かかった秒数」が出ます(200 = 成功)。止めるときは Ctrl+C です。

   ```bash
   while true; do
     printf '%s %s\n' "$(date +%H:%M:%S)" "$(curl -s -o /dev/null -w '%{http_code} %{time_total}' --max-time 5 http://www.lab.localhost:18080/login)"
     sleep 0.2
   done
   ```

   `/login` はキャッシュされない画面なので、毎回 cdn-waf → ingress → storefront まで届きます。

2. **ターミナル B で、ふつうに作り直す**(同じ版で「入れ替え」だけをします)。

   ```bash
   docker compose up -d --force-recreate --no-deps storefront
   ```

   このラボの storefront は 1 秒ほどで起動するので、ターミナル A にエラーが出ないこともあります(運が良かっただけです)。
   よく見ると、1 回だけ 1 秒ほど待たされた行があるはずです。

3. **起動に時間がかかる新しい版をまねる**。本物のアプリは、起動に数秒〜数十秒かかるのが普通です。ここでは「止めてから 5 秒後に起動する」ことで、それをまねます。

   ```bash
   docker compose stop storefront; sleep 5; docker compose start storefront
   ```

   ターミナル A を見て、エラーがいつからいつまで出たかを確かめます。

4. **ingress のログを見る**。storefront に届かなかった理由が出ています。

   ```bash
   docker compose logs ingress --no-log-prefix --since 1m | grep 'upstream timed out' | head -2
   docker compose logs storefront --no-log-prefix --since 1m | grep -E 'SIGTERM|started'
   ```

### 本格版では

本格版(kind)では storefront が 2 台(Pod が 2 つ)で動いていて、ローリング更新ができます。
軽量版と同じ 18080 番を使うので、先に軽量版を止めてから起動します(初回は 10〜15 分かかります。詳しくは [準備と起動](/guide/setup))。

```bash
docker compose down
k8s/up.sh
```

1. ターミナル A で取り続けます(`?t=$RANDOM` を付けるのは、cdn-waf のキャッシュに当たらず毎回 storefront まで届くようにするためです)。

   ```bash
   while true; do curl -s -o /dev/null -w '%{http_code}\n' "http://www.lab.localhost:18080/p/100001?t=$RANDOM"; sleep 0.2; done
   ```

2. ターミナル B で Pod の入れ替わりを見ながら、1 台ずつ入れ替えます。

   ```bash
   kubectl -n lab get pods -l app.kubernetes.io/name=storefront -w    # さらに別のターミナルで、Pod の入れ替わりを見続ける
   kubectl -n lab rollout restart deploy/storefront                 # 同じイメージのまま Pod を全部作り直す
   kubectl -n lab rollout status deploy/storefront                  # 「successfully rolled out」で完了
   ```

3. 入れ替えの履歴と、1 つ前の版へ戻す(ロールバック)操作も試します。

   ```bash
   kubectl -n lab rollout history deploy/storefront
   kubectl -n lab rollout undo deploy/storefront
   ```

新しい Pod が 1 つ増え(`maxSurge: 1`)、`READY 1/1` になってから古い Pod が 1 つ `Terminating` になる、をくり返します。
ターミナル A はずっと `200` のままです。止める前の 5 秒待ち(`preStop`)の間に、ingress-nginx が古い Pod を振り分け先から外すためです。
設定は `k8s/generated/base/storefront.yaml`(`strategy` と `preStop`)にあり、manifest.json から [tools/manifest/render.mjs](/how-it-works/12-manifest-and-environments) が作っています。

## 4. 何が見えたら成功か

**手順 2**: 44 回すべて 200。ただし 1 回だけ 1.09 秒かかりました(ほかは 0.02〜0.04 秒)。止まっている間、ingress が新しい storefront を待っていたのです。

```text
10:28:17 200 1.087826      ← この 1 回だけ待たされた
```

**手順 3**: 約 6 秒の間、お客様は 3 秒ずつ待たされたうえに 504(入口が奥に届かず時間切れ)を受け取りました。

```text
10:27:44 200 0.021574
10:27:44 200 0.019821      ← この直後に storefront を止めた(ログにも同じ時刻に received SIGTERM)
10:27:45 504 3.009750      ← 3 秒待たされてからエラー
10:27:48 504 3.013241      ← もう一度 3 秒待たされてエラー
10:27:51 200 0.235509      ← 新しい storefront が起動して回復
10:27:52 200 0.022925
```

数え直すと、約 20 秒間で 200 が 60 回、504 が 2 回でした。回数は少なく見えますが、1 回ごとに 3 秒ずつ待たされています。

**手順 4**: ingress は storefront の住所(172.30.89.14:4000)につなごうとして、3 秒(`proxy_connect_timeout 3s`)であきらめています。
storefront のログの時刻は世界標準時なので、日本時間より 9 時間前に見えます。

```text
[error] 49#49: *188 upstream timed out (110: Operation timed out) while connecting to upstream, client: 127.0.0.1, server: www.lab.localhost, request: "GET /login HTTP/1.1", upstream: "http://172.30.89.14:4000/login", host: "www.lab.localhost"
{"time":"2026-09-26T01:27:44.955Z","service":"storefront","level":"info","msg":"received SIGTERM, shutting down"}
{"time":"2026-09-26T01:27:51.335Z","service":"storefront","level":"info","msg":"storefront started","port":4000,...}
```

**本格版**: Pod が 1 台ずつ入れ替わり、ループは 200 のまま流れ続けます。軽量版の「約 6 秒の 504」との違いが、2 台以上とローリング更新の効き目です。

## 5. ここで覚える言葉

| 言葉 | 一言でいうと | たとえ | この演習で見たもの |
| --- | --- | --- | --- |
| デプロイ | 新しい版を本番に置いて動かすこと | お店の商品棚を新しい物に入れ替える | `docker compose up -d --force-recreate storefront` |
| ダウンタイム | お客様が使えない時間 | 通行止めの時間 | 10:27:45〜10:27:51 の 504 |
| [ローリング更新](/guide/glossary#rolling-update) | 1 台ずつ入れ替えて、全体は止めない | 1 車線ずつの道路工事 | 本格版の `kubectl rollout restart` |
| [レプリカ](/guide/glossary#replica) | 同じアプリを何台並べて動かすか | 同じレジを何台開けるか | 軽量版は 1 台なので入れ替え中に止まる |
| [readiness プローブ](/guide/glossary#readiness-probe) | 「お客様を回してよいか」を確かめる検査 | 工事が終わった車線を開けてよいかの確認 | 本格版で `READY 1/1` になるまで古い Pod が残る |
| 504 / 502 | 入口が奥のサーバーに届かなかった、という応答 | 取り次いだ先が電話に出ない | `upstream timed out` の後の 504 |
| [穏やかな停止](/guide/glossary#graceful-shutdown) | 止める合図を受けたら、受付中の処理を終えてから止まる | 閉店時に、店内のお客様の会計は済ませる | `received SIGTERM, shutting down` |
| [ロールバック](/guide/glossary#rollback) | 1 つ前の版に戻すこと | 工事をやめて元の舗装に戻す | `kubectl -n lab rollout undo deploy/storefront` |

## 6. 設計書ではここに書く

- **[インフラ方式 4.6 止めずに入れ替える](/design/architecture/03-infrastructure#s4-6)**:
  「storefront と api は本番で最低 2 台。ローリング更新で入れ替え、同時に止めてよいのは 1 台まで」「止めてよい時間(ダウンタイム)はゼロ。DB の形を変えるリリースだけは別の手順」と書きます。
- **[インフラ方式 4.4 ヘルスチェックと再起動](/design/architecture/03-infrastructure#s4-4)**: 「新しい台は readiness の検査が通ってからお客様を回す」。検査の URL と、何を見ているか(DB に届くか)。
- **[インフラ方式 5 目標](/design/architecture/03-infrastructure#s5)**: 「リリース中のエラー率は、ふだんと変わらないこと」。
- **[D-INF-01 起動構成 4.3 本格版の Pod](/design/detail/D-INF-01-compose-and-k8s#s4-3)**: レプリカ数、入れ替えの速さ(同時に何台増やす・何台減らす)、readiness と liveness の検査の間隔、止める合図から強制終了までの猶予の秒数。
- **[BE 方式 4.8 穏やかな停止](/design/architecture/02-backend#s4-8)**: 止める合図を受けたら、受付中の処理を終えてから止まる。
- **[障害対応方式 4.2 逃げ道を先に決める](/design/architecture/08-incident-response#s4-2)**: リリースで壊れたときに元の版へ戻す(ロールバック)コマンドと、判断する人。

## 7. レビューで聞く質問

- 「リリースの間、お客様から見て止まる時間はありますか。あるなら何秒で、いつの時間帯にやりますか。」
- 「storefront・api・backoffice・worker はそれぞれ何台で動かしますか。1 台のものは、入れ替えの間どうなりますか。」
- 「新しい版に『お客様を回してよい』と判断するのは何の検査ですか。その検査は DB などにつながったことまで見ていますか。」
- 「止める合図を受けたとき、受付中のリクエストはどうなりますか。何秒待ってから強制的に止めますか。」
- 「新しい版がおかしかったとき、元の版に戻すコマンドと、戻すのにかかる時間は書いてありますか。」

## 8. 片付け

- ターミナル A のループを Ctrl+C で止めます。
- storefront が動いているか確かめます。

```bash
docker compose ps storefront                                                 # (healthy) ならよい
curl -s -o /dev/null -w '%{http_code}\n' http://www.lab.localhost:18080/login   # 200 ならよい
```

本格版で入れ替えを試した場合は、そのままで問題ありません(同じ版に入れ替えただけです)。本格版を終えるときは `k8s/down.sh`、軽量版に戻るときはそのあと `docker compose up -d` です。
