---
title: 仕組み-10 DB とバックアップ(表・接続・RTO と RPO)
---

# 仕組み-10 DB とバックアップ(表・接続・RTO と RPO)

::: tip このページで分かること
- DB(PostgreSQL)にどんな表があり、どの部品がどの表を読み書きするか。
- 接続の「プール」の仕組みと、DB が止まったときの api の動き(`/readyz` が 503 になる理由)。
- `pg_dump` でのバックアップと `psql` での復元が、中で何をしているか。
- RTO(どれだけで戻すか)と RPO(どこまでのデータを失ってよいか)の測り方。
:::

## 1. 一言でいうと {#s1}

DB はお店の **倉庫** です。商品・会員・注文・CMS の部品・トークンが、表(テーブル)に 1 行ずつ入っています。
api・backoffice・worker は同じ倉庫を使い、決まった数の **通路(接続)** を使い回して出し入れします。
バックアップは **倉庫の中身の写真** で、火事(障害・操作ミス)のあとに、写真の時点まで戻せます。

**たとえ: 倉庫と台車**

- 接続のプール … 倉庫の入口に置いた台車 10 台。毎回台車を作ると時間がかかるので、使い終わったら戻して使い回す。台車が全部出払っていたら、3 秒だけ待って、だめならあきらめる。
- `/readyz` … 「倉庫に行けます」の札。倉庫の扉が閉まっている(DB が止まっている)ときは札を下ろし、お客さんを回してもらわない。
- バックアップ … 倉庫の中身をまるごと写真に撮る。写真を撮ってから火事までの間に入った荷物は、写真には写っていない(= RPO)。
- 復元 … 写真を見ながら倉庫を元に戻す。戻し終わるまでの時間 = RTO。

## 2. 1 リクエストの流れ {#s2}

### 2.1 api が DB を使う 1 回 {#s2-1}

```text
 GET /occ/v2/samplestore/products/100001
   api
   ① プールから接続を 1 本借りる        空きが無ければ待つ(最大 3000 ms。超えたらエラー → 500)
   ② SQL を送る                          SELECT … FROM products p JOIN categories c … WHERE p.code = $1
                                         5000 ms を超える SQL は DB が打ち切る(statement_timeout)
   ③ 行を受け取り、接続をプールに返す
   ④ JSON にして返す
```

### 2.2 DB が止まったとき {#s2-2}

```text
 db が止まる
   api の /readyz   → SELECT 1 が失敗 → 503 {"status":"not_ready","reason":"db_unreachable"}
   本格版           → readinessProbe が 3 回続けて失敗 → READY 0/1 → Service の振り分け先から外れる
                      (livenessProbe の /healthz は DB を見ないので、再起動はされない)
   軽量版           → docker compose ps で (unhealthy)
   待機中の接続     → DB から切られた知らせを受け取り、ログに残すだけ(プロセスは落ちない)
 db が戻る
   次のリクエストで接続を作り直す → /readyz が 200 に戻る → 自然に振り分け先に戻る
```

### 2.3 バックアップと復元 {#s2-3}

```text
 tools/backup.sh
   docker compose exec -T db pg_dump -U store -d store --clean --if-exists --no-owner
     → 「表を消す(もしあれば)→ 表を作る → 行を入れる」SQL の台本を 1 つのファイルに書き出す
     → backups/store-年月日-時分秒.sql

 tools/restore.sh [ファイル]
   docker compose exec -T db psql -U store -d store -v ON_ERROR_STOP=1 --single-transaction -q < ファイル
     → 台本を上から実行。途中で 1 つでも失敗したら全部取り消す(中途半端な状態で「成功」と言わない)
```

## 3. 設定の読み方 {#s3}

### 3.1 表 {#s3-1}

表は api が起動するときに作ります([apps/api/src/db.js](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/apps/api/src/db.js) の `SCHEMA`)。

| 表 | 中身 | 読む・書く部品 |
| --- | --- | --- |
| `categories` | 分類(`stationery`・`kitchen`・`living`・`digital`) | api |
| `products` | 商品 30 件(コード `100001`〜`100030`、価格、在庫) | api が読む / backoffice が価格・在庫を書く / worker が在庫を書く |
| `users` | 会員 3 人(`alice`・`bob`・`carol`。パスワードは scrypt の指紋) | api |
| `orders`・`order_entries` | 注文 8 件と、その明細 | api |
| `oauth_access_tokens` | トークンの SHA-256・持ち主・期限 | api |
| `cms_pages`・`cms_slots`・`cms_slot_components`・`cms_components` | 画面の設計図(ページ・枠・並び・部品) | api が読む / backoffice がバナーを書く |
| `backoffice_sessions` | 管理画面のログイン状態 | backoffice |

```sql
CREATE TABLE IF NOT EXISTS products (
  code            TEXT PRIMARY KEY,          -- 商品コード(例: 100001)
  ...
  price           INTEGER NOT NULL,          -- 円(税込)
  stock           INTEGER NOT NULL,
  classifications JSONB NOT NULL DEFAULT '[]',
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

- `IF NOT EXISTS` … 何度起動しても、あれば作らない(何度やっても同じ結果になる作り)。
- `PRIMARY KEY` … 1 行を 1 つに決める列。
- `JSONB` … JSON をそのまま入れられる列。CMS の部品の属性もこれです。

```js
    await client.query('SELECT pg_advisory_lock(424242)');
```

- api を 2 台同時に起動しても、表を作るのは 1 台だけにするための「合図の旗」(アドバイザリロック)です。先に旗を取った台が作り、もう 1 台は旗が空くのを待ちます。

### 3.2 接続のプール {#s3-2}

```js
const pool = new pg.Pool({
  host: process.env.PGHOST ?? 'db',
  ...
  max: Number(process.env.PG_POOL_MAX ?? 10),
  connectionTimeoutMillis: 3000,
  statement_timeout: 5000,
});

pool.on('error', (err) => {
  log.error({ err: err.message }, 'DB との接続が切れました');
});
```

- `max` … 1 つのプロセスが同時に持つ接続の上限(既定 10)。**台数 × max** が DB 全体の接続の数になるので、台数を増やすときは DB の上限と見比べます(PostgreSQL の既定の上限は 100)。
- `connectionTimeoutMillis: 3000` … 接続を借りるのに 3 秒以上かかったらあきらめます。DB が止まったときに api が固まり続けないためです。
- `statement_timeout: 5000` … 5 秒以上かかる SQL は DB に打ち切らせます。
- `pool.on('error', ...)` … 待機中の接続が切られた知らせを受け取ります。受け取らないと、Node.js は「誰も受け取らないエラー」としてプロセスごと落ちてしまいます。

### 3.3 準備の確認(readyz)と DB の見回り {#s3-3}

[apps/api/src/http-common.js](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/apps/api/src/http-common.js):

```js
  app.get('/readyz', async (req, res) => {
    if (!started) {
      res.status(503).json({ status: 'not_ready', reason: 'starting' });
      return;
    }
    try {
      await pool.query('SELECT 1');
      res.json({ status: 'ready' });
    } catch (err) {
      res.status(503).json({ status: 'not_ready', reason: 'db_unreachable' });
    }
  });
```

- 起動の準備が終わるまでは `starting` で 503、DB に `SELECT 1` が通らなければ `db_unreachable` で 503。
- `/healthz` は DB を見ません(DB が止まっても api を再起動させないため。[仕組み-3](./03-kubernetes-basics))。

DB 自体の見回りは [docker-compose.yml](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/docker-compose.yml) にあります。

```yaml
    volumes:
      - db-data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U store -d store"]
      interval: 5s
```

- `db-data` … データを置く Docker のボリューム。`docker compose down` では消えず、`down -v` で消えます。
- `pg_isready` … DB が接続を受け付けるかを 5 秒ごとに確かめます。api などは `depends_on: condition: service_healthy` で、これが通るまで起動を待ちます。

### 3.4 バックアップと復元のスクリプト {#s3-4}

[tools/backup.sh](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/tools/backup.sh):

```bash
file="backups/store-$(date +%Y%m%d-%H%M%S).sql"
docker compose exec -T db pg_dump -U store -d store --clean --if-exists --no-owner > "$file"
```

- `-T` … 端末を割り当てない(出力をファイルにそのまま流すため)。
- `--clean --if-exists` … 台本の最初に「あれば消す」を入れます。復元のとき、今ある表を消してから作り直す形になります。
- `--no-owner` … 表の持ち主の情報を入れない(別の DB ユーザーでも戻せるように)。

[tools/restore.sh](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/tools/restore.sh):

```bash
docker compose exec -T db psql -U store -d store -v ON_ERROR_STOP=1 --single-transaction -q < "$file" > /dev/null
```

- `ON_ERROR_STOP=1` … エラーが出たらそこで止める。
- `--single-transaction` … 全部成功するか、何も変えないかのどちらか。

## 4. 確かめるコマンド {#s4}

```bash
# 表の一覧と件数
docker compose exec db psql -U store -d store -c '\dt'
docker compose exec db psql -U store -d store -c 'SELECT count(*) FROM products;'     # → 30

# 今の接続の数(api・backoffice・worker のプールが持っている分)
docker compose exec db psql -U store -d store -c "SELECT usename, state, count(*) FROM pg_stat_activity WHERE datname='store' GROUP BY 1,2;"

# DB を止める → api の /readyz が 503、/healthz は 200 のまま
docker compose stop db
docker compose exec api curl -s http://127.0.0.1:3001/readyz; echo    # → {"status":"not_ready","reason":"db_unreachable"}
docker compose exec api curl -s http://127.0.0.1:3001/healthz; echo   # → {"status":"ok"}
docker compose start db
# しばらくで /readyz が {"status":"ready"} に戻る

# バックアップ → わざと壊す → 復元(RTO を測る)
tools/backup.sh
# → バックアップを取りました: backups/store-20260926-101500.sql (… バイト)
docker compose exec db psql -U store -d store -c "UPDATE products SET price = 1;"   # わざとの操作ミス
time tools/restore.sh                                                               # real の時間 = 復元にかかった時間
docker compose exec db psql -U store -d store -c "SELECT code, price FROM products ORDER BY code LIMIT 3;"
```

**RTO と RPO の測り方**

| 言葉 | 一言 | ラボで測るもの |
| --- | --- | --- |
| RTO(目標復旧時間) | 止まってから、どれだけの時間で戻すか | 「壊れたと気付いた時刻」から「画面が正しく出た時刻」まで。`time tools/restore.sh` はその一部(作業の時間) |
| RPO(目標復旧時点) | どの時点のデータまで戻れればよいか(失ってよいデータの量) | 「最後のバックアップの時刻」から「壊れた時刻」まで。その間の注文や在庫の変化は戻らない |

たとえば 1 日 1 回のバックアップなら、RPO は最悪 1 日です。「1 日分の注文が消えてもよいか」を業務の人と決め、足りなければバックアップを増やすか、別の仕組み(DB の変更の記録を続けて取る方式)を使います。

::: details 本格版(Kubernetes)では
DB は StatefulSet `db`(Pod の名前は `db-0`)として動き、データは PersistentVolumeClaim(保存場所の予約票)に置きます([k8s/platform/db.yaml](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/k8s/platform/db.yaml))。バックアップは Pod の中の `pg_dump` を呼びます。
```bash
mkdir -p backups
kubectl -n lab exec -i db-0 -- pg_dump -U store -d store --clean --if-exists --no-owner > backups/store-k8s.sql
kubectl -n lab exec -i db-0 -- psql -U store -d store -v ON_ERROR_STOP=1 --single-transaction -q < backups/store-k8s.sql > /dev/null
```
本格版用のバックアップ・復元のスクリプトはありません(`tools/backup.sh`・`tools/restore.sh` は軽量版の `docker compose exec` 用です)。上の 2 行を手で打ちます。1 行目がバックアップ、2 行目が復元で、中身は軽量版のスクリプトと同じ `pg_dump`・`psql` です。`k8s/down.sh` はクラスタごと保存場所も消すので、残したいデータは先に手元(`backups/`)に取っておきます。
:::

## 5. CCv2 / Composable Storefront ではどこに当たるか {#s5}

| ラボ | CCv2 で当たるもの |
| --- | --- |
| PostgreSQL(db) | CCv2 が用意するデータベース(クラウドの管理された DB。利用者はサーバーを持たない) |
| 表を api の起動時に作る | デプロイのときの「DB の初期化・更新」(データを消して作り直す / 型の変更だけ入れる / 何もしない、を選ぶ) |
| `PG_POOL_MAX`・`connectionTimeoutMillis` | 接続プールの設定(プロパティで決める。台数 × 上限と、DB 側の上限を見比べるのは同じ) |
| `tools/backup.sh`(`pg_dump`) | Cloud Portal のバックアップ(DB とメディアをまとめて取る。定期の自動バックアップもある) |
| `tools/restore.sh` | Cloud Portal の復元(別の環境に戻すこともできる。戻す前に「何を失うか」を確かめる) |
| RTO・RPO | SAP との契約・運用の取り決めと、案件の DR 設計で決める目標値 |
| `/readyz` が DB を見る | CCv2 の aspect の準備確認(SAP 側の仕組み) |

## 6. よくある誤解 {#s6}

- **「接続の上限は大きいほど速い」** → 上限を上げても、DB の CPU やディスクが追いつかなければ遅くなるだけです。台数 × 上限が DB の上限を超えると、接続そのものが断られます。
- **「DB が止まったら、api を再起動すれば直る」** → 直りません。api は DB が戻るのを待ち、`/readyz` で「今は受けられない」と伝えるのが正しい動きです。
- **「バックアップを取っている = 戻せる」** → 戻せるかどうかは、実際に戻してみないと分かりません。復元の練習と、かかった時間(RTO)の計測までが 1 セットです。
- **「バックアップがあれば、データは 1 件も失わない」** → 最後のバックアップより後の変更は失います(RPO)。どこまで失ってよいかは業務の人と決めることです。
- **「`docker compose down` でデータが消える」** → `down` ではボリュームは残ります。消えるのは `down -v` です(本格版はクラスタを消すと消えます)。

## 7. 関係する演習と設計書 {#s7}

- 演習: [DR-1 バックアップから戻す(RTO と RPO を測る)](/exercises/16-dr-backup-restore)・[インフラ-1 止めずに版を上げる](/exercises/05-infra-rolling-update)・[性能-2 台数を増やして耐える](/exercises/13-perf-scale-out)
- 設計書: [DR 方式 4.1 守る物を決める](/design/architecture/09-disaster-recovery#s4-1)・[4.2 バックアップ](/design/architecture/09-disaster-recovery#s4-2)・[4.3 復元](/design/architecture/09-disaster-recovery#s4-3)・[4.4 RTO と RPO を測る](/design/architecture/09-disaster-recovery#s4-4)・[4.6 作り直せる物(検索の索引)](/design/architecture/09-disaster-recovery#s4-6)・[BE 方式 4.7 DB への接続](/design/architecture/02-backend#s4-7)・[性能方式 4.6 DB の接続の上限](/design/architecture/07-performance#s4-6)・[D-DR-02 バックアップと復元](/design/detail/D-DR-02-backup-restore)
- 前後のページ: [仕組み-9 検索と Solr](./09-search-solr) ・ [仕組み-11 観測](./11-observability)
