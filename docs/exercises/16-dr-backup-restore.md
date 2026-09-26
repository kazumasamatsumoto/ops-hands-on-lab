---
title: DR-1 バックアップから戻す(RTO と RPO を測る)
---

# DR-1 バックアップから戻す(RTO と RPO を測る)

::: info この演習について
- 所要時間: 約 15 分
- 使うもの: 軽量版(docker compose)。`curl`、`tools/backup.sh`、`tools/restore.sh`、`psql`
- 仕組みはこちら: [仕組み-10 DB とバックアップ](/how-it-works/10-db-and-backup)
- 関係する設計書: [DR 方式](/design/architecture/09-disaster-recovery)・[D-DR-02 バックアップと復元](/design/detail/D-DR-02-backup-restore)
- 用語集: [バックアップ](/guide/glossary#backup)・[リストア(復元)](/guide/glossary#restore)・[RTO](/guide/glossary#rto)・[RPO](/guide/glossary#rpo)
:::

## 1. この設計書はなぜ必要か

「バックアップは取っている」だけでは、いざというときに戻せません。**戻すのにどれだけ時間がかかるか(RTO)**、**どれだけのデータを失うか(RPO)** を測り、それが合意した範囲に収まるかを確かめておく必要があります。

> **よくある事故**: 毎晩バックアップを取っていました。ある日、運用の担当者が条件を付け忘れて注文テーブルを全部消しました。
> いざ戻そうとすると、そのバックアップは一度も復元を試したことがなく、手順書も古く、戻し終えるまで半日かかりました。
> しかも、最後のバックアップから事故までの半日ぶんの注文は、戻ってきませんでした。

「守る物」「バックアップの取り方・間隔」「戻す手順」「RTO と RPO の目標と実績」を、DR の方式設計書で決め、訓練で確かめます。

## 2. 何をやっているのか

`tools/backup.sh` は DB の中身を丸ごとファイルに書き出します(`pg_dump`)。`tools/restore.sh` はそのファイルから DB を作り直します(`psql`。途中でエラーが出たら止まり、それまでの変更も取り消すので、「半分だけ戻った」状態にはなりません)。
演習では、①バックアップを取る、②その **後に** 新しい注文が 1 件入る、③うっかり注文を全部消す、④バックアップから戻す、の順に進め、
**戻すのにかかった時間(RTO)** と **失ったデータ(RPO)** を自分で測ります。

たとえ: **ゲームのセーブ** です。こまめにセーブ(バックアップ)していれば、失敗してもセーブした所からやり直せます。
「どこからやり直せるか」(= 最後のセーブ以降の進みは消える)が RPO、「やり直して元の場面に戻るまでの時間」が RTO です。
そして、セーブデータが本当に読み込めるかは、一度読み込んでみないと分かりません。

::: tip CCv2 では
CCv2 では DB のバックアップは SAP 側が用意します。案件で決めるのは「どこまで戻せる約束か(RPO)」「戻すのにどれだけかかる約束か(RTO)」と、
自分たちで作った表・データを、その約束の中で戻せるかの確認です。「一度も復元を試していないバックアップは、無いのと同じ」なのはどの環境でも共通です。
:::

## 3. まず触ってみる

1. **alice のトークンを用意し、今の注文を見る**。

   ```bash
   A=http://api.lab.localhost:18080
   TOKEN=$(curl -s $A/authorizationserver/oauth/token \
     -d 'grant_type=password&client_id=storefront&username=alice&password=password' \
     | python3 -c 'import json,sys;print(json.load(sys.stdin)["access_token"])')
   O() { curl -s -H "Authorization: Bearer $TOKEN" $A/occ/v2/samplestore/users/current/orders \
     | python3 -c 'import json,sys;print("alice orders:",[o["code"] for o in json.load(sys.stdin).get("orders",[])])'; }
   O
   ```

2. **バックアップを取る**。時刻を控えておきます。

   ```bash
   date +%T; tools/backup.sh
   ```

3. **バックアップの後に、新しい注文が入る**(お客様が買い物をした、のまね)。

   ```bash
   docker compose exec -T db psql -U store -d store \
     -c "INSERT INTO orders (code, user_id, status, total, placed) VALUES ('00001009', 1, 'PROCESSING', 770, now()) RETURNING code, total, placed;"
   O
   ```

4. **事故を起こす**。条件(`WHERE`)を付け忘れた削除です。時刻を控えます。**ここからストップウォッチを始めます**。

   ```bash
   date +%T; docker compose exec -T db psql -U store -d store -c "DELETE FROM orders;"
   curl -s -H "Authorization: Bearer $TOKEN" $A/occ/v2/samplestore/users/current/orders; echo
   ```

5. **戻す**。いちばん新しいバックアップが使われます。`time` で機械の作業時間も測ります。

   ```bash
   time tools/restore.sh
   ```

6. **戻ったことを確かめる**。確かめ終わった時刻で **ストップウォッチを止めます**。

   ```bash
   O
   docker compose exec -T db psql -U store -d store -c 'select count(*) from orders' -c "select code from orders where code='00001009'"
   date +%T
   ```

7. **RTO と RPO を書き出す**(下の「何が見えたら成功か」の表の形で)。

## 4. 何が見えたら成功か

**手順 2**: バックアップのファイルができます(見本データが入っているので約 44KB)。

```text
11:16:32
バックアップを取りました: backups/store-20260926-111632.sql (44198 バイト)
```

**手順 3**: バックアップの後に入った注文は `00001009`。alice の注文は 4 件になります。

```text
   code   | total |            placed
----------+-------+-------------------------------
 00001009 |   770 | 2026-09-26 02:16:32.574062+00
alice orders: ['00001009', '00001003', '00001002', '00001001']
```

**手順 4**: 全件が消え、alice の注文履歴は空になります。

```text
11:16:32
DELETE 9
{"orders":[],"pagination":{...,"totalResults":0}}
```

**手順 5**: 機械の作業(復元)は 1 秒かかりません。

```text
復元します: backups/store-20260926-111632.sql
復元しました。
tools/restore.sh  0.05s user 0.02s system 52% cpu 0.144 total
```

**手順 6**: 注文は戻りましたが、**`00001009` は戻りません**。バックアップの後に入ったからです。

```text
alice orders: ['00001003', '00001002', '00001001']
 count
-------
     8
 code
------
(0 rows)
```

**手順 7**: 記録の例(この演習での実測)。

| 項目 | 値 | 意味 |
| --- | --- | --- |
| 最後のバックアップ | 11:16:32 | ここまでは戻せる |
| 事故 | 11:16:32 | 注文を全部消した |
| 失ったデータ(RPO の実績) | 注文 1 件(`00001009`、770 円) | バックアップから事故までの間に入った物 |
| 機械の復元時間 | 0.14 秒 | `time tools/restore.sh` |
| 戻るまでの時間(RTO の実績) | 事故の時刻から、手順 6 で確かめ終わった時刻まで | 自分のストップウォッチの値を書く |

この演習ではすぐ隣にコマンドがあるので数十秒で戻せますが、本番の RTO には **気づくまで・判断するまで・手順書を探すまで・戻したデータが正しいか確かめるまで** の時間が全部入ります。
機械の 0.14 秒は、RTO のごく一部にすぎません。一方 RPO は、**バックアップの間隔でほぼ決まります**(1 日 1 回なら、最悪 1 日ぶんの注文を失う)。

## 5. ここで覚える言葉

| 言葉 | 一言でいうと | たとえ | この演習で見たもの |
| --- | --- | --- | --- |
| [バックアップ](/guide/glossary#backup) | 中身を丸ごと別に取っておく | ゲームのセーブ | `tools/backup.sh`(pg_dump) |
| [リストア(復元)](/guide/glossary#restore) | バックアップから元に戻す | セーブから再開 | `tools/restore.sh`(psql) |
| [RTO](/guide/glossary#rto) | 戻すのにかかる時間の目標 | 再開までにかかる時間 | 事故からの実測時間 |
| [RPO](/guide/glossary#rpo) | どこまで戻せるか(失うデータの量)の目標 | どのセーブ地点まで戻るか | 失った注文 1 件 |
| 復元の訓練 | 実際に戻してみて、戻せることを確かめる | セーブが本当に読めるか試す | この演習そのもの |
| 間隔 | どれくらいの頻度でバックアップを取るか | 何分ごとにセーブするか | RPO は間隔でほぼ決まる |

## 6. 設計書ではここに書く

- **[DR 方式 4.1 守る物を決める](/design/architecture/09-disaster-recovery#s4-1)・[4.2 バックアップ](/design/architecture/09-disaster-recovery#s4-2)・[4.3 復元](/design/architecture/09-disaster-recovery#s4-3)**: 守る物(DB `store`)、取り方、間隔、置き場所、戻す手順。
- **[DR 方式 4.4 RTO と RPO を測る](/design/architecture/09-disaster-recovery#s4-4)・[4.5 訓練](/design/architecture/09-disaster-recovery#s4-5)**: 目標値と、訓練で測った実績。
- **[D-DR-02 4.3 演習の手順と記録](/design/detail/D-DR-02-backup-restore#s4-3)・[4.4 守る物と守らない物](/design/detail/D-DR-02-backup-restore#s4-4)**: 記録の形、戻す物と戻さない物(作り直せる物は戻さない)。

## 7. レビューで聞く質問

- 「守るデータは何ですか。それはどれくらいの間隔でバックアップしていますか。」
- 「そのバックアップから、実際に戻す訓練をしたことがありますか。何分かかりましたか。」
- 「RTO(戻すまでの時間)と RPO(失うデータ)の目標はいくつですか。実測はいくつでしたか。」
- 「RTO には、気づく・判断する・手順を探す・確かめる時間まで含めていますか。」
- 「バックアップの後に入ったデータ(RPO ぶん)は、どう扱いますか。二重に取る仕組みはありますか。」

## 8. 片付け

DB は元の見本データに戻っています。バックアップのファイルは手元にだけ残ります(`.gitignore` に入っているのでリポジトリには入りません)。

```bash
ls backups/                 # 取ったファイルが見える
unset TOKEN A
```

演習で取ったバックアップを消したいときは `rm backups/store-*.sql`、DB をまっさらにしたいときは `docker compose down -v` です。
