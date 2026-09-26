# 全体方式設計書(ラボ)

版: 2.0 / 対象: サンプルストア 体験ラボ / 状態: 実物と一致(値はすべて設定ファイルから)

::: tip 3 行まとめ(この文書で決めたこと)
- 形を CCv2 + ヘッドレスに寄せます。入口は **cdn-waf(クラスタの外の CDN・WAF)→ ingress(3 つのエンドポイント)** の 2 段、中は storefront・api・backoffice・worker・db に分け、api・backoffice・worker は同じイメージを `ASPECT` で使い分けます。
- 目標は「1 か月の成功率 99.9%」。失敗してよい量は 1 か月で約 43.2 分ぶん。これを毎日測って、減る速さでアラートを鳴らします。
- 構成は `manifest.json` の 1 か所に書き、`tools/manifest/render.mjs` で本格版(Kubernetes)の定義を作ります。障害や脆弱性を**わざと起こすスイッチ**も最初から組み込みます。
:::

## 0. 位置づけ {#s0}
このラボの設計書は 3 段です。

| 段 | 文書 | 決めること |
| --- | --- | --- |
| 全体方式 | この文書 | 層をまたぐ決定(構成・入口・設定・壊すスイッチ・版・manifest)と非機能の目標 |
| 分野ごとの方式 | [FE](/design/architecture/01-frontend)・[BE](/design/architecture/02-backend)・[インフラ](/design/architecture/03-infrastructure)・[ネットワーク](/design/architecture/04-network)・[SRE](/design/architecture/05-sre)・[QA](/design/architecture/06-qa)・[性能](/design/architecture/07-performance)・[障害対応](/design/architecture/08-incident-response)・[DR](/design/architecture/09-disaster-recovery)・[セキュリティ](/design/architecture/10-security) | その分野の中の方針 |
| 詳細 | 詳細設計書 12 本(第 6 章) | 画面 1 つ、API 1 つ、監視項目 1 つ… の具体的な値 |

各部品が「どういう仕組みで動いているか」(1 リクエストの流れ・設定の各行・確かめるコマンド)は、[仕組み](/how-it-works/00-overview) のページで説明しています。この設計書は「何を決めたか・なぜか」を書く場所です。

## 1. 目的と範囲 {#s1}
- **目的**: 開発と運用に必要なことを、小さな実物で全部そろえ、演習で触れるようにする。形を CCv2(SAP Commerce Cloud)でヘッドレスのお店を動かすときに寄せ、ラボで覚えたことが実案件の構成図・API の URL にそのまま重なるようにする。
- **含む**: 架空のネットストア(トップ・検索・商品詳細・ログイン・注文履歴)、CMS 駆動の画面、OCC 風の API と OAuth、管理画面(backoffice)、定期ジョブ(worker)、入口の CDN・WAF(cdn-waf)とエンドポイント(ingress)、指標・ログ・アラート・トレース、負荷試験・E2E・バックアップの道具、軽量版(docker compose)と本格版(kind)、環境 d1・s1・p1。
- **含まない**: 本物の決済、メール送信、HTTPS の証明書、外部サービスへの通知、複数拠点、SAP の製品そのもの。現場で必要なものは [必要なこと一覧](/guide/checklist) で「ラボでは扱わない」と示す。

## 2. 前提 {#s2}
| 前提 | 内容 |
| --- | --- |
| 動かす場所 | 学ぶ人の PC の Docker Desktop(割り当てメモリ 8GB)。外部には何も送らない |
| メモリの合計 | 軽量版の上限の合計はおよそ 2.5GB([docker-compose.yml](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/docker-compose.yml) と [observability/compose.yml](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/observability/compose.yml) の `mem_limit`) |
| ポート | 8080・3000 は他のアプリとよくぶつかるので 1 万番台にする(cdn-waf 18080(3 つのホスト名すべて)、Grafana 13000、Prometheus 19090、Alertmanager 19093、pager 19094)。18080 は 127.0.0.1 にだけ開ける |
| ホスト名 | `www.lab.localhost`・`api.lab.localhost`・`backoffice.lab.localhost`。`*.localhost` は Chrome・Edge・Firefox・curl では設定なしで 127.0.0.1 になる(Safari は hosts に書く場合あり) |
| 公開 | リポジトリは公開する。秘密の値は「見本の値」だけを置く。SAP の資料の文章は載せない(呼び方の対応だけを書く) |

## 3. 全体像 {#s3}
```text
ブラウザ / k6 / Playwright
   │ http://www.lab.localhost:18080 ・ http://api.lab.localhost:18080 ・ http://backoffice.lab.localhost:18080
   ▼
cdn-waf(nginx + ModSecurity + OWASP CRS)… クラスタの外の CDN・WAF。キャッシュ・WAF・全体のレート制限・ヘッダ
   ▼
ingress(軽量版: nginx / 本格版: ingress-nginx)… ホスト名で 3 つのエンドポイントに振り分け、IP フィルタ
   ├── www.lab.localhost        → storefront:4000(Angular 21 SSR)──SSR 中は中の近道で──▶ api:3001
   ├── api.lab.localhost        → api:3001(ASPECT=api。OCC 風 REST・OAuth・/medias/)
   └── backoffice.lab.localhost → backoffice:3001(ASPECT=backoffice。社内 IP だけ)
       (外に出さない)             worker:3001(ASPECT=backgroundProcessing。定期ジョブ)
   ▼
db:5432(PostgreSQL 17) / search(軽量版は DB の検索で代用。本格版は Solr)
観測: Prometheus(5 秒ごと)→ Alertmanager → pager / Alloy → Loki / Grafana / 本格版だけ OpenTelemetry Collector → Tempo
```

| 層 | 部品 | CCv2 で当たるもの | 持ち主(誰が決めるか) |
| --- | --- | --- | --- |
| 入口(外) | cdn-waf | 別に契約する CDN・WAF | ネットワーク方式・セキュリティ方式 |
| 入口(中) | ingress | Cloud Portal の「エンドポイント」と「IP フィルタ」 | ネットワーク方式・セキュリティ方式 |
| 画面 | storefront | JS Storefront(SSR) | FE 方式 |
| API | api | api aspect(OCC の REST API・OAuth の認可サーバー) | BE 方式 |
| 管理 | backoffice | backoffice aspect | BE 方式・セキュリティ方式 |
| 定期ジョブ | worker | backgroundProcessing aspect(CronJob が動く所) | BE 方式・SRE 方式 |
| データ | db・search | DB と Solr | BE 方式・DR 方式 |
| 見張り | Prometheus・Alertmanager・pager・Grafana・Loki・Alloy(本格版は + OTel Collector・Tempo) | 監視の道具(APM・ログ検索) | SRE 方式 |
| 土台 | docker compose・kind・manifest.json | manifest.json とビルド・デプロイ、環境 d1・s1・p1 | インフラ方式 |

責任分界: ラボでは 1 人が全部を持ちます。現場では上の「持ち主」の列に、チーム名と連絡先を書きます。CCv2 では「外の CDN・WAF はお客さん側で用意する(Cloud Portal にも簡易な WAF はある)」「クラスタと Solr・DB は提供側」「storefront と aspect の中身は開発チーム」のように持ち主が分かれるので、特にここを書かないと障害のときに誰が動くかで迷います。

## 4. 決定事項 {#s4}
### 4.1 利用者の通り道は cdn-waf の 1 か所だけ {#s4-1}
| 項目 | 内容 |
| --- | --- |
| 決定 | 画面(www)・API(api)・管理画面(backoffice)の 3 つのホスト名とも、ホスト PC の `127.0.0.1:18080`(cdn-waf)だけから入れる。cdn-waf は振り分けをせず、ホスト名を付けたまま全部を ingress に渡す。storefront・api・backoffice・worker・db はホストにポートを出さない |
| 理由 | キャッシュ・WAF・全体のレート制限・ヘッダを 1 か所で掛けられる。裏口(アプリを直接公開)が無いので、守りが抜ける場所ができない |
| 却下した案 | 画面と API を別のポートで直接公開する: 守りが 2 か所に分かれ、片方が抜ける |
| 実物 | [docker-compose.yml の cdn-waf](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/docker-compose.yml)・[cdn-waf/default.conf.template](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/cdn-waf/default.conf.template) |

### 4.2 設定は環境変数、秘密の値は別の置き場所 {#s4-2}
| 項目 | 内容 |
| --- | --- |
| 決定 | 動きを変えるつまみ(`RENDER_MODE`、`SSR_TIMEOUT_MS`、`EDGE_CACHE`、`SEARCH_PROVIDER`、`CORS_ALLOWED_ORIGINS`、`BACKOFFICE_IP_ALLOWLIST` など)はすべて環境変数。秘密の値(`PGPASSWORD`・`BACKOFFICE_PASSWORD`)は manifest.json には名前だけを書き、本格版では Secret `lab-secrets` から読む |
| 理由 | 同じイメージを、設定だけ変えて d1・s1・p1 で使える。storefront の api の住所も JS に焼き込まず、HTML の `<meta name="api-public-url">` で渡す |
| 却下した案 | 設定をコードに書く: 環境ごとにビルドし直すことになり、「検証で試した物」と「本番の物」が別物になる |
| 実物 | [manifest.json](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/manifest.json)(`secrets`・`env`・`secretEnv`)・[docker-compose.yml](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/docker-compose.yml) |

### 4.3 わざと壊すスイッチ(障害の注入)を組み込む {#s4-3}
| 項目 | 内容 |
| --- | --- |
| 決定 | api に `latencyMs`・`errorRate`・`leakMb`・`idorBug`・`sqliBug`、worker に `cronFail` のスイッチを持たせる。起動時は環境変数 `CHAOS_*`、動かしながらは `POST /admin/chaos`(ingress で外から閉じているので `tools/chaos.sh` がコンテナの中から呼ぶ)。storefront には `SSR_WINDOW_BUG` を持たせる。既定はすべて「切」 |
| 理由 | 見張り・逃げ道・守りは、壊れたときにしか効いているか分からない。安全な場所で何度でも壊せるようにする |
| 却下した案 | 外から壊す道具(ネットワークを切るなど)だけを使う: 準備が重く、認可の抜けや SQL インジェクションのような「書き方の事故」は再現できない |
| 実物 | [apps/api/src/chaos.js](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/apps/api/src/chaos.js)・[tools/chaos.sh](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/tools/chaos.sh) |

### 4.4 ログ・指標・トレースの形をそろえる {#s4-4}
| 項目 | 内容 |
| --- | --- |
| 決定 | ログは全部品とも 1 行 1 JSON で標準出力へ(`service` を付ける)。指標は storefront・api・backoffice・worker とも `http_requests_total{route,method,status}` と `http_request_duration_seconds` を同じ名前で出す。トレースは `OTEL_EXPORTER_OTLP_ENDPOINT` があるときだけ送り、ログに `trace_id` を入れる |
| 理由 | 同じ式で storefront と api の成功率を計算できる。ログを項目で絞り込み、`trace_id` で 1 リクエストの道筋に飛べる |
| 却下した案 | 部品ごとに自由な形式: 障害のときに部品をまたいで追えない |
| 実物 | [apps/api/src/metrics.js](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/apps/api/src/metrics.js)・[apps/api/src/log.js](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/apps/api/src/log.js)・[apps/web/src/server.ts](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/apps/web/src/server.ts) |

### 4.5 版を固定する {#s4-5}
| 項目 | 内容 |
| --- | --- |
| 決定 | すべてのイメージのタグを固定する(例: `postgres:17.11-alpine`、`nginx:1.30.4-alpine`、`owasp/modsecurity-crs:4.25.1-nginx-alpine-202609241109-lts`、`prom/prometheus:v3.15.0`)。`latest` は使わない |
| 理由 | いつ起動しても同じ物が動く。演習の手順と画面がずれない |
| 却下した案 | `latest`: ある日勝手に新しい版になり、設定の書き方が変わって起動しなくなる |
| 実物 | [docker-compose.yml](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/docker-compose.yml)・[observability/compose.yml](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/observability/compose.yml) |

### 4.6 CCv2 + ヘッドレスの形に寄せる {#s4-6}
| 項目 | 内容 |
| --- | --- |
| 決定 | 画面(storefront)とサーバー(api)を分けたヘッドレスの作りにし、URL・呼び方・部品の分け方を CCv2 に合わせる: 入口は cdn-waf(外の CDN・WAF)と ingress(エンドポイント)の 2 段、API は `/occ/v2/samplestore/...`、ログインは `/authorizationserver/oauth/token`、画面は CMS の JSON(`cms/pages`)から組み立てる、サーバー側は 1 つのイメージを aspect(`api`・`backoffice`・`backgroundProcessing`)で使い分ける |
| 理由 | 読み手が実案件で見る構成図・Cloud Portal の画面・API の URL と、ラボの部品を 1 対 1 で結びつけられる。「ラボでは分かったが実案件では別物」にならない |
| 却下した案 | 1 つのアプリに画面と API を同居させる(第 1 版の形): 分かりやすいが、CORS・エンドポイント・aspect・CMS 駆動の描画といった、実案件でつまずく所が体験できない |
| 実物 | [LAB_SPEC.md の「CCv2 との対応」](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/LAB_SPEC.md)・[apps/api/src/main.js](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/apps/api/src/main.js)・[apps/web/src/app/cms/cms-mapping.ts](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/apps/web/src/app/cms/cms-mapping.ts) |

| ラボ | CCv2 / ヘッドレスで当たるもの |
| --- | --- |
| cdn-waf | 外部の CDN・WAF |
| ingress のホスト名ごとの振り分け / IP 制限 | Cloud Portal の「エンドポイント」/「IP フィルタ」 |
| storefront | JS Storefront(SSR) |
| api の `/occ/v2/...` / `/authorizationserver/oauth/token` | OCC の REST API / OAuth の認可サーバー |
| `ASPECT` | aspect(api・backoffice・backgroundProcessing) |
| worker の定期ジョブ | CronJob |
| `manifest.json` と `render.mjs` | manifest.json とビルド |
| `k8s/generated/envs/d1・s1・p1` | 環境 d1・s1・p1 |
| Prometheus・Grafana・Tempo / Loki | APM / ログ検索 |

### 4.7 構成を manifest.json 1 か所に書く {#s4-7}
| 項目 | 内容 |
| --- | --- |
| 決定 | storefront と 3 つの aspect の台数・環境変数・秘密の名前・メモリ、3 つのエンドポイント(ホスト名・行き先・IP フィルタ・閉じるパス・回数制限)、環境 d1・s1・p1 の違いを、リポジトリ直下の `manifest.json` に書く(このラボ独自の形。CCv2 の書式そのものではない)。本格版の定義は `node tools/manifest/render.mjs` で `k8s/generated/` に作り、軽量版の compose は手で合わせて `--check` で食い違いを確かめる |
| 理由 | 「manifest に 1 行書くと、裏でこういうリソースができる」を目で確かめられる。構成の正本が 1 か所なので、版の間・環境の間でずれない |
| 却下した案 | Kubernetes の YAML を手で書き、compose と別々に持つ: 2 か所を直す必要があり、片方だけ古くなる |
| 実物 | [manifest.json](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/manifest.json)・[tools/manifest/render.mjs](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/tools/manifest/render.mjs)・[tools/manifest/README.md](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/tools/manifest/README.md)・[k8s/generated/](https://github.com/kazumasamatsumoto/ops-hands-on-lab/tree/main/k8s/generated) |

## 5. 目標 {#s5}
| 項目 | 目標 | 計算式・根拠 | 測る場所 |
| --- | --- | --- | --- |
| 成功率(SLO) | 1 か月 99.9%(storefront と api) | 失敗してよい割合 = 1 − 0.999 = 0.001。30 日 = 43,200 分 → 43,200 × 0.001 = **43.2 分/月** | Grafana「サンプルストア SLO」 |
| 緊急アラート | バーンレート 14.4 超(5 分窓 かつ 1 時間窓) | 1 時間で予算の 2% を使う速さ: 0.02 × 720 時間 ÷ 1 時間 = 14.4 | [SRE 方式 4.3](/design/architecture/05-sre#s4-3) |
| 定期ジョブ | 最後の成功から 5 分(300 秒)以内 | `time() - cronjob_last_success_timestamp_seconds > 300` で警告 | [SRE 方式 4.8](/design/architecture/05-sre#s4-8) |
| SSR の待ち時間 | 3000ms で打ち切り | 超えたら空の HTML を返す | [FE 方式 4.3](/design/architecture/01-frontend#s4-3) |
| 速さ(負荷試験の合格線) | p95 が 500ms 未満(普通の利用者) | k6 browse.js の `thresholds` | [性能方式 4.1](/design/architecture/07-performance#s4-1) |
| メモリ | 軽量版の上限の合計 約 2.5GB | 各サービスの `mem_limit` の合計 = 2,496MB | docker-compose.yml |

## 6. 配下の詳細設計書 {#s6}
| 分野 | 詳細設計書 |
| --- | --- |
| FE | [D-FE-04 商品詳細画面](/design/detail/D-FE-04-product-detail)・[D-FE-05 CMS 駆動の描画(ヘッドレス)](/design/detail/D-FE-05-headless-cms)・[D-FE-22 SSR サーバー](/design/detail/D-FE-22-ssr-server) |
| BE | [D-BE 注文 API と認可](/design/detail/D-BE-orders-api) |
| インフラ | [D-INF-01 起動構成](/design/detail/D-INF-01-compose-and-k8s) |
| ネットワーク | [D-NW-01 cdn-waf と ingress の経路とキャッシュ](/design/detail/D-NW-01-edge-route) |
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
| 2 | 軽量版の compose を manifest.json から自動で作るか(今は手で合わせ、`render.mjs --check` で確かめる) | インフラ方式で扱う |
| 3 | 本格版のトレース(Tempo)を軽量版にも入れるか。今は軽量版はメモリを抑えるため指標とログだけ | SRE 方式で扱う |

## 8. レビュー観点 {#s8}
- [ ] 利用者の通り道が cdn-waf の 1 か所にまとまっているか。裏口(storefront や api を直接公開)が無いか
- [ ] 各部品が CCv2 のどれに当たるか、持ち主が誰かが書いてあるか
- [ ] 目標(99.9%)に計算式が付いていて、Grafana の数字とつながっているか
- [ ] 壊すスイッチは、既定で全部「切」になっているか(`CHAOS_*` が 0 / false)
- [ ] すべてのイメージの版が固定されているか
- [ ] manifest.json・compose・k8s/generated が食い違っていないか(`render.mjs --check`)

## この設計を体験する演習 {#exercises}
- [FE-1 SSR と CSR を見比べる](/exercises/01-fe-ssr-vs-csr)(全体の通り道を 1 周する)
- [ネットワーク-3 Ingress とエンドポイント](/exercises/20-nw-ingress-endpoints)(入口の 2 段と 3 つのホスト名)
- [ヘッドレス-1 CMS の JSON が画面になるまで](/exercises/21-headless-cms)
- [SRE-1 SLI を測って SLO と比べる](/exercises/09-sre-sli-slo)(99.9% と 43.2 分)
- [障害-1 API が遅い → SSR が逃げる](/exercises/14-incident-slow-api)(壊すスイッチ・逃げ道・見張りが一度に見える)
