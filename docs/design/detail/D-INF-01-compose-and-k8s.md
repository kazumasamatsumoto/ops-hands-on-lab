# D-INF-01 起動構成(compose と Kubernetes)

版: 2.0 / 親: [インフラ方式](/design/architecture/03-infrastructure) / 対象: [docker-compose.yml](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/docker-compose.yml)・[observability/compose.yml](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/observability/compose.yml)・[manifest.json](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/manifest.json)・[tools/manifest/render.mjs](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/tools/manifest/render.mjs)・[k8s/](https://github.com/kazumasamatsumoto/ops-hands-on-lab/tree/main/k8s)

::: tip 3 行まとめ(この文書で決めたこと)
- 軽量版は `docker compose up -d --build` の 1 コマンド、本格版は `LAB_ENV=d1|s1|p1 k8s/up.sh`(既定 p1)の 1 コマンドで起動します。
- api・backoffice・worker は **同じイメージ `lab/api:local`** を、環境変数 `ASPECT=api|backoffice|backgroundProcessing` で役割を変えて動かします(CCv2 の aspect と同じ考え方)。
- 構成の設計図は `manifest.json` の 1 か所です。`tools/manifest/render.mjs` が本格版の Deployment・Service・Ingress と環境ごとの差分(`k8s/generated/`)を作り、軽量版の compose は手で合わせて `--check` で食い違いを確かめます。
:::

## 0. 親の方式設計書 {#s0}
| 項目 | 内容 |
| --- | --- |
| 親 | [インフラ方式](/design/architecture/03-infrastructure) |
| 引き継ぐ決定 | 4.1 同じイメージ、4.3 メモリの上限、4.4 ヘルスチェック、4.5 設定と秘密、4.6 ローリング更新、[4.7 manifest → k8s](/design/architecture/03-infrastructure#s4-7)、[4.8 d1/s1/p1](/design/architecture/03-infrastructure#s4-8) |
| またがる層 | [全体方式 4.6](/design/architecture/00-overall#s4-6)(CCv2 + ヘッドレスに寄せる)・[4.7](/design/architecture/00-overall#s4-7)(manifest.json)、[BE 方式 4.9](/design/architecture/02-backend#s4-9)(aspect) |

## 1. 目的と範囲 {#s1}
- **含む**: サービスの一覧と各値、ネットワーク、ボリューム、起動・停止の手順、manifest.json からできる物、本格版の Pod の設定、環境ごとの違い。
- **含まない**: 各アプリの中身、cdn-waf と ingress の設定の中身([D-NW-01](/design/detail/D-NW-01-edge-route))。

## 2. 前提 {#s2}
| 前提 | 内容 |
| --- | --- |
| Compose | `include:` が使える v2.20 以上。プロジェクト名は `lab`(ネットワーク名 `lab_default`・`lab_outside`) |
| kind | v0.30 以上、ノードのイメージ `kindest/node:v1.34.0`、ノード 1 台([kind-config.yaml](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/k8s/kind-config.yaml)) |
| 同時起動 | できない(同じホストのポート 18080・13000・19090・19093・19094 を使う) |
| ホスト名 | `www.lab.localhost`・`api.lab.localhost`・`backoffice.lab.localhost`。`.localhost` で終わる名前は Chrome・Edge・Firefox・curl では設定なしで 127.0.0.1 になる(Safari は hosts に書く場合あり) |

## 3. 全体像(軽量版のサービス) {#s3}
| サービス | イメージ | ホストのポート | メモリ上限 | ヘルスチェック | CCv2 で当たるもの |
| --- | --- | --- | --- | --- | --- |
| cdn-waf | `owasp/modsecurity-crs:4.25.1-nginx-alpine-202609241109-lts` | **127.0.0.1:18080** → 8081 | 128MB | `/cdn-healthz` 10 秒ごと、5 回 | 外部の CDN・WAF |
| ingress | `nginx:1.30.4-alpine` | なし | 64MB | `/ingress-healthz` 10 秒ごと、5 回 | エンドポイントと IP フィルタ |
| storefront | `lab/web:local`(`node:24.21.0-bookworm-slim`) | なし | 384MB | `/healthz` 10 秒ごと、3 回(イメージ側) | JS Storefront |
| api | `lab/api:local`(`node:24.21.0-alpine`)、`ASPECT=api` | なし | 256MB | `/readyz` 10 秒ごと、起動猶予 30 秒、3 回(イメージ側) | api aspect |
| backoffice | 同じ `lab/api:local`、`ASPECT=backoffice` | なし | 192MB | 同上 | backoffice aspect |
| worker | 同じ `lab/api:local`、`ASPECT=backgroundProcessing` | なし | 192MB | 同上 | backgroundProcessing aspect |
| db | `postgres:17.11-alpine` | なし | 256MB | `pg_isready` 5 秒ごと、20 回まで | DB |
| prometheus | `prom/prometheus:v3.15.0` | **19090** → 9090 | 256MB | `/-/ready` | APM の指標 |
| alertmanager | `prom/alertmanager:v0.34.1` | **19093** → 9093 | 64MB | `/-/ready` | 通知 |
| pager | `node:24.21.0-alpine` | **19094** → 9094 | 64MB | `/healthz` | 通知の受け口 |
| grafana | `grafana/grafana:12.4.11` | **13000** → 3000 | 256MB | `/api/health` | APM・ログの画面 |
| loki | `grafana/loki:3.7.8` | なし | 256MB | なし(シェルも wget も無いイメージのため) | ログの置き場所 |
| alloy | `grafana/alloy:v1.20.0` | なし | 128MB | なし | ログの集め役 |

- 起動の順番: db が healthy → api・backoffice・worker → api が healthy → storefront。ingress は依存なし(行き先が未起動の間は 502)、cdn-waf は ingress が起動すれば起動します。
- 表の作成と見本データの投入は `ASPECT=api` だけが行い、backoffice と worker は表ができるまで待ちます。
- 再起動はどれも `restart: unless-stopped`。
- 観測の 6 つは [observability/compose.yml](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/observability/compose.yml) にまとめ、`include:` で読み込みます。

## 4. 仕様 {#s4}
### 4.1 ネットワークとボリューム {#s4-1}
| 項目 | 値 | 理由 |
| --- | --- | --- |
| ネットワーク `default` | `172.30.89.0/24`、ゲートウェイ `172.30.89.1` | ingress の IP フィルタ(`BACKOFFICE_IP_ALLOWLIST` の既定 `127.0.0.1/32 172.30.89.0/24 172.30.91.0/24`。最後の範囲は本格版用で、manifest の `office` とそろえてある)で番号の範囲を使うため固定 |
| cdn-waf の番号 | `172.30.89.10`(固定) | ingress が「この IP から来た `X-Forwarded-For` だけ信じる」(`CDN_WAF_IP`)ため。k6 と E2E もこの番号で cdn-waf に届く |
| ネットワーク `outside` | `172.30.90.0/24` | 「社外(インターネット)」の代わり。cdn-waf だけがつながる。ここから backoffice を開くと 403 |
| ホストのポート | お店の入口(cdn-waf)は `127.0.0.1:18080` と `[::1]:18080` だけ | 同じ LAN の別の PC からお店に届かないようにする。ただし観測の 4 つ(13000・19090・19093・19094)は軽量版では待ち受けの住所を絞っていない(`"19090:9090"` の形)ので、同じ LAN から見える場合がある。本格版は 4.4 のとおり 127.0.0.1 だけ |
| ボリューム | `db-data`・`prometheus-data`・`grafana-data`・`loki-data` | `docker compose down` では残り、`down -v` で消える |

### 4.2 起動と停止 {#s4-2}
| 操作 | 軽量版 | 本格版 |
| --- | --- | --- |
| 起動 | `docker compose up -d --build` | `LAB_ENV=p1 k8s/up.sh`(`d1`・`s1` も可。既定 p1)。環境だけ切り替えるときは `LAB_ENV=d1 LAB_SKIP_BUILD=1 k8s/up.sh` |
| 状態 | `docker compose ps` | `kubectl -n lab get pods` |
| 停止 | `docker compose down`(`-v` でデータも消す) | `k8s/down.sh`(クラスタごと消す。データも消える) |
| 設定の反映 | `docker compose up -d cdn-waf`(ほかのサービスも同じ) | `node tools/manifest/render.mjs` → もう一度 `k8s/up.sh` |
| つまみ | `EDGE_CACHE=off docker compose up -d cdn-waf` のように前に書く | manifest.json の環境ごとの値 |

### 4.3 本格版の Pod(k8s/generated/base) {#s4-3}
| 部品 | 種類 | 台数(base) | requests(CPU / メモリ)/ limits(メモリ) | probe | 外への出口 |
| --- | --- | --- | --- | --- | --- |
| storefront | Deployment | 2 | 100m / 256Mi / 384Mi | startup `/healthz`(2 秒ごと、60 回まで)、readiness `/healthz`(5 秒ごと、2 回で外す)、liveness `/healthz`(10 秒ごと、3 回で再起動) | Ingress `www` |
| api | Deployment(`ASPECT=api`) | 2 | 50m / 96Mi / 256Mi | startup `/healthz`(2 秒ごと、60 回まで)、readiness `/readyz`(5 秒ごと、2 回で外す)、liveness `/healthz`(10 秒ごと、3 回で再起動) | Ingress `api` |
| backoffice | Deployment(`ASPECT=backoffice`) | 1 | 50m / 96Mi / 192Mi | 同上 | Ingress `backoffice`(IP フィルタ) |
| worker | Deployment(`ASPECT=backgroundProcessing`) | 1 | 50m / 96Mi / 192Mi | 同上 | なし(Service は指標の収集用) |

- storefront・api・backoffice は `RollingUpdate`(`maxSurge: 1`、`maxUnavailable: 0`)。worker だけは `Recreate`(古い Pod を止めてから新しい Pod を起動)で、入れ替えの間に定期ジョブが二重に動かないようにしています。どれも停止の猶予 20 秒(止める前に `preStop` で 5 秒待つ)。
- 秘密の値(`PGPASSWORD`・`BACKOFFICE_PASSWORD`)は Secret `lab-secrets` から `secretKeyRef` で読みます。manifest には鍵の名前だけを書き、値は書きません。
- db・Solr・観測・ingress-nginx の定義は render.mjs の対象外で、[k8s/platform/](https://github.com/kazumasamatsumoto/ops-hands-on-lab/tree/main/k8s/platform)(Namespace・Secret・DB・Solr `solr:9.10.1-slim`)、[k8s/observability/](https://github.com/kazumasamatsumoto/ops-hands-on-lab/tree/main/k8s/observability)(指標・ログ・トレース・Grafana)、[k8s/vendor/ingress-nginx/](https://github.com/kazumasamatsumoto/ops-hands-on-lab/tree/main/k8s/vendor/ingress-nginx)(版を固定した写し)に置きます。
- 本格版では manifest の `tracing.otlpEndpoint` から、4 つの Deployment に `OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-collector:4318` が付きます(軽量版には付けません)。
- cdn-waf はクラスタの外の Docker のコンテナ(`lab-cdn-waf`)として `k8s/up.sh` が起動し、ホストの 18080 を受けて kind のノードの 80 番(ingress-nginx)に渡します。Docker のネットワークは `lab-kind`(172.30.91.0/24。cdn-waf は 172.30.91.10)と、社外の代わりの `lab-kind-outside`(172.30.92.0/24)です。

実物: [base/storefront.yaml](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/k8s/generated/base/storefront.yaml)・[base/api.yaml](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/k8s/generated/base/api.yaml)・[base/backoffice.yaml](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/k8s/generated/base/backoffice.yaml)・[base/worker.yaml](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/k8s/generated/base/worker.yaml)・[base/ingress.yaml](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/k8s/generated/base/ingress.yaml)

### 4.4 ホストのポート(本格版) {#s4-4}
ホストの番号は軽量版と同じです。どれも `127.0.0.1` だけで待ち受け、同じネットワークの他の PC からは見えません。

| ホスト | 行き先 |
| --- | --- |
| 18080 | cdn-waf(クラスタの外のコンテナ `lab-cdn-waf`)→ kind のノードの 80 番(ingress-nginx)→ www・api・backoffice の Ingress |
| 13000 | Grafana |
| 19090 | Prometheus |
| 19093 | Alertmanager |
| 19094 | pager |

観測の 4 つは、kind のノードの番号(30300・30090・30093・30094)を [kind-config.yaml](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/k8s/kind-config.yaml) でホストにつなぎます。

### 4.5 設定と秘密 {#s4-5}
| 種類 | 軽量版 | 本格版 |
| --- | --- | --- |
| 設定 | 各サービスの `environment`(api・backoffice・worker の共通分は YAML のアンカー `x-db-env`) | Deployment の `env`(manifest の `commonEnv`・`aspects[].env`)と、環境ごとの `patches/env-*.yaml` |
| 秘密(見本の値) | `PGPASSWORD: store`・`BACKOFFICE_PASSWORD: admin` を `environment` に直書き(ラボ専用) | Secret `lab-secrets`(`PGPASSWORD`・`BACKOFFICE_PASSWORD`) |
| 環境の印 | なし | ConfigMap `lab-environment`(`LAB_ENV`・`EDGE_CACHE`・`SEARCH_PROVIDER`) |

### 4.6 manifest.json からできる物 {#s4-6}
「manifest に 1 行書くと、裏でこういうリソースができる」の対応です(CCv2 の manifest の考え方をまねた、このラボ独自の形)。

| manifest.json の項目 | 例 | できる物 |
| --- | --- | --- |
| `images.platform` | `lab/api:local` | api・backoffice・worker の 3 つの Deployment の `image` |
| `aspects[].name` / `service` | `backgroundProcessing` / `worker` | 環境変数 `ASPECT`、ラベル `lab/aspect`、Deployment・Service の名前 |
| `aspects[].replicas`・`resources` | `2`、`{cpu: 50m, memory: 96Mi, memoryLimit: 256Mi}` | `spec.replicas`、`resources` |
| `aspects[].secretEnv` | `["PGPASSWORD"]` | `env[].valueFrom.secretKeyRef`(Secret `lab-secrets`) |
| `endpoints[]` | `www`・`api`・`backoffice` | Ingress `www`・`api`・`backoffice`(ホスト名 → Service) |
| `endpoints[].ipFilter` | `office` | 注釈 `nginx.ingress.kubernetes.io/allowlist-source-range: "127.0.0.1/32,172.30.89.0/24,172.30.91.0/24"` |
| `endpoints[].blockedPaths` | `/admin`・`/metrics`・`/readyz` | Ingress `<名前>-blocked`(注釈 `nginx.ingress.kubernetes.io/denylist-source-range: "0.0.0.0/0"` で、どこから来ても 403) |
| `endpoints[].rateLimits[]` | `{path: /authorizationserver/oauth/token, rps: 1, burst: 5}` | Ingress `api-ratelimit-1`(注釈 `limit-rps: "1"`・`limit-burst-multiplier: "5"`) |
| `environments.<d1\|s1\|p1>` | 台数・`cdnCache`・`ipFilterOverrides`・`searchProvider`・`env` | `k8s/generated/envs/<環境>/kustomization.yaml`(kustomize のオーバーレイ)と `patches/*.yaml` |

```bash
node tools/manifest/render.mjs           # k8s/generated/ を作り直す
node tools/manifest/render.mjs --check   # docker-compose.yml・ingress の設定と食い違いがないか確かめる
kubectl kustomize k8s/generated/envs/p1  # 環境 p1 の最終的な YAML を見る(クラスタは要らない)
```

項目の意味の一覧: [tools/manifest/README.md](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/tools/manifest/README.md)

### 4.7 環境ごとの違い(d1・s1・p1) {#s4-7}
| | d1(開発) | s1(ステージング) | p1(本番) |
| --- | --- | --- | --- |
| 台数 storefront / api / backoffice / worker | 1 / 1 / 1 / 1 | 1 / 2 / 1 / 1 | 2 / 2 / 1 / 1 |
| cdn-waf のキャッシュ(ConfigMap `lab-environment` の `EDGE_CACHE`) | `off` | `on` | `on` |
| www・api の IP フィルタ | 社内だけ(`patches/ip-filter-www.yaml` など) | 社内だけ | 誰でも |
| backoffice の IP フィルタ | 社内だけ | 社内だけ | 社内だけ |
| 検索(`SEARCH_PROVIDER`) | `solr` | `solr` | `solr` |
| ログの細かさ | `debug` | `info` | `info` |

実物: [envs/d1](https://github.com/kazumasamatsumoto/ops-hands-on-lab/tree/main/k8s/generated/envs/d1)・[envs/s1](https://github.com/kazumasamatsumoto/ops-hands-on-lab/tree/main/k8s/generated/envs/s1)・[envs/p1](https://github.com/kazumasamatsumoto/ops-hands-on-lab/tree/main/k8s/generated/envs/p1)

## 5. 目標と確認方法 {#s5}
| 項目 | 目標 | 確かめ方 |
| --- | --- | --- |
| 軽量版の起動 | 全サービスが healthy(healthcheck の無い loki・alloy は running) | `docker compose ps` |
| 本格版の起動 | 全 Pod が Ready | `kubectl -n lab get pods` |
| メモリ | 軽量版の上限の合計 2,496MB(アプリ 1,472MB + 観測 1,024MB) | 上の表の合計 |
| manifest と compose | 食い違いなし | `node tools/manifest/render.mjs --check` |
| 更新中の台数 | p1 で api が 2 台を下回らない | `kubectl -n lab rollout status deploy/api` の間に `get pods` |

## 6. 関連する文書 {#s6}
- [D-NW-01 cdn-waf と ingress の経路とキャッシュ](/design/detail/D-NW-01-edge-route)
- [D-DR-02 バックアップと復元](/design/detail/D-DR-02-backup-restore)(ボリュームを消して戻す)
- 仕組みの説明: [Kubernetes の基本](/how-it-works/03-kubernetes-basics)・[aspect と worker](/how-it-works/08-aspects-and-worker)・[manifest と環境](/how-it-works/12-manifest-and-environments)

## 7. 未決事項 {#s7}
| # | 内容 |
| --- | --- |
| 1 | 軽量版の秘密の値を `.env` ファイル(リポジトリに入れない)に移すか |
| 2 | `ipFilters.office` には軽量版(172.30.89.0/24)と本格版(172.30.91.0/24)の両方の範囲が入っている。環境ごとに「社内」の範囲を分けるか |
| 3 | 軽量版の compose も manifest.json から作るか(今は手で合わせて `--check` で確かめる) |

## 8. レビュー観点 {#s8}
- [ ] 全サービスのイメージの版が固定されているか
- [ ] 全サービスにメモリの上限があるか
- [ ] ヘルスチェックの無いサービスに、理由が書いてあるか
- [ ] 外に出すポートが cdn-waf の 18080(と観測の画面)だけか。storefront・api・db を直接出していないか
- [ ] 3 つの aspect が同じイメージで、違いが `ASPECT` と環境変数だけか
- [ ] manifest.json を変えたあと、render と `--check` をしたか
- [ ] 環境ごとの違い(台数・IP フィルタ・キャッシュ)が 1 か所に書いてあるか

## この設計を体験する演習 {#exercises}
- [インフラ-1 止めずに版を上げる(ローリング更新)](/exercises/05-infra-rolling-update)
- [インフラ-2 設定値とシークレットを環境で分ける](/exercises/06-infra-config-and-secrets)
- [障害-2 メモリ不足で再起動を繰り返す](/exercises/15-incident-crashloop)
- [性能-2 台数を増やして耐える](/exercises/13-perf-scale-out)
- [ネットワーク-3 Ingress とエンドポイント](/exercises/20-nw-ingress-endpoints)
