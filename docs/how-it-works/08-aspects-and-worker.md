---
title: 仕組み-8 aspect と worker(1 つのイメージを 3 つの役で使う)
---

# 仕組み-8 aspect と worker(1 つのイメージを 3 つの役で使う)

::: tip このページで分かること
- 同じイメージ(`lab/api:local`)が、環境変数 `ASPECT` だけで api・backoffice・worker に分かれる仕組み。
- 起動の順番(表を作るのは api だけ・ほかは待つ)と、`/readyz` の関係。
- worker(backgroundProcessing)の定期ジョブ 2 本と、その見張り方(指標とアラート)。
- CCv2 の aspect と backgroundProcessing が何をする所か。
:::

## 1. 一言でいうと {#s1}

api・backoffice・worker は、**中身は同じプログラム** です。起動するときに `ASPECT` という名札を付けて、「あなたは受付」「あなたは事務」「あなたは倉庫」と役を決めます。

**たとえ: 同じ制服の店員と名札**

| `ASPECT` | 名札 | 仕事 | 外から来られるか |
| --- | --- | --- | --- |
| `api` | レジ係 | お客さんの注文を受ける(OCC 風の API・トークン・画像) | `api.lab.localhost`(誰でも) |
| `backoffice` | 事務係 | 社員が価格・在庫・バナーを直す管理画面 | `backoffice.lab.localhost`(社内の IP だけ) |
| `backgroundProcessing` | 倉庫係 | お客さんと話さず、決まった時間ごとに裏の仕事(定期ジョブ) | 来られない(外に出さない) |

中身が同じなので、作る・配る・脆弱性を直すのは 1 回で済みます。役ごとに台数やメモリを別々に決められるので、「お客さんが増えたらレジ係だけ増やす」ができます。

## 2. 1 リクエストの流れ {#s2}

### 2.1 起動の流れ(3 つとも同じ入口) {#s2-1}

```text
 node --require ./src/otel.js src/main.js      (Dockerfile の CMD。3 役とも同じ)
   ① ASPECT を読む          api / backoffice / backgroundProcessing のどれか。違えば止まる
   ② 役の部品を読む          ./aspects/api.js / backoffice.js / worker.js
   ③ 待ち受けを始める        :3001。/healthz はすぐ 200、/readyz は準備ができるまで 503
   ④ DB を待つ
        api        … 表を作り、空なら見本データを入れる(同時に 2 台起動しても 1 台だけがやる = アドバイザリロック)
        ほかの 2 つ … api が表を作り終えるまで 2 秒ごとに確かめる(最大 60 回 ≒ 2 分)
   ⑤ 定期ジョブを始める      worker だけ
   ⑥ 準備完了                /readyz が 200 → compose の healthy / Kubernetes の READY 1/1
```

### 2.2 worker の定期ジョブ 1 回の流れ {#s2-2}

```text
 60 秒ごと(CRON_INTERVAL_SECONDS)に、ジョブごとに:
   ① 前の回がまだ動いていたら、今回は飛ばす(同じジョブを重ねて動かさない)
   ② カオス cronFail が true なら、わざと失敗
   ③ ジョブ本体
        stockImportJob … ランダムな 5 商品の在庫を -3〜+5 動かす(基幹システムからの在庫の取り込みの代わり)
        searchIndexJob … SEARCH_PROVIDER=solr なら DB の全商品で Solr の索引を作り直す / db なら何もせず成功
   ④ 結果を記録
        指標  cronjob_runs_total{job,result} を +1
              成功なら cronjob_last_success_timestamp_seconds{job} = 今の時刻
              cronjob_duration_seconds{job} にかかった時間
        ログ  {"job":"stockImportJob","result":"success","updated":5,…}
        トレース  1 回 = 1 本の道筋(本格版)
   ⑤ Prometheus が 5 秒ごとに /metrics を集め、「最後の成功から 5 分以上」で CronJobStale を鳴らす
```

ジョブが止まっても **画面は普通に動き続けます**。在庫や検索結果が少しずつ古くなるだけなので、指標で見張らないと気付けません(「気付きにくい障害」)。

## 3. 設定の読み方 {#s3}

### 3.1 役を選ぶ所 {#s3-1}

ファイル: [apps/api/src/main.js](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/apps/api/src/main.js)

```js
const ASPECTS = new Set(['api', 'backoffice', 'backgroundProcessing']);
const aspect = process.env.ASPECT ?? 'api';
...
  const mod = require(aspect === 'api' ? './aspects/api' : aspect === 'backoffice' ? './aspects/backoffice' : './aspects/worker');
  listen(mod.build(), PORT, { otel: Boolean(process.env.OTEL_EXPORTER_OTLP_ENDPOINT) }, async () => mod.stopJobs?.());
  await waitForDatabase(aspect);
  mod.startJobs?.();
  markReady();
```

- `ASPECTS` … 使ってよい役の名前。書き間違えたら起動を止めます(黙って別の役で動くより安全)。
- `require(...)` … 役ごとの部品だけを読み込みます。
- `listen(...)` … 先に待ち受けを始めます。準備が終わるまでは `/readyz` が 503 なので、振り分け先に入りません。
- `mod.startJobs?.()` … `?.` は「その関数があれば呼ぶ」。定期ジョブを持つのは worker だけです。
- `markReady()` … ここで初めて `/readyz` が 200 になります。

### 3.2 compose で役を分ける所 {#s3-2}

ファイル: [docker-compose.yml](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/docker-compose.yml)

```yaml
x-aspect-common: &aspect-common
  build: ./apps/api
  image: lab/api:local
  depends_on:
    db:
      condition: service_healthy
  restart: unless-stopped
...
  worker:
    <<: *aspect-common
    environment:
      <<: *db-env
      ASPECT: backgroundProcessing
      CRON_INTERVAL_SECONDS: ${CRON_INTERVAL_SECONDS:-60}
      CHAOS_CRON_FAIL: ${CHAOS_CRON_FAIL:-false}
    mem_limit: 192m
```

- `x-aspect-common: &aspect-common` … 3 役に共通の部分に `&` で名前を付けます(YAML のアンカー)。
- `<<: *aspect-common` … その共通部分をここに差し込みます。3 役とも同じイメージ `lab/api:local` です。
- `ASPECT: backgroundProcessing` … この 1 行だけで worker になります。
- `CRON_INTERVAL_SECONDS` … ジョブの間隔(秒)。既定 60。
- `mem_limit` … api は 256m、backoffice と worker は 192m。役ごとに大きさを変えられます。
- worker には `ports` も、ingress の `server { }` もありません。外からは届きません。

### 3.3 定期ジョブと指標 {#s3-3}

ファイル: [apps/api/src/aspects/worker.js](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/apps/api/src/aspects/worker.js)

```js
const INTERVAL_SECONDS = Math.max(Number(process.env.CRON_INTERVAL_SECONDS ?? 60) || 60, 1);

const runs = new client.Counter({
  name: 'cronjob_runs_total',
  labelNames: ['job', 'result'],
  ...
});
const lastSuccess = new client.Gauge({
  name: 'cronjob_last_success_timestamp_seconds',
  labelNames: ['job'],
  ...
});
```

- `cronjob_runs_total{job,result}` … 動かした回数(Counter = 増えるだけの数)。`result` は `success` か `failure`。
- `cronjob_last_success_timestamp_seconds{job}` … 最後に成功した時刻(Gauge = 上下する数)。worker が起動した時刻から始まるので、起動直後にアラートが鳴ることはありません。

```js
function startJobs() {
  const now = Date.now() / 1000;
  for (const name of Object.keys(JOBS)) {
    runs.inc({ job: name, result: 'success' }, 0);
    runs.inc({ job: name, result: 'failure' }, 0);
    lastSuccess.set({ job: name }, now);
    setTimeout(() => runJob(name), 1000).unref();
    timers.push(setInterval(() => runJob(name), INTERVAL_SECONDS * 1000));
  }
}
```

- `inc(..., 0)` … 0 回の行を最初から出しておきます(グラフやアラートの式で「まだ無い」を扱わなくて済むように)。
- `setTimeout(..., 1000)` … 起動 1 秒後に 1 回目を動かします。
- `setInterval(..., INTERVAL_SECONDS * 1000)` … その後は間隔ごとに動かします。

Prometheus は worker の指標を `honor_labels: true` で集めます([observability/prometheus/prometheus.yml](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/observability/prometheus/prometheus.yml))。アプリが付けた `job="stockImportJob"` を、Prometheus が自分で付ける `job="worker"` で上書きしないための指定です。

アラート([observability/prometheus/rules/slo-alerts.yml](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/observability/prometheus/rules/slo-alerts.yml)):

```yaml
      - alert: CronJobStale
        expr: time() - cronjob_last_success_timestamp_seconds > 300
```

- 「今の時刻 − 最後に成功した時刻」が 300 秒(5 分)を超えたら鳴ります。失敗し続けても、止まってしまっても、どちらでも鳴ります。
- ほかに、失敗が半分を超えたら `CronJobFailureRatioHigh`、演習用に 1 分で鳴る `CronJobStaleDemo` があります。

## 4. 確かめるコマンド {#s4}

```bash
# 同じイメージで 3 つの役が動いている
docker compose ps api backoffice worker
docker compose exec worker printenv ASPECT          # → backgroundProcessing

# 起動の順番(api が表を作り、ほかは待つ)をログで見る
docker compose logs backoffice | grep -E 'DB の準備を待って|準備ができました' | head

# worker のジョブが 60 秒ごとに成功している
docker compose logs --tail=10 worker | grep ジョブ

# worker の指標(外には出していないので中から見る)
docker compose exec worker curl -s http://127.0.0.1:3001/metrics | grep -E '^cronjob_(runs_total|last_success)'
# → cronjob_runs_total{job="stockImportJob",result="success"} 12
#   cronjob_runs_total{job="stockImportJob",result="failure"} 0
#   cronjob_last_success_timestamp_seconds{job="stockImportJob"} 1790000000.123

# worker には入口(ホスト名)が無い → cdn-waf が「このホスト名は使っていません」の 404
curl -s -o /dev/null -w '%{http_code}\n' -H 'Host: worker.lab.localhost' http://www.lab.localhost:18080/
# → 404

# ジョブを全部失敗させ、間隔を 10 秒に縮める → 1〜2 分で CronJobStaleDemo、5〜6 分で CronJobStale
CHAOS_CRON_FAIL=true CRON_INTERVAL_SECONDS=10 docker compose up -d worker
# pager(http://localhost:19094)と Grafana の「worker(定期ジョブ)」の段で様子を見る
# 片付け(つまみを書かずに起動し直すと既定値に戻る)
docker compose up -d worker

# 動かしたまま切り替えるなら
tools/chaos.sh worker set cronFail=true
tools/chaos.sh worker reset
```

::: details 本格版(Kubernetes)では
aspect ごとに Deployment が 1 つずつできます(`api`・`backoffice`・`worker`)。ラベル `lab/aspect` で役が分かります。
```bash
kubectl -n lab get deploy -L lab/aspect
kubectl -n lab get pods -l lab/aspect=backgroundProcessing
kubectl -n lab logs deploy/worker --tail=10
```
本格版の worker は `SEARCH_PROVIDER=solr` なので、`searchIndexJob` が毎回 Solr の索引を作り直します([仕組み-9](./09-search-solr))。
カオスの切り替えは `k8s/chaos.sh` です(対象の **全部の Pod** に同じ指示を送ります)。
```bash
k8s/chaos.sh worker set cronFail=true                             # 動かしたまま切り替える
k8s/chaos.sh worker boot cronFail=true cronIntervalSeconds=10     # 起動時の値を変える(Pod が作り直される。アラートの演習)
k8s/chaos.sh worker boot-reset                                    # 元に戻す
```
最初の引数で対象(`api`・`backoffice`・`worker`。省くと `api`)を選び、続けて `status`・`set 名前=値`・`reset`・`boot 名前=値`・`boot-reset` のどれかを書きます。`set` は動いている Pod だけ(作り直すと戻る)、`boot` は Deployment の環境変数を変えるので Pod が作り直されても残ります。
:::

## 5. CCv2 / Composable Storefront ではどこに当たるか {#s5}

| ラボ | CCv2 で当たるもの |
| --- | --- |
| `ASPECT` | aspect(同じビルドを、役ごとに設定を変えて動かす単位) |
| `ASPECT=api` | api aspect(OCC・OAuth などの REST API を出す) |
| `ASPECT=backoffice` | backoffice aspect(Backoffice の管理画面。社内の IP だけに絞ることが多い) |
| `ASPECT=backgroundProcessing` | backgroundProcessing aspect(CronJob・インポート・索引作りなど、お客さんと話さない裏の仕事。外にエンドポイントを出さない) |
| manifest.json の `aspects[]` | CCv2 の manifest.json の aspect ごとの設定(プロパティ・Web アプリの並び) |
| `stockImportJob`・`searchIndexJob` | CronJob(定期ジョブ)。在庫の取り込みや Solr の索引の全件・差分の作り直しなど |
| `cronjob_last_success_timestamp_seconds` と `CronJobStale` | Backoffice で見る CronJob の結果(成功・失敗・最終実行)と、それを見張る監視 |
| 表を作るのは api だけ | CCv2 ではデプロイのときに DB の初期化・更新を 1 回だけ行い、各 aspect はそれを使う |

## 6. よくある誤解 {#s6}

- **「役ごとに別のプログラムを作る」** → 同じイメージです。違うのは環境変数と、台数・メモリ・外への出し方だけです。
- **「worker が止まれば、画面がエラーになるので気付ける」** → 画面は動き続けます。在庫や検索が古くなるだけなので、「最後の成功からの時間」を見張らないと気付けません。
- **「ジョブが失敗したら鳴らす、だけで十分」** → プロセスごと止まったら「失敗」の記録すら出ません。「最後の成功が古い」で見るのは、そのためです。
- **「worker も api と同じく外から叩ける」** → worker には入口(エンドポイント)がありません。見る口は `/healthz` と `/metrics` だけで、中から見ます。
- **「backoffice で変えた値は worker が運ぶ」** → backoffice と api は同じ DB を見ています。worker が運ぶのは Solr の索引への反映だけです([仕組み-9](./09-search-solr))。

## 7. 関係する演習と設計書 {#s7}

- 演習: [SRE-2 エラーバジェットとアラート](/exercises/10-sre-burn-rate-alert)・[インフラ-2 設定値とシークレットを環境で分ける](/exercises/06-infra-config-and-secrets)・[障害-2 メモリ不足で再起動を繰り返す](/exercises/15-incident-crashloop)
- 設計書: [全体方式 4.3 わざと壊すスイッチ](/design/architecture/00-overall#s4-3)・[インフラ方式 4.1 2 つの版で同じイメージを使う](/design/architecture/03-infrastructure#s4-1)・[BE 方式 4.9 aspect で役割を分ける](/design/architecture/02-backend#s4-9)・[4.10 定期ジョブ(worker)](/design/architecture/02-backend#s4-10)・[SRE 方式 4.8 定期ジョブの見張り](/design/architecture/05-sre#s4-8)・[障害対応方式 4.7 気づきにくい障害](/design/architecture/08-incident-response#s4-7)・[BE 方式 4.6 ヘルスチェック](/design/architecture/02-backend#s4-6)
- 前後のページ: [仕組み-7 OAuth のトークン](./07-oauth-token) ・ [仕組み-9 検索と Solr](./09-search-solr)
