# 全体方式設計書(ラボ)

版: 1.0 / 対象: サンプルストア 体験ラボ / 状態: 実物と一致(値はすべて設定ファイルから)

::: tip 3 行まとめ(この文書で決めたこと)
- 入口(edge)・画面(web)・API(api)・データ(db)・見張り(観測)の 5 つに分け、利用者の通り道は edge の 1 か所だけにする。
- 目標は「1 か月の成功率 99.9%」。失敗してよい量は 1 か月で約 43.2 分ぶん。これを毎日測って、減る速さでアラートを鳴らす。
- 障害や脆弱性を**わざと起こすスイッチ**(障害の注入)を最初から組み込み、見張りと守りが効くことを確かめられるようにする。
:::

## 0. 位置づけ {#s0}
このラボの設計書は 3 段です。

| 段 | 文書 | 決めること |
| --- | --- | --- |
| 全体方式 | この文書 | 層をまたぐ決定(構成・入口・設定・壊すスイッチ・版)と非機能の目標 |
| 分野ごとの方式 | [FE](/design/architecture/01-frontend)・[BE](/design/architecture/02-backend)・[インフラ](/design/architecture/03-infrastructure)・[ネットワーク](/design/architecture/04-network)・[SRE](/design/architecture/05-sre)・[QA](/design/architecture/06-qa)・[性能](/design/architecture/07-performance)・[障害対応](/design/architecture/08-incident-response)・[DR](/design/architecture/09-disaster-recovery)・[セキュリティ](/design/architecture/10-security) | その分野の中の方針 |
| 詳細 | 詳細設計書 11 本(第 6 章) | 画面 1 つ、API 1 つ、監視項目 1 つ… の具体的な値 |

## 1. 目的と範囲 {#s1}
- **目的**: 開発と運用に必要なことを、小さな実物で全部そろえ、演習で触れるようにする。
- **含む**: 架空のネットストア(商品一覧・詳細・ログイン・注文履歴)、入口の CDN と WAF の代わり、指標・ログ・アラート、負荷試験・E2E・バックアップの道具、軽量版(docker compose)と本格版(kind)。
- **含まない**: 本物の決済、メール送信、HTTPS の証明書、外部サービスへの通知、複数拠点。現場で必要なものは [必要なこと一覧](/guide/checklist) で「ラボでは扱わない」と示す。

## 2. 前提 {#s2}
| 前提 | 内容 |
| --- | --- |
| 動かす場所 | 学ぶ人の PC の Docker Desktop(割り当てメモリ 8GB)。外部には何も送らない |
| メモリの合計 | 軽量版の上限の合計はおよそ 2GB([docker-compose.yml](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/docker-compose.yml) と [observability/compose.yml](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/observability/compose.yml) の `mem_limit`) |
| ポート | 8080・3000 は他のアプリとよくぶつかるので、1 万番台にする(edge 18080、Grafana 13000、Prometheus 19090、Alertmanager 19093、pager 19094) |
| 公開 | リポジトリは公開する。秘密の値は「見本の値」だけを置く |

## 3. 全体像 {#s3}
```text
ブラウザ / k6 / Playwright
   │ http://localhost:18080
   ▼
edge(nginx + ModSecurity + OWASP CRS)  … CDN と WAF の代わり
   ├── /api/*   → api:3001(Node.js + Express)→ db:5432(PostgreSQL 17)
   ├── /admin/* → api:3001(内部のネットワークからだけ)
   └── それ以外 → web:4000(Angular 21 SSR)→ SSR のときは api:3001 を直接呼ぶ
観測: Prometheus(5 秒ごと)→ Alertmanager → pager / Alloy → Loki / Grafana
```

| 層 | 部品 | 持ち主(誰が決めるか) |
| --- | --- | --- |
| 入口 | edge | ネットワーク方式・セキュリティ方式 |
| 画面 | web | FE 方式 |
| API | api | BE 方式 |
| データ | db | BE 方式・DR 方式 |
| 見張り | Prometheus・Alertmanager・pager・Grafana・Loki・Alloy | SRE 方式 |
| 土台 | docker compose・kind | インフラ方式 |

責任分界: ラボでは 1 人が全部を持ちます。現場では上の「持ち主」の列に、チーム名と連絡先を書きます(書かないと、障害のときに誰が動くかで迷います)。

## 4. 決定事項 {#s4}
### 4.1 利用者の通り道は edge の 1 か所だけ {#s4-1}
| 項目 | 内容 |
| --- | --- |
| 決定 | 画面も API も `http://localhost:18080` の同じ入口(同じオリジン)から出す。edge が URL で振り分ける |
| 理由 | キャッシュ・レート制限・WAF・ヘッダを 1 か所で掛けられる。同じオリジンなので CORS を開ける必要がない |
| 却下した案 | web と api を別のポートで公開する: 守りが 2 か所に分かれ、片方が抜ける。CORS の設定も要る |
| 実物 | [edge/default.conf.template](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/edge/default.conf.template#L117-L144) |

### 4.2 設定は環境変数、秘密の値は別の置き場所 {#s4-2}
| 項目 | 内容 |
| --- | --- |
| 決定 | 動きを変えるつまみ(`RENDER_MODE`、`SSR_TIMEOUT_MS`、`EDGE_CACHE` など)はすべて環境変数。本格版では秘密の値を Secret に分ける |
| 理由 | 同じイメージを、設定だけ変えて全環境で使える |
| 却下した案 | 設定をコードに書く: 環境ごとにビルドし直すことになり、「検証で試した物」と「本番の物」が別物になる |
| 実物 | [k8s/manifests/configmap-app.yaml](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/k8s/manifests/configmap-app.yaml)・[secret.yaml](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/k8s/manifests/secret.yaml) |

### 4.3 わざと壊すスイッチ(障害の注入)を組み込む {#s4-3}
| 項目 | 内容 |
| --- | --- |
| 決定 | api に `latencyMs`・`errorRate`・`leakMb`・`idorBug`・`sqliBug` の 5 つのスイッチを持たせる。起動時は環境変数 `CHAOS_*`、動かしながらは `POST /admin/chaos` で切り替える。web には `SSR_WINDOW_BUG` を持たせる |
| 理由 | 見張り・逃げ道・守りは、壊れたときにしか効いているか分からない。安全な場所で何度でも壊せるようにする |
| 却下した案 | 外から壊す道具(ネットワークを切るなど)だけを使う: 準備が重く、認可の抜けや SQL インジェクションのような「書き方の事故」は再現できない |
| 実物 | [apps/api/src/chaos.js](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/apps/api/src/chaos.js#L19-L25)・[tools/chaos.sh](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/tools/chaos.sh) |

### 4.4 ログと指標の形をそろえる {#s4-4}
| 項目 | 内容 |
| --- | --- |
| 決定 | ログは全部品とも 1 行 1 JSON で標準出力へ。指標は api・web とも `http_requests_total{route,method,status}` と `http_request_duration_seconds` を同じ名前で出す |
| 理由 | 同じ式で api と web の成功率を計算できる。ログを項目で絞り込める |
| 却下した案 | 部品ごとに自由な形式: 障害のときに部品をまたいで追えない |
| 実物 | [apps/api/src/metrics.js](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/apps/api/src/metrics.js)・[apps/web/src/server.ts](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/apps/web/src/server.ts#L56-L84) |

### 4.5 版を固定する {#s4-5}
| 項目 | 内容 |
| --- | --- |
| 決定 | すべてのイメージのタグを固定する(例: `postgres:17.11-alpine`、`prom/prometheus:v3.15.0`)。`latest` は使わない |
| 理由 | いつ起動しても同じ物が動く。演習の手順と画面がずれない |
| 却下した案 | `latest`: ある日勝手に新しい版になり、設定の書き方が変わって起動しなくなる |
| 実物 | [docker-compose.yml](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/docker-compose.yml)・[observability/compose.yml](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/observability/compose.yml) |

## 5. 目標 {#s5}
| 項目 | 目標 | 計算式・根拠 | 測る場所 |
| --- | --- | --- | --- |
| 成功率(SLO) | 1 か月 99.9% | 失敗してよい割合 = 1 − 0.999 = 0.001。30 日 = 43,200 分 → 43,200 × 0.001 = **43.2 分/月** | Grafana「サンプルストア SLO」 |
| 緊急アラート | バーンレート 14.4 超(5 分窓 かつ 1 時間窓) | 1 時間で予算の 2% を使う速さ: 0.02 × 720 時間 ÷ 1 時間 = 14.4 | [SRE 方式 4.3](/design/architecture/05-sre#s4-3) |
| SSR の待ち時間 | 3000ms で打ち切り | 超えたら空の HTML を返す | [FE 方式 4.3](/design/architecture/01-frontend#s4-3) |
| 速さ(負荷試験の合格線) | p95 が 500ms 未満(普通の利用者) | k6 browse.js の `thresholds` | [性能方式 4.1](/design/architecture/07-performance#s4-1) |
| メモリ | 軽量版の上限の合計 約 2GB | 各サービスの `mem_limit` の合計 | docker-compose.yml |

## 6. 配下の詳細設計書 {#s6}
| 分野 | 詳細設計書 |
| --- | --- |
| FE | [D-FE-04 商品詳細画面](/design/detail/D-FE-04-product-detail)・[D-FE-22 SSR サーバー](/design/detail/D-FE-22-ssr-server) |
| BE | [D-BE 注文 API と認可](/design/detail/D-BE-orders-api) |
| インフラ | [D-INF-01 起動構成](/design/detail/D-INF-01-compose-and-k8s) |
| ネットワーク | [D-NW-01 edge の経路とキャッシュ](/design/detail/D-NW-01-edge-route) |
| SRE | [D-SRE-02 SLO とバーンレートのアラート](/design/detail/D-SRE-02-slo-burn-rate) |
| QA | [D-QA-04 E2E テスト](/design/detail/D-QA-04-e2e) |
| 性能 | [D-PERF-05 負荷試験](/design/detail/D-PERF-05-load-test) |
| 障害対応 | [D-INC-03 API の応答遅延](/design/detail/D-INC-03-slow-api) |
| DR | [D-DR-02 バックアップと復元](/design/detail/D-DR-02-backup-restore) |
| セキュリティ | [D-SEC-01 WAF とレート制限](/design/detail/D-SEC-01-waf-and-rate-limit) |

## 7. 未決事項 {#s7}
| # | 内容 | 決める人・時期 |
| --- | --- | --- |
| 1 | HTTPS(証明書)をラボに入れるか。入れると証明書の期限切れの演習ができるが、準備が重くなる | ラボの作り手 |
| 2 | 30 日のエラーバジェットの残りは、Prometheus の保存期間(7 日)より長い窓で計算している。ラボでは「起動してからの分」で見る前提でよいか | SRE 方式で扱う |

## 8. レビュー観点 {#s8}
- [ ] 利用者の通り道が 1 か所にまとまっているか。裏口(web や api を直接公開)が無いか
- [ ] 目標(99.9%)に計算式が付いていて、Grafana の数字とつながっているか
- [ ] 壊すスイッチは、既定で全部「切」になっているか(`CHAOS_*` が 0 / false)
- [ ] すべてのイメージの版が固定されているか
- [ ] 各層の「持ち主」が書いてあるか

## この設計を体験する演習 {#exercises}
- [SSR と CSR を見比べる](/exercises/01-fe-ssr-vs-csr)(全体の通り道を 1 周する)
- [SLI を測って SLO と比べる](/exercises/09-sre-sli-slo)(99.9% と 43.2 分)
- [API が遅い → SSR が逃げる](/exercises/14-incident-slow-api)(壊すスイッチ・逃げ道・見張りが一度に見える)
