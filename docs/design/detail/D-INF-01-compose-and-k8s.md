# D-INF-01 起動構成(compose と Kubernetes)

版: 1.0 / 親: [インフラ方式](/design/architecture/03-infrastructure) / 対象: [docker-compose.yml](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/docker-compose.yml)・[observability/compose.yml](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/observability/compose.yml)・[k8s/](https://github.com/kazumasamatsumoto/ops-hands-on-lab/tree/main/k8s)

::: tip 3 行まとめ(この文書で決めたこと)
- 軽量版は `docker compose up -d --build` の 1 コマンド、本格版は `k8s/up.sh` の 1 コマンドで起動する。
- サービスごとのイメージ・ポート・メモリ上限・ヘルスチェックを下の表のとおりに決める(値はすべてファイルと同じ)。
- 本格版は api・web を 2 台、ローリング更新、3 種類の probe。db はデータを 1Gi のボリュームに置く。
:::

## 0. 親の方式設計書 {#s0}
| 項目 | 内容 |
| --- | --- |
| 親 | [インフラ方式](/design/architecture/03-infrastructure) |
| 引き継ぐ決定 | 4.1 同じイメージ、4.3 メモリの上限、4.4 ヘルスチェック、4.5 設定と秘密、4.6 ローリング更新 |

## 1. 目的と範囲 {#s1}
- **含む**: サービスの一覧と各値、ネットワーク、ボリューム、起動・停止の手順、本格版の Pod の設定。
- **含まない**: 各アプリの中身。

## 2. 前提 {#s2}
| 前提 | 内容 |
| --- | --- |
| Compose | `include:` が使える v2.20 以上。プロジェクト名は `lab`(ネットワーク名 `lab_default`) |
| kind | v0.30 以上、ノードのイメージ `kindest/node:v1.34.0`、ノード 1 台 |
| 同時起動 | できない(同じホストのポートを使う) |

## 3. 全体像(軽量版のサービス) {#s3}
| サービス | イメージ | ホストのポート | メモリ上限 | ヘルスチェック | 再起動 |
| --- | --- | --- | --- | --- | --- |
| db | `postgres:17.11-alpine` | なし | 256MB | `pg_isready` 5 秒ごと、20 回まで | unless-stopped |
| api | `lab/api:local`(`node:24.21.0-alpine`) | なし | 256MB | `/readyz` 5 秒ごと、起動猶予 20 秒、5 回 | unless-stopped |
| web | `lab/web:local`(`node:24.21.0-bookworm-slim`) | なし | 384MB | `/healthz` 10 秒ごと、起動猶予 30 秒、5 回 | unless-stopped |
| edge | `owasp/modsecurity-crs:4.25.1-nginx-alpine-202609241109-lts` | **18080** → 8080 | 128MB | `/edge-healthz` 10 秒ごと、5 回 | unless-stopped |
| prometheus | `prom/prometheus:v3.15.0` | **19090** → 9090 | 256MB | `/-/ready` | unless-stopped |
| alertmanager | `prom/alertmanager:v0.34.1` | **19093** → 9093 | 64MB | `/-/ready` | unless-stopped |
| pager | `node:24.21.0-alpine` | **19094** → 9094 | 64MB | `/healthz` | unless-stopped |
| grafana | `grafana/grafana:12.4.11` | **13000** → 3000 | 256MB | `/api/health` | unless-stopped |
| loki | `grafana/loki:3.7.8` | なし | 256MB | なし(シェルの無いイメージのため) | unless-stopped |
| alloy | `grafana/alloy:v1.20.0` | なし | 128MB | なし | unless-stopped |

起動の順番: db が healthy → api が healthy → web。edge は api が起動すれば起動する(web が未起動の間は 502)。

## 4. 仕様 {#s4}
### 4.1 ネットワークとボリューム {#s4-1}
| 項目 | 値 | 理由 |
| --- | --- | --- |
| ネットワーク | `172.30.89.0/24`、ゲートウェイ `172.30.89.1` | edge の `/admin/` の IP 制限で番号の範囲を使うため固定 |
| ボリューム | `db-data`・`prometheus-data`・`grafana-data`・`loki-data` | `docker compose down` では残り、`down -v` で消える |

### 4.2 起動と停止 {#s4-2}
| 操作 | 軽量版 | 本格版 |
| --- | --- | --- |
| 起動 | `docker compose up -d --build` | `k8s/up.sh`(クラスタ作成 → イメージのビルドと読み込み → 設定を ConfigMap に → 反映 → Ready まで待つ) |
| 状態 | `docker compose ps` | `kubectl -n lab get pods` |
| 停止 | `docker compose down`(`-v` でデータも消す) | `k8s/down.sh`(クラスタごと消す。データも消える) |
| 設定の反映 | `docker compose up -d edge`(web なども同じ) | `kubectl -n lab rollout restart deploy/edge` など |

### 4.3 本格版の Pod {#s4-3}
| 部品 | 種類 | 台数 | requests / limits(メモリ) | probe | 外への出口 |
| --- | --- | --- | --- | --- | --- |
| api | Deployment | 2 | 64Mi / 192Mi | startup `/healthz`(2 秒 × 90 回)、readiness `/readyz`(5 秒、2 回)、liveness `/healthz`(10 秒、3 回) | Service(内部) |
| web | Deployment | 2 | 96Mi / 384Mi | startup・readiness・liveness とも `/healthz` | Service(内部) |
| edge | Deployment | 1 | 64Mi / 128Mi | readiness・liveness `/edge-healthz` | NodePort 30080 → ホスト 18080 |
| db | StatefulSet | 1 | 64Mi / 256Mi | `pg_isready` | Service(内部)。ボリューム 1Gi |

api・web の更新は `RollingUpdate`(`maxSurge: 1`、`maxUnavailable: 0`)、`preStop` で 5 秒待ち、猶予 20 秒。
edge を 1 台にしているのは、キャッシュとレート制限の帳簿を Pod ごとに持つため(2 台にすると数え方が分かれる)。

実物: [api.yaml](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/k8s/manifests/api.yaml)・[web.yaml](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/k8s/manifests/web.yaml)・[edge.yaml](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/k8s/manifests/edge.yaml)・[db.yaml](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/k8s/manifests/db.yaml)・[kind-config.yaml](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/k8s/kind-config.yaml)

### 4.4 ホストのポート(本格版) {#s4-4}
kind のノードの番号をホストにつなぐ。どれも `127.0.0.1` だけで待ち受け、同じネットワークの他の PC からは見えない。

| ホスト | ノード | 行き先 |
| --- | --- | --- |
| 18080 | 30080 | edge |
| 13000 | 30300 | Grafana |
| 19090 | 30090 | Prometheus |
| 19093 | 30093 | Alertmanager |
| 19094 | 30094 | pager |

### 4.5 設定と秘密 {#s4-5}
| 種類 | 軽量版 | 本格版 |
| --- | --- | --- |
| 設定 | 各サービスの `environment` | ConfigMap `api-config`・`web-config` |
| 秘密(見本の値) | `PGPASSWORD`・`JWT_SECRET` を `environment` に直書き | Secret `lab-secrets`(`POSTGRES_PASSWORD`・`JWT_SECRET`) |

## 5. 目標と確認方法 {#s5}
| 項目 | 目標 | 確かめ方 |
| --- | --- | --- |
| 軽量版の起動 | 全サービスが healthy(healthcheck の無い loki・alloy は running) | `docker compose ps` |
| 本格版の起動 | 全 Pod が Ready | `kubectl -n lab get pods` |
| メモリ | 軽量版の上限の合計 2,048MB | 上の表の合計 |
| 更新中の台数 | api が 2 台を下回らない | `kubectl -n lab rollout status deploy/api` の間に `get pods` |

## 6. 関連する文書 {#s6}
- [D-NW-01 edge の経路とキャッシュ](/design/detail/D-NW-01-edge-route)
- [D-DR-02 バックアップと復元](/design/detail/D-DR-02-backup-restore)(ボリュームを消して戻す)

## 7. 未決事項 {#s7}
| # | 内容 |
| --- | --- |
| 1 | 軽量版の秘密の値を `.env` ファイル(リポジトリに入れない)に移すか |
| 2 | 本格版の `/admin/` は、Pod の番号の範囲が軽量版と違うため edge の中(127.0.0.1)からしか通らない。本格版用の範囲を足すか |

## 8. レビュー観点 {#s8}
- [ ] 全サービスのイメージの版が固定されているか
- [ ] 全サービスにメモリの上限があるか
- [ ] ヘルスチェックの無いサービスに、理由が書いてあるか
- [ ] 外に出すポートが必要な物だけか(db・api・web を直接出していないか)
- [ ] 起動の順番(依存)が決まっているか

## この設計を体験する演習 {#exercises}
- [インフラ-1 止めずに版を上げる(ローリング更新)](/exercises/05-infra-rolling-update)
- [インフラ-2 設定値とシークレットを環境で分ける](/exercises/06-infra-config-and-secrets)
- [障害-2 メモリ不足で再起動を繰り返す](/exercises/15-incident-crashloop)
- [性能-2 台数を増やして耐える](/exercises/13-perf-scale-out)
