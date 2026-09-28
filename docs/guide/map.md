# 地図: 構成図と設計書の対応

::: tip 3 行まとめ
- ラボの部品(箱)ごとに、「どの設計書がその箱のことを決めているか」と「CCv2 では何に当たるか」を書き込んだ地図です。
- 形は SAP Commerce Cloud(CCv2)でヘッドレスのお店を動かすときと同じです: ブラウザ → CDN・WAF → 入口(エンドポイント)→ storefront / api / backoffice / worker → DB・検索・画像。
- 下の表(マトリクス)は、部品 × 10 の分野で、● = その分野の主役、○ = 関係する、を示します。部品の名前から、GitHub の実物のファイルに飛べます。
:::

## 1. 構成図(どの箱を、どの設計書が決めているか) {#diagram}

`[ ]` の中が、その箱のことを決めている設計書です。
略号: 全体 = 全体方式、FE・BE・インフラ・NW(ネットワーク)・SRE・QA・性能・障害・DR・セキュ = 各分野の方式設計書、D-… = 詳細設計書。

```text
 【利用者の側】
 ┌──────────────────────────────────────────────────────┐
 │ ブラウザ / k6(負荷)/ Playwright(E2E)              │  [QA][性能]  D-QA-04, D-PERF-05
 └──────────────────────────┬───────────────────────────┘
     http://www.lab.localhost:18080 ・ http://api.lab.localhost:18080 ・ http://backoffice.lab.localhost:18080
 【クラスタの外 = CDN と WAF の役】                         (CCv2: 別に契約する CDN・WAF)
 ┌──────────────────────────▼───────────────────────────┐
 │ cdn-waf: nginx + ModSecurity(OWASP CRS)             │  [NW][セキュ][性能]
 │  キャッシュ(画面・商品・CMS 30 秒 / 画像 1 日)       │  D-NW-01, D-SEC-01
 │  全体のレート制限(IP ごと 20r/s・burst 80)           │
 │  WAF 遮断 / CSP などのヘッダ(ホストごと)             │
 └──────────────────────────┬───────────────────────────┘
                            │ ホスト名を付けたまま全部渡す
 【クラスタの入口 = エンドポイント】                         (CCv2: Cloud Portal のエンドポイントと IP フィルタ)
 ┌──────────────────────────▼───────────────────────────┐
 │ ingress: ホスト名で振り分け                            │  [NW][セキュ]  D-NW-01
 │  backoffice は IP フィルタ(社内だけ)                  │
 │  /admin・/metrics・/readyz を外から閉じる              │
 │  トークンの発行は IP ごと 1 秒 1 回(burst 5)          │
 └───┬───────────────────┬───────────────────┬──────────┘
     │ www               │ api               │ backoffice(社内 IP だけ)
 【アプリの層 = FE・BE】
 ┌───▼─────────────┐ ┌───▼─────────────┐ ┌───▼─────────────┐ ┌─────────────────┐
 │ storefront:4000  │ │ api:3001         │ │ backoffice:3001  │ │ worker:3001      │
 │ Angular 21 SSR   │ │ ASPECT=api       │ │ ASPECT=backoffice│ │ ASPECT=          │
 │ CMS の JSON で   │ │ OCC 風 REST      │ │ 価格・在庫・     │ │ backgroundProc.  │
 │ 画面を組み立てる │ │ OAuth・/medias/  │ │ バナーの変更     │ │ 定期ジョブ 2 本  │
 │ SSR 3000ms で    │ │ CORS・カオス     │ │                  │ │ (外に出さない)   │
 │ 空の HTML に逃げる│ │                  │ │                  │ │                  │
 └───┬─────────────┘ └───┬─────────────┘ └───┬─────────────┘ └───┬─────────────┘
     │ SSR 中は中の近道   │                   │                    │
     └──▶ api:3001        │                   │                    │
  [FE][性能][障害]         [BE][セキュ][障害]   [BE][セキュ]          [BE][SRE]
  D-FE-04, D-FE-05, D-FE-22  D-BE 注文 API, D-INC-03                  D-SRE-02
 【データの層 = BE・DR】        │                   │                    │
 ┌──────────────────────────────▼───────────────────▼────────────────────▼─┐
 │ db: PostgreSQL 17(商品・会員・注文・トークン・CMS の文言)            │  [BE][DR]  D-DR-02
 │ search: 軽量版は DB の検索で代用 / 本格版は Solr(worker が索引を作り直す)│  [BE][性能][DR]
 │ 画像: api の /medias/(cdn-waf で 1 日ためる)                           │  [NW][性能]
 └──────────────────────────────────────────────────────────────────────┘

 【見張りの層 = SRE・障害対応】                             (CCv2: Dynatrace・SAP Cloud Logging に当たる)
 ┌──────────────┐ 5 秒ごと              ┌─────────────┐    ┌───────┐
 │ Prometheus    │─────────────────────▶│ Alertmanager │──▶│ pager │  [SRE][障害]  D-SRE-02
 │ SLI・バーン    │ storefront・api・     └─────────────┘    └───────┘
 │ レート・定期   │ backoffice・worker
 │ ジョブの止まり │
 └──────┬───────┘
 ┌──────▼───────┐  ┌──────────────────────────┐  ┌──────────────────────────────┐
 │ Grafana       │◀─│ Loki ◀── Alloy(ログ集め)│  │ OTel Collector → Tempo(本格版)│  [SRE][障害]
 └──────────────┘  └──────────────────────────┘  └──────────────────────────────┘

 【土台の層 = インフラ】
  manifest.json ──render.mjs──▶ k8s/generated/(本格版の Deployment・Ingress・環境 d1/s1/p1)  [インフラ]  D-INF-01
  docker compose(軽量版。manifest に手で合わせる)/ kind(本格版)                           [インフラ]  D-INF-01
  tools/backup.sh・restore.sh                                                                  [DR]        D-DR-02
```

- **入口が 2 段**なのは、役割と持ち主が違うからです。cdn-waf は「外の盾」(たくさんの利用者と攻撃をさばく警備員)、ingress は「お店の受付」(どの窓口か、社員専用の部屋に入れてよいかを決める受付係)です。
- api・backoffice・worker は**同じイメージ**(`lab/api:local`)を、環境変数 `ASPECT` で役割を変えて動かします。
- 本格版だけの部品(Solr、OpenTelemetry Collector + Tempo、ingress-nginx)は、軽量版では「DB の検索で代用」「トレースなし」「nginx のコンテナで同じ振り分けを手書き」にしています。

## 2. CCv2 との対応 {#ccv2}

ラボの言葉と、CCv2 / Composable Storefront の案件で出てくる言葉の対応です。[仕組み](/how-it-works/00-overview) のページも、この表の言葉で説明しています。

| ラボ | CCv2 / Composable Storefront で当たるもの | ラボで見る場所 |
| --- | --- | --- |
| cdn-waf | 外部の CDN / WAF(例: CloudFront + AWS WAF) | [cdn-waf/default.conf.template](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/cdn-waf/default.conf.template) |
| ingress のホスト名ごとの振り分け(www・api・backoffice) | Cloud Portal の「エンドポイント」(Cloud Portal にはエンドポイントごとの簡易の WAF もあり、IP ごとの回数制限や閉じるパスを決められます。ラボの ingress の閉じる口はこれに近い。ただし Cloud Portal の回数制限はエンドポイント全体にかかるもので、ラボのように 1 つのパス(トークンの発行)だけに絞るものではありません。また、前に CDN を置くときは使わないよう SAP が注意しています) | [ingress/default.conf.template](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/ingress/default.conf.template)・[k8s/generated/base/ingress.yaml](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/k8s/generated/base/ingress.yaml) |
| ingress の IP 制限(`BACKOFFICE_IP_ALLOWLIST`・`ipFilters.office`) | エンドポイントの「IP フィルタ」 | [ingress/40-ip-filter.sh](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/ingress/40-ip-filter.sh)・[manifest.json](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/manifest.json) |
| storefront | JS Storefront(SSR) | [apps/web/src/server.ts](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/apps/web/src/server.ts) |
| api の `/occ/v2/samplestore/...` | OCC の REST API(`samplestore` は baseSiteId) | [apps/api/src/aspects/api.js](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/apps/api/src/aspects/api.js) |
| api の `/authorizationserver/oauth/token` | OAuth の認可サーバー | [apps/api/src/occ/oauth.js](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/apps/api/src/occ/oauth.js) |
| `CORS_ALLOWED_ORIGINS` | corsfilter の設定(許可するオリジン) | [apps/api/src/occ/cors.js](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/apps/api/src/occ/cors.js) |
| `cms/pages` の JSON から画面を組み立てる | CMS 駆動の描画(ヘッドレスの核心。Composable Storefront の cmsComponents の設定) | [apps/web/src/app/cms/cms-mapping.ts](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/apps/web/src/app/cms/cms-mapping.ts) |
| `ASPECT=api` / `backoffice` / `backgroundProcessing` | aspect(api・backoffice・backgroundProcessing) | [apps/api/src/main.js](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/apps/api/src/main.js) |
| worker の定期ジョブ(`stockImportJob`・`searchIndexJob`) | CronJob(backgroundProcessing で動く) | [apps/api/src/aspects/worker.js](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/apps/api/src/aspects/worker.js) |
| search(本格版は Solr) | Solr(商品検索の索引) | [apps/api/src/solr.js](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/apps/api/src/solr.js) |
| `manifest.json` と `tools/manifest/render.mjs` | CCv2 の manifest.json とビルド(ラボ独自の簡単な形) | [tools/manifest/README.md](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/tools/manifest/README.md) |
| `k8s/generated/envs/d1` ・ `s1` ・ `p1` | 環境 d1(開発)・s1(ステージング)・p1(本番) | [k8s/generated/envs/](https://github.com/kazumasamatsumoto/ops-hands-on-lab/tree/main/k8s/generated/envs) |
| Prometheus・Grafana・Tempo | Dynatrace(APM) | [observability/](https://github.com/kazumasamatsumoto/ops-hands-on-lab/tree/main/observability) |
| Loki + Grafana | SAP Cloud Logging(ログ。画面は OpenSearch Dashboards) | [observability/loki/loki.yml](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/observability/loki/loki.yml) |

## 3. 箱と設計書の対応(表) {#boxes}

| 層 | 部品 | 役目 | 決めている方式設計書 | 決めている詳細設計書 |
| --- | --- | --- | --- | --- |
| 利用者の側 | k6・Playwright | 負荷をかける・操作をなぞる | [QA](/design/architecture/06-qa)・[性能](/design/architecture/07-performance) | [D-QA-04](/design/detail/D-QA-04-e2e)・[D-PERF-05](/design/detail/D-PERF-05-load-test) |
| クラスタの外 | cdn-waf | キャッシュ・全体のレート制限・WAF・ヘッダ | [ネットワーク](/design/architecture/04-network)・[セキュリティ](/design/architecture/10-security)・[性能](/design/architecture/07-performance) | [D-NW-01](/design/detail/D-NW-01-edge-route)・[D-SEC-01](/design/detail/D-SEC-01-waf-and-rate-limit) |
| 入口 | ingress | ホスト名で振り分け・IP フィルタ・閉じる口・トークンの回数制限 | [ネットワーク](/design/architecture/04-network)・[セキュリティ](/design/architecture/10-security) | [D-NW-01](/design/detail/D-NW-01-edge-route)・[D-SEC-01](/design/detail/D-SEC-01-waf-and-rate-limit) |
| アプリ | storefront | 画面(SSR / CSR)・CMS 駆動の描画・指標 | [FE](/design/architecture/01-frontend)・[性能](/design/architecture/07-performance)・[障害対応](/design/architecture/08-incident-response) | [D-FE-04](/design/detail/D-FE-04-product-detail)・[D-FE-05](/design/detail/D-FE-05-headless-cms)・[D-FE-22](/design/detail/D-FE-22-ssr-server) |
| アプリ | api | OCC 風 API・OAuth・画像・CORS・わざと壊すスイッチ | [BE](/design/architecture/02-backend)・[セキュリティ](/design/architecture/10-security)・[障害対応](/design/architecture/08-incident-response) | [D-BE 注文 API](/design/detail/D-BE-orders-api)・[D-INC-03](/design/detail/D-INC-03-slow-api) |
| アプリ | backoffice | 管理画面(価格・在庫・バナー) | [BE](/design/architecture/02-backend)・[セキュリティ](/design/architecture/10-security) | [D-FE-05](/design/detail/D-FE-05-headless-cms) |
| アプリ | worker | 定期ジョブ(在庫の取り込み・検索の索引) | [BE](/design/architecture/02-backend)・[SRE](/design/architecture/05-sre) | [D-SRE-02](/design/detail/D-SRE-02-slo-burn-rate) |
| データ | db・search | 商品・会員・注文の正データ / 検索の索引 | [BE](/design/architecture/02-backend)・[DR](/design/architecture/09-disaster-recovery)・[性能](/design/architecture/07-performance) | [D-DR-02](/design/detail/D-DR-02-backup-restore) |
| 見張り | Prometheus・Alertmanager・pager・Grafana・Loki・Alloy・OTel/Tempo | 指標・ログ・トレースを集め、SLO と比べ、人を呼ぶ | [SRE](/design/architecture/05-sre)・[障害対応](/design/architecture/08-incident-response) | [D-SRE-02](/design/detail/D-SRE-02-slo-burn-rate) |
| 土台 | manifest.json・docker compose・kind | 構成の設計図・起動・台数・環境の差 | [インフラ](/design/architecture/03-infrastructure) | [D-INF-01](/design/detail/D-INF-01-compose-and-k8s) |
| 全体 | すべて | 層をまたぐ決定・非機能の目標 | [全体方式](/design/architecture/00-overall) | — |

## 4. マトリクス: 部品 × 10 の分野 {#matrix}

● = その分野の主役(演習の中心になる)、○ = 関係する。部品名は GitHub の実物へのリンクです。

| 部品(ファイル) | FE | BE | インフラ | NW | SRE | QA | 性能 | 障害 | DR | セキュ |
| --- | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: |
| cdn-waf([nginx 設定](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/cdn-waf/default.conf.template)・[WAF の例外](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/cdn-waf/modsecurity/lab-exclusions-before.conf)) | ○ | | ○ | ● | ○ | | ● | ○ | | ● |
| ingress([nginx 設定](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/ingress/default.conf.template)・[IP フィルタ](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/ingress/40-ip-filter.sh)・[Ingress](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/k8s/generated/base/ingress.yaml)) | | ○ | ○ | ● | | | ○ | ○ | | ● |
| storefront([server.ts](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/apps/web/src/server.ts)・[cms-mapping.ts](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/apps/web/src/app/cms/cms-mapping.ts)・[app.routes.ts](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/apps/web/src/app/app.routes.ts)・[angular.json](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/apps/web/angular.json)) | ● | | ○ | ○ | ○ | ○ | ● | ● | | ○ |
| api([aspects/api.js](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/apps/api/src/aspects/api.js)・[occ/oauth.js](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/apps/api/src/occ/oauth.js)・[occ/cors.js](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/apps/api/src/occ/cors.js)・[chaos.js](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/apps/api/src/chaos.js)) | ○ | ● | ○ | ○ | ○ | ○ | ○ | ● | | ● |
| backoffice([aspects/backoffice.js](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/apps/api/src/aspects/backoffice.js)) | ○ | ● | | ○ | | | | | | ● |
| worker([aspects/worker.js](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/apps/api/src/aspects/worker.js)) | | ● | ○ | | ● | | | ● | ○ | |
| db([db.js](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/apps/api/src/db.js)・[docker-compose.yml](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/docker-compose.yml)) | | ● | ○ | | | | ○ | ○ | ● | ○ |
| search(Solr。[solr.js](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/apps/api/src/solr.js)・[schema.xml](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/apps/api/solr/products/conf/schema.xml)・[occ/search.js](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/apps/api/src/occ/search.js)) | | ● | ○ | | ○ | | ● | ○ | ○ | ○ |
| Prometheus([prometheus.yml](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/observability/prometheus/prometheus.yml)・[記録ルール](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/observability/prometheus/rules/slo-recording.yml)・[アラートルール](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/observability/prometheus/rules/slo-alerts.yml)) | | | | | ● | | ○ | ● | | |
| Alertmanager・pager([alertmanager.yml](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/observability/alertmanager/alertmanager.yml)・[pager](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/observability/pager/server.mjs)) | | | | | ● | | | ● | | |
| Grafana([ダッシュボード](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/observability/grafana/dashboards/samplestore-slo.json)・[データソース](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/observability/grafana/provisioning/datasources/datasources.yml)) | | | | | ● | | ○ | ● | | |
| Loki・Alloy([loki.yml](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/observability/loki/loki.yml)・[config.alloy](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/observability/alloy/config.alloy)) | | | | | ● | | | ● | | ○ |
| OTel・Tempo(本格版。送る側: [api の otel.js](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/apps/api/src/otel.js)・[storefront の otel.ts](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/apps/web/src/server/otel.ts)。受ける側は [k8s/observability/traces.yaml](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/k8s/observability/traces.yaml) の otel-collector → Tempo) | ○ | ○ | | | ● | | ● | ● | | |
| k6([smoke.js](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/tools/k6/smoke.js)・[browse.js](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/tools/k6/browse.js)・[ramp.js](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/tools/k6/ramp.js)・[k6.sh](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/tools/k6.sh)) | | | | ○ | ○ | ○ | ● | | | ○ |
| Playwright([e2e.sh](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/tools/e2e.sh)・[journey.spec.ts](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/tools/e2e/tests/journey.spec.ts)・[authz.spec.ts](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/tools/e2e/tests/authz.spec.ts)・[visual.spec.ts](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/tools/e2e/tests/visual.spec.ts)) | ○ | | | | | ● | | | | ○ |
| バックアップ([backup.sh](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/tools/backup.sh)・[restore.sh](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/tools/restore.sh)) | | | ○ | | | | | ○ | ● | |
| カオス([chaos.sh](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/tools/chaos.sh))・攻撃の見本([attack-samples.sh](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/tools/attack-samples.sh)) | | ○ | | | ○ | ○ | | ● | | ● |
| manifest([manifest.json](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/manifest.json)・[render.mjs](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/tools/manifest/render.mjs)) | | ○ | ● | ● | | ○ | ○ | | | ● |
| docker compose([docker-compose.yml](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/docker-compose.yml)・[observability/compose.yml](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/observability/compose.yml)) | | | ● | ○ | | | ○ | ○ | | ○ |
| kind・マニフェスト([kind-config.yaml](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/k8s/kind-config.yaml)・[k8s/generated/](https://github.com/kazumasamatsumoto/ops-hands-on-lab/tree/main/k8s/generated)) | | | ● | ○ | ○ | | ● | ● | | ○ |

### 読み方の例

- **cdn-waf と ingress は、どちらもネットワークとセキュリティの主役**です。ただし役目は分かれています。cdn-waf は「速くする(キャッシュ)」と「攻撃を止める(WAF・全体のレート制限)」、ingress は「どの窓口に渡すか(エンドポイント)」と「誰を通すか(IP フィルタ・ログインの回数制限)」です。入口の設定を変えるときは、どちらの段の話かを先に確かめます。
- **storefront は障害対応の主役でもあります**。API が遅いときに「空の HTML を返して逃げる」仕組み(フォールバック)は storefront の中にあるからです。
- **worker は SRE と障害対応の主役**です。画面を持たないので、止まっても誰も気づきません。「最後に成功した時刻」を見張るアラート(`CronJobStale`)が要るのはそのためです。
- **manifest.json はインフラ・ネットワーク・セキュリティをまたぎます**。台数・環境変数・エンドポイント・IP フィルタを 1 か所に書くので、1 行の変更が 3 つの分野に効きます。
- **db はバックアップの主役、Solr の索引は「作り直せる物」**です。索引は DB から worker が作り直すので、バックアップの対象ではありません。

## 5. 分野ごとの入口 {#by-area}

| 分野 | 方式設計書 | 主な演習 |
| --- | --- | --- |
| FE | [FE 方式](/design/architecture/01-frontend) | [01](/exercises/01-fe-ssr-vs-csr)・[02](/exercises/02-fe-ssr-rules)・[03](/exercises/03-fe-lazy-loading)・[21 ヘッドレス](/exercises/21-headless-cms) |
| BE | [BE 方式](/design/architecture/02-backend) | [04](/exercises/04-be-api-and-authz) |
| インフラ | [インフラ方式](/design/architecture/03-infrastructure) | [05](/exercises/05-infra-rolling-update)・[06](/exercises/06-infra-config-and-secrets) |
| ネットワーク | [ネットワーク方式](/design/architecture/04-network) | [07](/exercises/07-nw-cache)・[08](/exercises/08-nw-cors-and-ip)・[20](/exercises/20-nw-ingress-endpoints) |
| SRE | [SRE 方式](/design/architecture/05-sre) | [09](/exercises/09-sre-sli-slo)・[10](/exercises/10-sre-burn-rate-alert) |
| QA | [QA 方式](/design/architecture/06-qa) | [11](/exercises/11-qa-e2e-regression) |
| 性能 | [性能方式](/design/architecture/07-performance) | [12](/exercises/12-perf-load-test)・[13](/exercises/13-perf-scale-out) |
| 障害対応 | [障害対応方式](/design/architecture/08-incident-response) | [14](/exercises/14-incident-slow-api)・[15](/exercises/15-incident-crashloop) |
| DR | [DR 方式](/design/architecture/09-disaster-recovery) | [16](/exercises/16-dr-backup-restore) |
| セキュリティ | [セキュリティ方式](/design/architecture/10-security) | [17](/exercises/17-sec-waf)・[18](/exercises/18-sec-rate-limit-login)・[19](/exercises/19-sec-csp) |
