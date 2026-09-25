---
title: DR-1 バックアップから戻す(RTO と RPO を測る)
---

# DR-1 バックアップから戻す(RTO と RPO を測る)

::: info この演習について
- 所要時間: 約 20 分
- 使うもの: 軽量版(docker compose)。`tools/backup.sh`・`tools/restore.sh`、`psql`(db コンテナの中の物を使います)
- 関係する設計書: [DR 方式 4.2 バックアップ](/design/architecture/09-disaster-recovery#s4-2)・[DR 方式 4.3 復元](/design/architecture/09-disaster-recovery#s4-3)・[DR 方式 4.4 RTO と RPO を測る](/design/architecture/09-disaster-recovery#s4-4)・[D-DR-02 バックアップと復元](/design/detail/D-DR-02-backup-restore)
:::

## 1. この設計書はなぜ必要か

「バックアップは取っています」は、「戻せます」とは違います。戻したことが一度も無いバックアップは、無いのと同じです。

> **よくある事故**: 月末の締め作業で、担当者が検証用のつもりで本番の DB につながったまま、条件を付け忘れた削除の命令を実行しました。注文のデータが全部消えました。
> バックアップから戻そうとしたら、①バックアップは 3 か月前から失敗し続けていた、②手順書が無く、戻し方を知る人が休暇中、③やっと戻せたのは 2 日後。
> しかも発注元とは「どれくらいで戻す約束か」「どこまでのデータなら失ってよいか」を一度も話していませんでした。

どれくらいの時間で戻すか(**RTO**)、どの時点まで戻れればよいか(**RPO**)を先に合意し、実際に戻して測る。これを DR(災害からの復旧)の方式設計書に書きます。

## 2. 何をやっているのか

`tools/backup.sh` は DB の中身を丸ごとファイルに書き出します(`pg_dump`)。`tools/restore.sh` はそのファイルから DB を作り直します(`psql`。全部成功するか、何も変えないかのどちらか)。
演習では、①バックアップを取る、②その **後に** 新しい注文が 1 件入る、③うっかり注文を全部消す、④バックアップから戻す、の順に進め、
**戻すのにかかった時間(RTO)** と **失ったデータ(RPO)** を自分で測ります。

たとえ: **ゲームのセーブ** です。こまめにセーブ(バックアップ)していれば、失敗してもセーブした所からやり直せます。
「どこからやり直せるか」(= 最後のセーブ以降の進みは消える)が RPO、「やり直して元の場面に戻るまでの時間」が RTO です。
そして、セーブデータが本当に読み込めるかは、一度読み込んでみないと分かりません。

## 3. まず触ってみる

1. **alice の札を用意し、今の注文を見る**。

   ```bash
   TOKEN=$(curl -s -X POST -H 'Content-Type: application/json' \
     -d '{"username":"alice","password":"password"}' http://localhost:18080/api/login \
     | python3 -c 'import json,sys;print(json.load(sys.stdin)["token"])')
   curl -s -H "Authorization: Bearer $TOKEN" http://localhost:18080/api/me/orders \
     | python3 -c 'import json,sys;print("alice orders:",[o["id"] for o in json.load(sys.stdin)])'
   ```

2. **バックアップを取る**。時刻を控えておきます。

   ```bash
   date +%T; tools/backup.sh
   ```

3. **バックアップの後に、新しい注文が入る**(お客様が買い物をした、のまね)。

   ```bash
   docker compose exec -T db psql -U store -d store \
     -c "INSERT INTO orders (user_id, status, total, created_at) VALUES (1, '準備中', 770, now()) RETURNING id, total, created_at;"
   curl -s -H "Authorization: Bearer $TOKEN" http://localhost:18080/api/me/orders \
     | python3 -c 'import json,sys;print("alice orders:",[o["id"] for o in json.load(sys.stdin)])'
   ```

4. **事故を起こす**。条件(`WHERE`)を付け忘れた削除です。時刻を控えます。**ここからストップウォッチを始めます**。

   ```bash
   date +%T; docker compose exec -T db psql -U store -d store -c "DELETE FROM orders;"
   curl -s -H "Authorization: Bearer $TOKEN" http://localhost:18080/api/me/orders; echo
   ```

5. **戻す**。いちばん新しいバックアップが使われます。`time` で機械の作業時間も測ります。

   ```bash
   time tools/restore.sh
   ```

6. **戻ったことを確かめる**。確かめ終わった時刻で **ストップウォッチを止めます**。

   ```bash
   curl -s -H "Authorization: Bearer $TOKEN" http://localhost:18080/api/me/orders \
     | python3 -c 'import json,sys;print("alice orders:",[o["id"] for o in json.load(sys.stdin)])'
   docker compose exec -T db psql -U store -d store -c 'select count(*) from orders' -c 'select id from orders where id=9'
   date +%T
   ```

7. **RTO と RPO を書き出す**(下の「何が見えたら成功か」の表の形で)。

## 4. 何が見えたら成功か

**手順 2**: バックアップのファイルができます(約 12KB)。

```text
01:17:47
バックアップを取りました: backups/store-20260926-011747.sql (11842 バイト)
```

**手順 3**: バックアップの後に入った注文は 9 番。alice の注文は 4 件になります。

```text
 id | total |          created_at
----+-------+------------------------------
  9 |   770 | 2026-09-25 16:17:47.97427+00
alice orders: [9, 3, 2, 1]
```

**手順 4**: 9 件すべてが消え、alice の注文履歴は空になります。

```text
01:17:48
DELETE 9
[]
```

**手順 5**: 機械の作業(復元)は 1 秒かかりません。

```text
復元します: backups/store-20260926-011747.sql
復元しました。
tools/restore.sh  0.07s user 0.04s system 17% cpu 0.648 total
```

**手順 6**: 注文は戻りましたが、**9 番は戻りません**。バックアップの後に入ったからです。

```text
alice orders: [3, 2, 1]
 count
-------
     8
 id
----
(0 rows)
```

**手順 7**: 記録の例(この演習での実測)。

| 項目 | 値 | 意味 |
| --- | --- | --- |
| 最後のバックアップ | 01:17:47 | ここまでは戻せる |
| 事故 | 01:17:48 | 注文を全部消した |
| 失ったデータ(RPO の実績) | 注文 1 件(9 番、770 円) | バックアップから事故までの 1 秒の間に入った物 |
| 機械の復元時間 | 0.65 秒 | `time tools/restore.sh` |
| 戻るまでの時間(RTO の実績) | 事故の時刻から、手順 6 で確かめ終わった時刻まで | 自分のストップウォッチの値を書く |

この演習ではすぐ隣にコマンドがあるので数十秒で戻せますが、本番の RTO には **気づくまで・判断するまで・手順書を探すまで・戻したデータが正しいか確かめるまで** の時間が全部入ります。
機械の 0.65 秒は、RTO のごく一部にすぎません。一方 RPO は、**バックアップの間隔でほぼ決まります**(1 日 1 回なら、最悪 1 日ぶんの注文を失う)。

## 5. ここで覚える言葉

| 言葉 | 一言でいうと | たとえ | この演習で見たもの |
| --- | --- | --- | --- |
| DR(災害からの復旧) | 大きな事故や災害から、サービスを戻すこと | 火事のあとの営業再開 | 消えた注文を戻した |
| バックアップ | ある時点のデータの写し | ゲームのセーブ | `backups/store-20260926-011747.sql` |
| 復元(リストア) | 写しからデータを戻すこと | セーブデータを読み込む | `tools/restore.sh` |
| RTO(目標復旧時間) | 止まってから戻るまでに許される時間 | やり直して元の場面に戻るまでの時間 | 事故から確かめ終わるまで |
| RPO(目標復旧時点) | どの時点まで戻れればよいか = 失ってよいデータの幅 | 最後のセーブ以降の進みは消える | 注文 9 番が戻らなかった |
| 復元の訓練 | 本当に戻せるかを定期的に試すこと | 避難訓練 | この演習そのもの |

## 6. 設計書ではここに書く

- **[DR 方式 4.1 守る物を決める](/design/architecture/09-disaster-recovery#s4-1)**: 何を守るか(注文・会員は必須、指標やログは失ってよい、など)。
- **[DR 方式 4.2 バックアップ](/design/architecture/09-disaster-recovery#s4-2)**: いつ・どれくらいの間隔で・どこに(別の場所に)・何世代残すか。**失敗したら誰に通知が行くか**。バックアップには会員の情報が入るので、置き場所の権限と暗号化も。
- **[DR 方式 4.3 復元](/design/architecture/09-disaster-recovery#s4-3)・[4.5 訓練](/design/architecture/09-disaster-recovery#s4-5)**: 戻す手順、戻した後の確かめ方、訓練の頻度(例: 四半期に 1 回)。
- **[DR 方式 4.4 RTO と RPO を測る](/design/architecture/09-disaster-recovery#s4-4)・[5 目標](/design/architecture/09-disaster-recovery#s5)**: 発注元と合意した RTO・RPO の数字と、訓練で測った実績。
- **[D-DR-02 バックアップと復元](/design/detail/D-DR-02-backup-restore)**(一般のカタログでは D-DR-02): [4.1 バックアップのオプション](/design/detail/D-DR-02-backup-restore#s4-1)(`--clean` など)、[4.2 復元のオプション](/design/detail/D-DR-02-backup-restore#s4-2)(`ON_ERROR_STOP`、`--single-transaction`)、[4.3 演習の手順と記録](/design/detail/D-DR-02-backup-restore#s4-3)(この演習の表)。訓練の記録は一般のカタログでは D-DR-06 の形で残します。

## 7. レビューで聞く質問

- 「RTO と RPO の数字は、発注元(業務の担当)と合意したものですか。」
- 「バックアップの間隔で、RPO の目標を満たせますか(1 日 1 回なら最悪 1 日ぶんを失います)。」
- 「最後に本番のバックアップから実際に戻してみたのはいつですか。そのとき何分かかりましたか。」
- 「バックアップが失敗したら、誰がどうやって気づきますか。」
- 「バックアップは、元の DB と同じ場所(同じサーバー・同じ建物)に置いていませんか。見られる人は限られていますか。」
- 「戻した後、データが正しいことを何で確かめますか(件数、最後の注文の番号など)。」

## 8. 片付け

戻したので、DB は見本のデータ(注文 8 件)の状態です。バックアップのファイルには会員の情報(パスワードの控え)が入っているので、演習が終わったら消しておきます(`backups/` はリポジトリに入らないようにしてありますが、念のため)。

```bash
docker compose exec -T db psql -U store -d store -c 'select count(*) from orders'   # 8 ならよい
rm -rf backups
unset TOKEN
```
