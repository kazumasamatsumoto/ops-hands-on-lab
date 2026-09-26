---
title: 仕組み-11 観測(指標・ログ・トレース)
---

# 仕組み-11 観測(指標・ログ・トレース)

::: tip このページで分かること
- 3 種類の見守りの道筋: 指標(Prometheus → ルール → Alertmanager → pager)、ログ(Alloy → Loki)、トレース(OpenTelemetry → Tempo。本格版)。
- それぞれの設定の 1 行ずつの意味と、Grafana での見方。
- 1 つのリクエストを `trace_id` で最初から最後まで追う方法。
- CCv2 の Dynatrace(APM)・OpenSearch(ログ)との対応。
:::

## 1. 一言でいうと {#s1}

お店の調子を知る道具は 3 つあります。

| 種類 | 一言 | たとえ | ラボの道具 |
| --- | --- | --- | --- |
| 指標(メトリクス) | 数字の記録。「1 秒に何件、そのうち何件が失敗、遅い方から 5% の速さは何秒」 | 体温計・血圧計。数字の変化で「いつもと違う」に気付く | Prometheus(集める・計算する)・Alertmanager(知らせる)・Grafana(グラフ) |
| ログ | 出来事の記録。「何時何分、この URL が 500 を返した。理由はこれ」 | 日記・業務日誌。何が起きたかを文章で後から読める | Alloy(集める)・Loki(保管する)・Grafana(探す) |
| トレース | 1 つのリクエストの道筋。「storefront で 20 ms、api で 800 ms、そのうち DB が 750 ms」 | 宅配便の追跡番号。どこを通り、どこで止まっていたかが 1 つの番号で分かる | OpenTelemetry(記録して送る)・Tempo(保管する)・Grafana(見る)※本格版だけ |

指標で「何かおかしい」に気付き、トレースで「どこが遅いか」を絞り、ログで「なぜか」を読む、という順に使います。

## 2. 1 リクエストの流れ {#s2}

### 2.1 指標がアラートになるまで {#s2-1}

```text
 api がリクエストを処理 → http_requests_total{route,method,status} を +1、処理時間をヒストグラムに記録(メモリの中)
   │
 ① Prometheus が 5 秒ごとに GET http://api:3001/metrics(cdn-waf・ingress を通らず中から直接)
 ② 記録ルール(5 秒ごと)   job:http_errors:ratio_rate5m = 5xx の増え方 ÷ 全体の増え方(5 分窓)
                             job:slo_burn_rate:5m      = 上のエラー率 ÷ 0.001(SLO 99.9% の予算)
 ③ アラートルール(5 秒ごと) ErrorBudgetBurnPage: 5 分窓 > 14.4 かつ 1 時間窓 > 14.4 が 1 分続いた
 ④ Alertmanager へ           同じ alertname・job をまとめ、10 秒待ってから送る(仲間を待つ)
 ⑤ pager へ                  POST http://pager:9094/webhook → 画面(http://localhost:19094)に並ぶ
 ⑥ Grafana                   同じ数字をグラフで見る(http://localhost:13000「サンプルストア SLO」)
```

### 2.2 ログが検索できるまで {#s2-2}

```text
 api が 1 行の JSON を標準出力に書く
   {"level":50,"service":"samplestore-api","aspect":"api","reqId":"…","trace_id":"…","method":"GET","path":"/occ/…","status":500,"durationMs":12,"msg":"request"}
   │
 ① Docker(本格版は Kubernetes)がコンテナの標準出力をファイルに溜める
 ② Alloy が 10 秒ごとに「動いているコンテナの一覧」を Docker に聞き、各コンテナのログを読む
 ③ ラベル(付箋)を付ける    service="api"(compose のサービス名)・container・project="lab"
                             JSON の level を読み、50 → error のように言葉にしてラベルに
 ④ Loki に送る               POST http://loki:3100/loki/api/v1/push
 ⑤ Grafana で探す            {service="api", level="error"}
```

### 2.3 トレースで 1 リクエストを追う(本格版) {#s2-3}

```text
 ブラウザ → cdn-waf → ingress-nginx → storefront
   storefront  区間「GET /p/:code」を始める(前段が traceparent を付けてきたら、その続きにする)
     └ 区間「ssr.render」(Angular が HTML を作っていた時間)
         ├ 区間「GET /occ/v2/samplestore/cms/pages」 ── traceparent ヘッダを付けて api へ
         │     api  区間(http・express)
         │       └ 区間(pg: SELECT … FROM cms_slots …)
         └ 区間「GET /occ/v2/samplestore/products/{code}」 ── traceparent ──▶ api ─▶ pg / Solr
   各部品が OTLP/HTTP で送る → OpenTelemetry Collector(:4318)→ Tempo に保管
   ログの各行にも同じ trace_id が入る → Grafana の Loki のログの trace_id を押すと Tempo の道筋に飛ぶ
```

- `traceparent` … 「このリクエストは、どの道筋の、どの区間の続きか」を運ぶ HTTP ヘッダ(W3C の決まり)。storefront が api を呼ぶときに付け、api はそれを受け取って同じ `trace_id` の下に自分の区間をぶら下げます。
- worker の定期ジョブも、1 回 = 1 本の道筋になります(中の DB・Solr への問い合わせがぶら下がる)。

本格版の送り先は manifest.json の `tracing.otlpEndpoint`(`http://otel-collector:4318`)で、storefront と 3 つの aspect の `OTEL_EXPORTER_OTLP_ENDPOINT` になります。Grafana の Loki のデータソースには「ログの `"trace_id":"…"` を見つけたら Tempo へのリンクにする」設定(derived field)が入っています([k8s/config/grafana-datasources.yml](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/k8s/config/grafana-datasources.yml))。

- 道筋の始まりは storefront です。cdn-waf と ingress-nginx はトレースを出さない設定なので、道筋の一番上は storefront の区間「GET /p/:code」になります(入口の様子は、それぞれのアクセスログで見ます)。
- Tempo はトレースを 24 時間で消します(`k8s/config/tempo.yaml` の `block_retention: 24h`)。置き場所は Pod の中の一時的な場所(`emptyDir`)なので、Tempo の Pod が作り直されたときも消えます。

## 3. 設定の読み方 {#s3}

### 3.1 アプリが指標を出す所 {#s3-1}

[apps/api/src/metrics.js](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/apps/api/src/metrics.js):

```js
const httpRequestsTotal = new client.Counter({
  name: 'http_requests_total',
  labelNames: ['route', 'method', 'status'],
  ...
});
const httpRequestDuration = new client.Histogram({
  name: 'http_request_duration_seconds',
  labelNames: ['route', 'method', 'status'],
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.2, 0.3, 0.5, 1, 2, 3, 5, 10],
  ...
});
```

- Counter … 増えるだけの数(リクエストの数)。「5 分でどれだけ増えたか」を計算して、1 秒あたりにします。
- Histogram … 「0.005 秒以下が何件、0.01 秒以下が何件…」と、処理時間を箱(バケツ)に分けて数えます。ここから p95(遅い方から 5% の速さ)を計算します。
- `route` には実際の URL ではなく、パターン(`/occ/v2/samplestore/products/:code`)を入れます。商品コードごとにラベルを作ると種類が増えすぎるためです。

### 3.2 Prometheus: 集める・計算する {#s3-2}

[observability/prometheus/prometheus.yml](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/observability/prometheus/prometheus.yml):

```yaml
global:
  scrape_interval: 5s
  evaluation_interval: 5s
...
scrape_configs:
  - job_name: api
    static_configs:
      - targets: ["api:3001"]
```

- `scrape_interval: 5s` … 5 秒ごとに集めます(ラボなので短め。本番は 15〜60 秒が多い)。
- `evaluation_interval: 5s` … ルールを 5 秒ごとに計算します。
- `job_name` … そのまま指標の `job` ラベルになります(`storefront`・`api`・`backoffice`・`worker`)。
- `/metrics` は ingress で外から閉じているので、Prometheus は中から直接取りに行きます。

[observability/prometheus/rules/slo-recording.yml](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/observability/prometheus/rules/slo-recording.yml):

```yaml
      - record: job:http_errors:ratio_rate5m
        expr: |
          (
            sum by (job) (rate(http_requests_total{status=~"5..", route!~"/metrics|/healthz|/readyz|/admin/.*|unmatched"}[5m]))
            or
            sum by (job) (rate(http_requests_total{route!~"/metrics|/healthz|/readyz|/admin/.*|unmatched"}[5m])) * 0
          )
          /
          sum by (job) (rate(http_requests_total{route!~"/metrics|/healthz|/readyz|/admin/.*|unmatched"}[5m]))
      - record: job:slo_burn_rate:5m
        expr: job:http_errors:ratio_rate5m / 0.001
```

- `record` … 計算の結果に名前を付けて保存します(記録ルール)。毎回そろばんを弾かずに済むよう、帳簿の欄に書き写しておくイメージです。
- `rate(...[5m])` … 直近 5 分の「1 秒あたりの増え方」。
- `status=~"5.."` … 500 番台だけ。`route!~"..."` … 見守り用・管理用の口と、どのルートにも当たらなかった物を除きます(利用者の体験と関係ないため)。
- `or ... * 0` … 5xx が 1 件も無いときに、結果が「空」ではなく 0 になるようにする書き方。
- `/ 0.001` … SLO「1 か月の成功率 99.9%」の予算(失敗してよい割合 0.1%)で割ると、「予算を燃やす速さ」(バーンレート)になります。1 なら 30 日でちょうど使い切る速さです。

[observability/prometheus/rules/slo-alerts.yml](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/observability/prometheus/rules/slo-alerts.yml):

```yaml
      - alert: ErrorBudgetBurnPage
        expr: |
          job:slo_burn_rate:5m{job=~"storefront|api"} > 14.4
          and
          job:slo_burn_rate:1h{job=~"storefront|api"} > 14.4
        for: 1m
        labels:
          severity: page
```

- 14.4 … 「1 か月の予算の 2% を 1 時間で使う速さ」(0.02 × 720 時間 ÷ 1 時間)。このままだと約 2 日で使い切ります。
- 2 つの窓の `and` … 長い窓(1 時間)で「本当に続いているか」、短い窓(5 分)で「今も起きているか」を両方見ます。直ったあとも長い窓に引きずられて鳴り続ける、を防ぎます。
- `for: 1m` … 1 分続いたら鳴らします。
- `severity: page` … 緊急(夜中でも人を起こす)。警告は `ticket`(営業時間内に対応)。

| アラート | 条件 | 重さ |
| --- | --- | --- |
| `ErrorBudgetBurnPage` | バーンレート 5 分窓 > 14.4 かつ 1 時間窓 > 14.4(1 分続く) | page |
| `ErrorBudgetBurnTicket` | 30 分窓 > 6 かつ 6 時間窓 > 6(5 分続く) | ticket |
| `ErrorBudgetBurnDemo` | 1 分窓 > 14.4 かつ 5 分窓 > 14.4(演習用) | demo |
| `SSRFallbackRatioHigh` | SSR のフォールバック率 > 5%(1 分続く) | ticket |
| `SSRErrors` | SSR のエラーが 0 より多い(1 分続く) | ticket |
| `CronJobStale` | 定期ジョブが 300 秒以上成功していない | ticket |
| `CronJobFailureRatioHigh` | 定期ジョブの失敗率 > 50%(1 分続く) | ticket |
| `TargetDown` | 指標が取れない(1 分続く) | page |

### 3.3 Alertmanager: まとめて知らせる {#s3-3}

[observability/alertmanager/alertmanager.yml](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/observability/alertmanager/alertmanager.yml):

```yaml
route:
  receiver: pager
  group_by: ["alertname", "job"]
  group_wait: 10s
  group_interval: 30s
  repeat_interval: 1h
receivers:
  - name: pager
    webhook_configs:
      - url: http://pager:9094/webhook
        send_resolved: true
inhibit_rules:
  - source_matchers: ['severity="page"']
    target_matchers: ['severity="ticket"']
    equal: ["job"]
```

- `group_by` … 同じアラート名・同じサービスの物を 1 通にまとめます。
- `group_wait: 10s` … 最初のアラートが来てから、仲間が来るのを 10 秒待ちます。
- `repeat_interval: 1h` … 鳴り続けている間、1 時間ごとに送り直します。
- `send_resolved: true` … 直ったときも知らせます。
- `inhibit_rules` … 緊急(page)が鳴っている間は、同じサービスの警告(ticket)を黙らせます(通知の洪水を防ぐ)。
- 通知先はラボの中の pager だけです(外部には送りません)。

### 3.4 Alloy: ログを集める {#s3-4}

[observability/alloy/config.alloy](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/observability/alloy/config.alloy):

```text
discovery.docker "containers" {
  host             = "unix:///var/run/docker.sock"
  refresh_interval = "10s"
  filter {
    name   = "label"
    values = ["com.docker.compose.project=lab"]
  }
}
discovery.relabel "containers" {
  rule {
    source_labels = ["__meta_docker_container_label_com_docker_compose_service"]
    target_label  = "service"
  }
  ...
}
loki.write "local" {
  endpoint {
    url = "http://loki:3100/loki/api/v1/push"
  }
}
```

- `discovery.docker` … Docker のソケット(Docker に話しかける口。読むだけで渡しています)から、このラボ(compose の project 名 `lab`)のコンテナを 10 秒ごとに探します。
- `discovery.relabel` … compose のサービス名を `service` というラベルにします。Grafana では `{service="api"}` のように絞れます。
- `loki.process "json"`(省略)… JSON の `level` を読み、pino の数字(30 = info、40 = warn、50 = error)を言葉に直してラベルにします。
- `loki.write` … Loki に送ります。
- 本格版では、Docker のソケットの代わりに Kubernetes の API から Pod のログを読みます([k8s/config/config.alloy](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/k8s/config/config.alloy))。ラベルは同じ `service`(Pod のラベル `app.kubernetes.io/name`)なので、下の探し方はそのまま使えます。Pod ごとの `pod` ラベルも付きます。

### 3.5 トレースを送る所 {#s3-5}

[apps/api/src/otel.js](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/apps/api/src/otel.js):

```js
const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;

if (endpoint) {
  ...
  const sdk = new NodeSDK({
    resource: resourceFromAttributes({
      [ATTR_SERVICE_NAME]: process.env.OTEL_SERVICE_NAME ?? `samplestore-${aspect}`,
    }),
    traceExporter: new OTLPTraceExporter(),
    instrumentations: [ new HttpInstrumentation(...), new ExpressInstrumentation(...), new PgInstrumentation(), new UndiciInstrumentation() ],
  });
  sdk.start();
}
```

- `OTEL_EXPORTER_OTLP_ENDPOINT` が **あるときだけ** 動きます。軽量版には無いので、トレースの処理は一切動きません。
- `ATTR_SERVICE_NAME` … 道筋に出る名前(`samplestore-api` など)。
- `instrumentations` … http・express・pg(DB)・undici(Node の fetch = Solr への問い合わせ)を「自動で」計測します。アプリより先に読み込む必要があるので、`node --require ./src/otel.js` で起動します。
- ログの各行の `trace_id` は [apps/api/src/log.js](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/apps/api/src/log.js) の `mixin` が入れます。

## 4. 確かめるコマンド {#s4}

```bash
# Prometheus が集めている先(全部 up = 1 なら OK)
curl -s 'http://localhost:19090/api/v1/query?query=up' | python3 -c 'import sys,json; [print(r["metric"]["job"], r["value"][1]) for r in json.load(sys.stdin)["data"]["result"]]'
# → api 1 / backoffice 1 / prometheus 1 / worker 1 / storefront 1(順番は違ってもかまいません)

# 記録ルールの結果(api の成功率、直近 5 分)
curl -s 'http://localhost:19090/api/v1/query?query=job:sli_success:ratio_rate5m' | python3 -m json.tool | head -20

# アラートを鳴らす: api の半分を 500 に → 1〜2 分で pager に ErrorBudgetBurnDemo と ErrorBudgetBurnPage
#   (Page は「1 時間窓」も見ます。直前 1 時間に負荷試験などで成功の記録がたくさんあると、割合が薄まって Page は鳴りません。
#    そのときは SRE-2 の手順 1 のとおり Prometheus をまっさらにしてから試します)
tools/chaos.sh set errorRate=0.5
tools/k6.sh browse.js -e DURATION=3m -e PAGES=0
curl -s http://localhost:19093/api/v2/alerts | python3 -c 'import sys,json; [print(a["labels"]["alertname"], a["labels"].get("job"), a["status"]["state"]) for a in json.load(sys.stdin)]'
tools/chaos.sh reset
```

**Grafana でログを探す**(http://localhost:13000 → 右上の「サインイン」から `admin` / `admin` でログイン → 左のメニューの Explore(日本語の表示では「探検」)→ データソース Loki。ログインしないままだと、メニューに Explore が出ません)

```text
{service="api"} | json | status >= 500                  … api の 500 の行だけ
{service="storefront"} |= "ssr_fallback"                … SSR をあきらめた記録
{service="worker", level="error"}                       … 定期ジョブの失敗
{service=~"cdn-waf|ingress"} | json | status = 403      … 入口で断った記録(WAF・IP フィルタ)
```

**1 つのリクエストを追う**

- 軽量版: トレースはありません。代わりに **リクエスト番号(`X-Request-Id`)** で追います。cdn-waf がリクエストごとに番号を 1 つ作り、自分のログの `request_id` に書いて、次の段へ `X-Request-Id` ヘッダで渡します。ingress はその番号を自分のログの `request_id` に書いてそのまま渡し、storefront・api はログの `reqId` に書きます。番号を 1 つ Loki で探せば、同じリクエストの行が部品をまたいで並びます。
  ```text
  {service=~"cdn-waf|ingress|storefront|api"} |= "<request_id の値>"
  ```
  番号が付くのは cdn-waf を通ったリクエストだけです。storefront が SSR の中で api を呼ぶとき(クラスタの中の近道)は cdn-waf を通らないので、その api の行には `reqId` が入りません。そこは時刻と URL で突き合わせます。
- 本格版: Grafana の Loki で api や storefront のログの行を開き、「Tempo で道筋を見る」を押すと、その 1 リクエストの道筋(storefront → api → DB)が時間の棒グラフで出ます。どの区間が長いかで、遅い場所が分かります。ダッシュボード「サンプルストア 1 リクエストの道筋」でも同じ物が見られます。並びは上から「使い方」→「最近の道筋(storefront が受けたリクエスト)」→「選んだ道筋(storefront → api → pg)」→「この道筋のログ(同じ trace_id)」で、「最近の道筋」の Trace ID を押すと下の 2 つがその道筋に切り替わります。

## 5. CCv2 / Composable Storefront ではどこに当たるか {#s5}

| ラボ | CCv2 で当たるもの |
| --- | --- |
| Prometheus + Grafana(指標・ダッシュボード) | Dynatrace(APM。応答時間・エラー率・サービスのつながりを自動で見る) |
| OpenTelemetry + Tempo(トレース・本格版) | Dynatrace の分散トレース(1 リクエストの道筋。storefront → api → DB) |
| Loki + Grafana(ログ) | OpenSearch(Cloud Portal から開くログの検索画面) |
| Alloy(ログを集める) | CCv2 の中でログを集めて OpenSearch に送る仕組み(SAP 側) |
| Alertmanager + pager | Dynatrace のアラートの通知先の設定(メール・チャットなど)。案件の連絡網につなぐ |
| 記録ルール・アラートルール(SLO・バーンレート) | Dynatrace でのしきい値・SLO の設定(案件で何を見張るかを決める) |
| `cronjob_last_success_timestamp_seconds` | Backoffice の CronJob の履歴と、それを見張る仕組み(案件で用意する) |
| 1 行 1 JSON のログ | OpenSearch で項目ごとに絞り込めるログの形 |

## 6. よくある誤解 {#s6}

- **「ログがあれば指標はいらない」** → ログは 1 件ずつ読む物で、「5 分間の失敗の割合」を常に計算し続けるのは苦手です。気付くのは指標、理由を読むのがログです。
- **「エラーが 1 件でも出たらアラートにする」** → 夜中に何度も起こされて、本当に大事な通知が埋もれます。SLO とバーンレートで「予算を削るほどの失敗」だけ鳴らします。
- **「平均の応答時間を見ていれば十分」** → 平均は一部の遅い人を隠します。p95(遅い方から 5%)を見ると、「かなりの人が遅いと感じている」が分かります。
- **「トレースを入れると、アプリを全部書き直す必要がある」** → http・express・pg などは自動で計測されます。ラボで手で書いたのは、SSR の区間とジョブの区間くらいです。
- **「/metrics はお客さんにも見えてよい」** → 中の様子(ルート名・メモリ・カオスの状態)が丸見えになります。ラボは ingress で外から閉じ、中から集めています。

## 7. 関係する演習と設計書 {#s7}

- 演習: [SRE-1 SLI を測って SLO と比べる](/exercises/09-sre-sli-slo)・[SRE-2 エラーバジェットとアラート](/exercises/10-sre-burn-rate-alert)・[障害-1 API が遅い → SSR が逃げる](/exercises/14-incident-slow-api)・[障害-2 メモリ不足で再起動を繰り返す](/exercises/15-incident-crashloop)
- 設計書: [SRE 方式 4.1 SLI](/design/architecture/05-sre#s4-1)・[4.2 SLO と エラーバジェット](/design/architecture/05-sre#s4-2)・[4.3 アラート](/design/architecture/05-sre#s4-3)・[4.5 通知の届け方](/design/architecture/05-sre#s4-5)・[4.6 ダッシュボード](/design/architecture/05-sre#s4-6)・[4.7 ログ](/design/architecture/05-sre#s4-7)・[4.8 定期ジョブの見張り](/design/architecture/05-sre#s4-8)・[4.9 トレース(1 リクエストを追う)](/design/architecture/05-sre#s4-9)・[全体方式 4.4 ログ・指標・トレースの形をそろえる](/design/architecture/00-overall#s4-4)・[障害対応方式 4.3 気づき方と一次対応](/design/architecture/08-incident-response#s4-3)・[D-SRE-02 SLO とバーンレートのアラート](/design/detail/D-SRE-02-slo-burn-rate)
- 前後のページ: [仕組み-10 DB とバックアップ](./10-db-and-backup) ・ [仕組み-12 manifest と環境](./12-manifest-and-environments)
