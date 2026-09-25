# 地図: 構成図と設計書の対応

::: tip 3 行まとめ
- ラボの部品(箱)ごとに、「どの設計書がその箱のことを決めているか」を書き込んだ地図です。
- 下の表(マトリクス)は、部品 × 10 の分野で、● = その分野の主役、○ = 関係する、を示します。
- 部品の名前から、GitHub の実物のファイルに飛べます。
:::

## 1. 構成図(どの箱を、どの設計書が決めているか)

`[ ]` の中が、その箱のことを決めている設計書です。
略号: 全体 = 全体方式、FE・BE・インフラ・NW(ネットワーク)・SRE・QA・性能・障害・DR・セキュ = 各分野の方式設計書、D-… = 詳細設計書。

```text
 【利用者の側】
 ┌───────────────────────────────────────────────┐
 │ ブラウザ / k6(負荷)/ Playwright(E2E)       │  [QA][性能]  D-QA-04, D-PERF-05
 └───────────────────────┬───────────────────────┘
                         │ http://localhost:18080
 【入口の層 = ネットワーク・セキュリティ】
 ┌───────────────────────▼───────────────────────┐
 │ edge: nginx + ModSecurity(OWASP CRS)          │  [NW][セキュ][性能]
 │  振り分け / キャッシュ 30 秒 / レート制限       │  D-NW-01, D-SEC-01
 │  WAF 遮断 / /admin の IP 制限 / CSP などヘッダ  │
 └──────┬─────────────────┬──────────────┬────────┘
        │ /api/*          │ /admin/*     │ それ以外
 【アプリの層 = FE・BE】  │(内部からだけ) │
 ┌──────▼──────────┐      │      ┌───────▼─────────────────┐
 │ api:3001         │◀─────┘      │ web:4000                 │  [FE][性能][障害]
 │ Node.js+Express  │◀────────────│ Angular 21 SSR           │  D-FE-04, D-FE-22
 │ 商品・ログイン・  │  SSR のとき │ SSR タイムアウト 3000ms  │
 │ 注文・カオス      │  直接呼ぶ   │ → 空の HTML に逃げる     │
 └──────┬───────────┘             └──────────────────────────┘
        │  [BE][セキュ][障害]  D-BE-orders-api, D-INC-03
 【データの層 = BE・DR】
 ┌──────▼───────────┐
 │ db: PostgreSQL 17 │  [BE][DR]  D-DR-02
 └──────────────────┘

 【見張りの層 = SRE・障害対応】
 ┌──────────────┐ 5 秒ごと ┌─────────────┐    ┌───────┐
 │ Prometheus    │─────────▶│ Alertmanager │──▶│ pager │  [SRE][障害]  D-SRE-02
 │ SLI・バーン    │ api,web  └─────────────┘    └───────┘
 │ レートを計算   │
 └──────┬───────┘
 ┌──────▼───────┐  ┌──────────────────────────┐
 │ Grafana       │◀─│ Loki ◀── Alloy(ログ集め)│  [SRE][障害]
 └──────────────┘  └──────────────────────────┘

 【土台の層 = インフラ】
  docker compose(軽量版)/ kind + マニフェスト(本格版)  [インフラ]  D-INF-01
  tools/backup.sh・restore.sh                              [DR]        D-DR-02
```

## 2. 箱と設計書の対応(表)

| 層 | 部品 | 役目 | 決めている方式設計書 | 決めている詳細設計書 |
| --- | --- | --- | --- | --- |
| 利用者の側 | k6・Playwright | 負荷をかける・操作をなぞる | [QA](/design/architecture/06-qa)・[性能](/design/architecture/07-performance) | [D-QA-04](/design/detail/D-QA-04-e2e)・[D-PERF-05](/design/detail/D-PERF-05-load-test) |
| 入口 | edge | 振り分け・キャッシュ・レート制限・WAF・IP 制限・ヘッダ | [ネットワーク](/design/architecture/04-network)・[セキュリティ](/design/architecture/10-security)・[性能](/design/architecture/07-performance) | [D-NW-01](/design/detail/D-NW-01-edge-route)・[D-SEC-01](/design/detail/D-SEC-01-waf-and-rate-limit) |
| アプリ | web | 画面(SSR / CSR)・指標 | [FE](/design/architecture/01-frontend)・[性能](/design/architecture/07-performance)・[障害対応](/design/architecture/08-incident-response) | [D-FE-04](/design/detail/D-FE-04-product-detail)・[D-FE-22](/design/detail/D-FE-22-ssr-server) |
| アプリ | api | 商品・ログイン・注文・わざと壊すスイッチ | [BE](/design/architecture/02-backend)・[セキュリティ](/design/architecture/10-security)・[障害対応](/design/architecture/08-incident-response) | [D-BE 注文 API](/design/detail/D-BE-orders-api)・[D-INC-03](/design/detail/D-INC-03-slow-api) |
| データ | db | 商品・会員・注文の正データ | [BE](/design/architecture/02-backend)・[DR](/design/architecture/09-disaster-recovery) | [D-DR-02](/design/detail/D-DR-02-backup-restore) |
| 見張り | Prometheus・Alertmanager・pager・Grafana・Loki・Alloy | 指標とログを集め、SLO と比べ、人を呼ぶ | [SRE](/design/architecture/05-sre)・[障害対応](/design/architecture/08-incident-response) | [D-SRE-02](/design/detail/D-SRE-02-slo-burn-rate) |
| 土台 | docker compose・kind | 起動・メモリ上限・ヘルスチェック・再起動 | [インフラ](/design/architecture/03-infrastructure) | [D-INF-01](/design/detail/D-INF-01-compose-and-k8s) |
| 全体 | すべて | 層をまたぐ決定・非機能の目標 | [全体方式](/design/architecture/00-overall) | — |

## 3. マトリクス: 部品 × 10 の分野

● = その分野の主役(演習の中心になる)、○ = 関係する。部品名は GitHub の実物へのリンクです。

| 部品(ファイル) | FE | BE | インフラ | NW | SRE | QA | 性能 | 障害 | DR | セキュ |
| --- | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: |
| edge([nginx 設定](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/edge/default.conf.template)・[WAF の例外](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/edge/modsecurity/lab-exclusions-before.conf)) | ○ | | ○ | ● | ○ | | ● | ○ | | ● |
| web([server.ts](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/apps/web/src/server.ts)・[angular.json](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/apps/web/angular.json)・[app.routes.ts](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/apps/web/src/app/app.routes.ts)) | ● | | ○ | ○ | ○ | ○ | ● | ● | | ○ |
| api([server.js](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/apps/api/src/server.js)・[chaos.js](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/apps/api/src/chaos.js)・[metrics.js](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/apps/api/src/metrics.js)) | | ● | ○ | | ○ | ○ | ○ | ● | | ● |
| db([db.js](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/apps/api/src/db.js)・[docker-compose.yml](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/docker-compose.yml)) | | ● | ○ | | | | ○ | ○ | ● | ○ |
| Prometheus([prometheus.yml](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/observability/prometheus/prometheus.yml)・[記録ルール](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/observability/prometheus/rules/slo-recording.yml)・[アラートルール](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/observability/prometheus/rules/slo-alerts.yml)) | | | | | ● | | ○ | ● | | |
| Alertmanager・pager([alertmanager.yml](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/observability/alertmanager/alertmanager.yml)・[pager](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/observability/pager/server.mjs)) | | | | | ● | | | ● | | |
| Grafana([ダッシュボード](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/observability/grafana/dashboards/samplestore-slo.json)・[データソース](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/observability/grafana/provisioning/datasources/datasources.yml)) | | | | | ● | | ○ | ● | | |
| Loki・Alloy([loki.yml](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/observability/loki/loki.yml)・[config.alloy](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/observability/alloy/config.alloy)) | | | | | ● | | | ● | | ○ |
| k6([browse.js](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/tools/k6/browse.js)・[ramp.js](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/tools/k6/ramp.js)・[k6.sh](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/tools/k6.sh)) | | | | ○ | ○ | ○ | ● | | | ○ |
| Playwright(E2E。[tools/](https://github.com/kazumasamatsumoto/ops-hands-on-lab/tree/main/tools) に置く) | ○ | | | | | ● | | | | |
| バックアップ([backup.sh](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/tools/backup.sh)・[restore.sh](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/tools/restore.sh)) | | | ○ | | | | | ○ | ● | |
| カオス([chaos.sh](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/tools/chaos.sh))・攻撃の見本([attack-samples.sh](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/tools/attack-samples.sh)) | | ○ | | | ○ | ○ | | ● | | ● |
| docker compose([docker-compose.yml](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/docker-compose.yml)・[observability/compose.yml](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/observability/compose.yml)) | | | ● | ○ | | | ○ | ○ | | ○ |
| kind・マニフェスト([k8s/](https://github.com/kazumasamatsumoto/ops-hands-on-lab/tree/main/k8s)) | | | ● | ○ | ○ | | ● | ● | | ○ |

### 読み方の例

- **edge は 3 つの分野の主役**です(ネットワーク・性能・セキュリティ)。入口は「速くする」「守る」「振り分ける」を同時に担うので、edge の設定を変えるときは 3 つの設計書を確かめます。
- **web は障害対応の主役でもあります**。API が遅いときに「空の HTML を返して逃げる」仕組み(フォールバック)は web の中にあるからです。
- **db はバックアップの主役**です。アプリのコードではなく、データを守る仕組み(DR)が中心です。

## 4. 分野ごとの入口

| 分野 | 方式設計書 | 主な演習 |
| --- | --- | --- |
| FE | [FE 方式](/design/architecture/01-frontend) | [01](/exercises/01-fe-ssr-vs-csr)・[02](/exercises/02-fe-ssr-rules)・[03](/exercises/03-fe-lazy-loading) |
| BE | [BE 方式](/design/architecture/02-backend) | [04](/exercises/04-be-api-and-authz) |
| インフラ | [インフラ方式](/design/architecture/03-infrastructure) | [05](/exercises/05-infra-rolling-update)・[06](/exercises/06-infra-config-and-secrets) |
| ネットワーク | [ネットワーク方式](/design/architecture/04-network) | [07](/exercises/07-nw-cache)・[08](/exercises/08-nw-cors-and-ip) |
| SRE | [SRE 方式](/design/architecture/05-sre) | [09](/exercises/09-sre-sli-slo)・[10](/exercises/10-sre-burn-rate-alert) |
| QA | [QA 方式](/design/architecture/06-qa) | [11](/exercises/11-qa-e2e-regression) |
| 性能 | [性能方式](/design/architecture/07-performance) | [12](/exercises/12-perf-load-test)・[13](/exercises/13-perf-scale-out) |
| 障害対応 | [障害対応方式](/design/architecture/08-incident-response) | [14](/exercises/14-incident-slow-api)・[15](/exercises/15-incident-crashloop) |
| DR | [DR 方式](/design/architecture/09-disaster-recovery) | [16](/exercises/16-dr-backup-restore) |
| セキュリティ | [セキュリティ方式](/design/architecture/10-security) | [17](/exercises/17-sec-waf)・[18](/exercises/18-sec-rate-limit-login)・[19](/exercises/19-sec-csp) |
