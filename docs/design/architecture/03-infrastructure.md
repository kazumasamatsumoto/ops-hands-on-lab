# インフラ方式設計書(ラボ)

版: 2.0 / 親: [全体方式](/design/architecture/00-overall) / 対象: docker compose(軽量版)・kind(本格版)・manifest.json と環境 d1・s1・p1

::: tip 3 行まとめ(この文書で決めたこと)
- 軽量版(docker compose)と本格版(kind = Docker の中の Kubernetes)の 2 つを用意し、**同じイメージ**を使う。構成の正本は `manifest.json`。本格版の定義は `tools/manifest/render.mjs` が作り、軽量版の compose は手で合わせて食い違いを確かめる。
- 部品ごとにメモリの上限を決め、超えたら強制終了 → 自動で作り直す。root では動かさない。
- 環境は d1(開発)・s1(ステージング)・p1(本番)の 3 つ。違いは台数・キャッシュ・IP フィルタ・ログの細かさだけにし、kustomize の差分(オーバーレイ)で持つ。
:::

## 0. 位置づけ {#s0}
全体方式の「設定は環境変数」「版を固定する」「構成を manifest.json 1 か所に書く」を受けて、動かす土台を決めます。配下: [D-INF-01 起動構成](/design/detail/D-INF-01-compose-and-k8s)。

## 1. 目的と範囲 {#s1}
- **含む**: 2 つの版の役割、イメージの作り方、メモリの上限、ヘルスチェックと再起動、設定値と秘密情報、ローリング更新、manifest.json からの生成、環境 d1・s1・p1、ポート。
- **含まない**: 本物のクラウド、複数ノード、OS のパッチ(現場では要る。[必要なこと一覧](/guide/checklist))、ビルドとデプロイの自動化(CI/CD)。

## 2. 前提 {#s2}
| 前提 | 内容 |
| --- | --- |
| PC | Docker Desktop にメモリ 8GB。軽量版は上限の合計 約 2.5GB、本格版は およそ 3〜3.5GB(検証で測った値。kind のノード 約 3.0〜3.3GiB + クラスタの外の cdn-waf 50〜80MB。内訳は [k8s/README.md](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/k8s/README.md) の「使うメモリ」) |
| 同時起動 | 軽量版と本格版は同じポート(18080・13000・19090・19093・19094)を使うので、同時には動かせない |
| イメージ | 公開イメージだけを使い、タグを固定する。自分で作るのは `lab/web:local`(storefront)と `lab/api:local`(api・backoffice・worker)の 2 つ |
| 本格版の起動 | `LAB_ENV=d1\|s1\|p1 k8s/up.sh`(既定 p1)。環境を切り替えるだけなら `LAB_SKIP_BUILD=1` を付けてイメージのビルドを飛ばす。止めるのは `k8s/down.sh`(クラスタと cdn-waf のコンテナを消す) |

## 3. 全体像 {#s3}
| 項目 | 軽量版(docker compose) | 本格版(kind) |
| --- | --- | --- |
| 動かす単位 | コンテナ | Pod |
| 台数 | 1 つずつ | 環境ごと(p1: storefront 2・api 2・backoffice 1・worker 1) |
| 入口 | cdn-waf(ホスト 127.0.0.1:18080)→ ingress(nginx のコンテナ) | cdn-waf(クラスタの外のコンテナ)→ kind のノードの 80 番 = ingress-nginx(Ingress リソース)。cdn-waf はコンテナ `lab-cdn-waf`(ネットワーク `lab-kind` 172.30.91.0/24 の 172.30.91.10。社外の代わりの `lab-kind-outside` 172.30.92.0/24 にもつなぐ)で、行き先は `INGRESS_UPSTREAM=lab-control-plane:80`。ingress-nginx は v1.15.1(Namespace `ingress-nginx`) |
| 死活監視 | Docker の healthcheck(api 系は `/readyz`、storefront は `/healthz`) | readiness・liveness の probe |
| api のメモリ上限 | 256MB(`mem_limit`) | 256Mi(`resources.limits`)、予約 96Mi |
| 検索 | DB の検索で代用(`SEARCH_PROVIDER=db`) | Solr(`solr:9.10.1-slim`、Deployment・Service `search:8983`、コア `products`。3 環境とも `SEARCH_PROVIDER=solr`) |
| 版の入れ替え | 止めて作り直す | ローリング更新 |
| 構成の書き場所 | [docker-compose.yml](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/docker-compose.yml)(手で manifest.json に合わせる) | [k8s/generated/](https://github.com/kazumasamatsumoto/ops-hands-on-lab/tree/main/k8s/generated)(manifest.json から生成) |
| 起動 | `docker compose up -d --build` | `k8s/up.sh` |

## 4. 決定事項 {#s4}
### 4.1 2 つの版で同じイメージを使う {#s4-1}
| 項目 | 内容 |
| --- | --- |
| 決定 | storefront・api のイメージ(`lab/web:local`・`lab/api:local`)を 1 回作り、軽量版でも本格版でも、d1・s1・p1 のどの環境でも使う。違いは環境変数と台数だけ |
| 理由 | 「検証で試した物」と「本番で動く物」を同じにする考え方を、手元で体験する。CCv2 でも、1 回のビルドを環境ごとにデプロイする |
| 却下した案 | 環境ごと・版ごとに別の作り方: 動きが違うと、演習の結果も検証の結果も比べられない |
| 実物 | [docker-compose.yml](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/docker-compose.yml)・[manifest.json](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/manifest.json)(`images`) |

### 4.2 イメージの作り方 {#s4-2}
| 項目 | 内容 |
| --- | --- |
| 決定 | 2 段階(マルチステージ)で作り、2 段目には動かすのに要る物だけを入れる。一般ユーザー `node` で動かす(root で動かさない)。api のイメージはトレースの計測を先に読み込む(`node --require ./src/otel.js`) |
| 理由 | イメージを小さくし、乗っ取られたときにできることを減らす |
| 実物 | [apps/api/Dockerfile](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/apps/api/Dockerfile)・[apps/web/Dockerfile](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/apps/web/Dockerfile) |

### 4.3 メモリの上限 {#s4-3}
| 項目 | 内容 |
| --- | --- |
| 決定 | 全部品に上限を付ける。軽量版: db 256MB、api 256MB、backoffice 192MB、worker 192MB、storefront 384MB、ingress 64MB、cdn-waf 128MB、Prometheus 256MB、Alertmanager 64MB、pager 64MB、Grafana 256MB、Loki 256MB、Alloy 128MB。本格版(manifest.json の `resources`): storefront 予約 100m・256Mi / 上限 384Mi、api 50m・96Mi / 256Mi、backoffice と worker 50m・96Mi / 192Mi |
| 理由 | 1 つの部品のメモリ漏れで、同じ PC(ノード)の他の部品まで巻き込まない。超えた部品だけを落として作り直す |
| 却下した案 | 上限なし: 漏れた部品が PC のメモリを食い尽くし、全部が遅くなる |
| 実物 | [docker-compose.yml](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/docker-compose.yml)・[observability/compose.yml](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/observability/compose.yml)・[k8s/generated/base/api.yaml](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/k8s/generated/base/api.yaml) |

### 4.4 ヘルスチェックと再起動 {#s4-4}
| 項目 | 内容 |
| --- | --- |
| 決定 | 軽量版: api・backoffice・worker は `/readyz` を 10 秒ごと、storefront は `/healthz` を 10 秒ごとに確かめ、`restart: unless-stopped` で落ちたら再起動。storefront は api が healthy になってから起動する。本格版(api・backoffice・worker): 起動の間は startup = `/healthz`(2 秒ごと、最大 60 回 = 約 2 分待つ。通るまで liveness は始まらない)、readiness = `/readyz`(5 秒ごと、2 回続けて失敗で振り分けから外す)、liveness = `/healthz`(10 秒ごと、3 回続けて失敗で再起動)。止めるときは `preStop` で 5 秒待ってから合図を送る。storefront は startup・readiness・liveness とも `/healthz` |
| 理由 | 「客を送らない」と「作り直す」を別の基準にする。DB が落ちたときは振り分けから外すだけにして、再起動の連鎖を起こさない |
| 実物 | [apps/api/Dockerfile](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/apps/api/Dockerfile)(`HEALTHCHECK`)・[k8s/generated/base/api.yaml](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/k8s/generated/base/api.yaml) |

### 4.5 設定値と秘密情報 {#s4-5}
| 項目 | 内容 |
| --- | --- |
| 決定 | 秘密でない設定は manifest.json の `env`・`commonEnv`(本格版では Deployment の `env` と ConfigMap `lab-environment`)、軽量版は compose の `environment`。秘密の値(`PGPASSWORD`・`BACKOFFICE_PASSWORD`)は manifest.json に**名前だけ**を書き(`secrets`・`secretEnv`)、本格版では Secret `lab-secrets` から `secretKeyRef` で読む。軽量版の compose には見本の値(`store`・`admin`)だけを書く |
| 理由 | 設定と秘密を分けると、見てよい人・変えてよい人を分けられる。CCv2 でも、秘密の値は manifest ではなく Cloud Portal の秘密の置き場所に入れる |
| 却下した案 | 秘密の値を manifest やリポジトリに入れる: 公開した瞬間に漏れる。Secret は base64 にしただけで暗号ではないので、本番は外部の秘密管理や暗号化を使う |
| 実物 | [manifest.json](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/manifest.json)・[k8s/generated/base/backoffice.yaml](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/k8s/generated/base/backoffice.yaml)・[k8s/platform/secret.yaml](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/k8s/platform/secret.yaml)(Secret `lab-secrets` の見本の値 `PGPASSWORD: store`・`BACKOFFICE_PASSWORD: admin`) |

### 4.6 止めずに入れ替える {#s4-6}
| 項目 | 内容 |
| --- | --- |
| 決定 | 本格版の storefront・api・backoffice は `RollingUpdate`(`maxSurge: 1`、`maxUnavailable: 0`)。worker(定期ジョブ)だけは `Recreate`(入れ替えの間に同じジョブが二重に実行されるのを防ぐため。その間の数十秒はジョブが止まる)。止める合図から最大 20 秒待つ(`terminationGracePeriodSeconds: 20`)。アプリは合図を受けたら受付中の処理を終えてから止まる([BE 方式 4.8](/design/architecture/02-backend#s4-8)) |
| 理由 | 新しい Pod が準備できてから古い Pod を 1 つ減らすので、更新中も応える台数が減らない |
| 却下した案 | 全部止めてから入れ替える: 入れ替えの間サイトが止まる |
| 実物 | [k8s/generated/base/api.yaml](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/k8s/generated/base/api.yaml)・[storefront.yaml](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/k8s/generated/base/storefront.yaml) |

### 4.7 manifest.json から Kubernetes の定義を作る {#s4-7}
| 項目 | 内容 |
| --- | --- |
| 決定 | `node tools/manifest/render.mjs` が manifest.json を読み、`k8s/generated/base/`(storefront・api・backoffice・worker の Deployment と Service、エンドポイントごとの Ingress)と `k8s/generated/envs/d1\|s1\|p1/`(kustomize のオーバーレイ)を書き出す。生成物は手で直さない(先頭に注意書きがある)。軽量版は manifest から作らず手で合わせ、`render.mjs --check` で docker-compose.yml・ingress の設定との食い違いを確かめる。外部のパッケージは使わない(Node.js 24 だけで動く) |
| 理由 | manifest の 1 行(例: `endpoints[].ipFilter: "office"`)が、どの Kubernetes のリソース(Ingress の注釈 `allowlist-source-range`)になるかを見せる。CCv2 で manifest.json を書いてビルドすると裏で Kubernetes のリソースができる、のと同じ考え方 |
| 却下した案 | Helm などのテンプレートの道具を使う: 仕組みが隠れて、「何が作られたか」を目で追いにくい |
| 実物 | [tools/manifest/render.mjs](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/tools/manifest/render.mjs)・[tools/manifest/README.md](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/tools/manifest/README.md)・[k8s/generated/base/ingress.yaml](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/k8s/generated/base/ingress.yaml) |

### 4.8 環境 d1・s1・p1 {#s4-8}
| 項目 | 内容 |
| --- | --- |
| 決定 | 環境を 3 つにし、違いは manifest.json の `environments` だけに書く。d1(開発): 全部 1 台、cdn-waf のキャッシュなし、www・api も社内 IP だけ、`LOG_LEVEL=debug`。s1(ステージング): storefront 1・api 2 台、キャッシュあり、www・api も社内 IP だけ。p1(本番): storefront 2・api 2 台、キャッシュあり、www・api は誰でも。backoffice はどの環境でも社内 IP だけ。3 環境とも検索は Solr。環境の違いは ConfigMap `lab-environment`(`LAB_ENV`・`EDGE_CACHE`・`SEARCH_PROVIDER`)とパッチ(`patches/env-*.yaml`・`patches/ip-filter-*.yaml`)になる |
| 理由 | 同じイメージ・同じ base を使い、差分だけを環境ごとに持つと、「検証で通ったのに本番で落ちる」の原因(環境の違い)が一覧で見える。開発・検証の環境を社内だけに絞るのは、CCv2 の案件でもよく使われる分け方 |
| 却下した案 | 環境ごとに YAML を丸ごと複製する: 1 か所直すと 3 か所直すことになり、そのうち食い違う |
| 実物 | [manifest.json](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/manifest.json)(`environments`)・[k8s/generated/envs/](https://github.com/kazumasamatsumoto/ops-hands-on-lab/tree/main/k8s/generated/envs)。クラスタの外の cdn-waf は、`k8s/up.sh` が ConfigMap `lab-environment` の `EDGE_CACHE` を読んで起動する(`docker run -e EDGE_CACHE=…`。d1 は off、s1・p1 は on。`EDGE_CACHE=off k8s/up.sh` のように手で渡した値が優先)。環境を切り替えるたびに cdn-waf のコンテナは作り直される |

## 5. 目標 {#s5}
| 項目 | 目標 | 計算・根拠 |
| --- | --- | --- |
| 更新中に応える api の台数(p1) | 2 台を下回らない | `replicas: 2` − `maxUnavailable: 0` = 2 |
| 軽量版のメモリ | 約 2.5GB 以内 | 256+256+192+192+384+64+128(アプリと入口)+256+64+64+256+256+128(観測)= 2,496MB |
| 生成物と manifest の食い違い | 0 件 | `node tools/manifest/render.mjs --check` |

## 6. 配下の詳細設計書 {#s6}
- [D-INF-01 起動構成(compose と Kubernetes)](/design/detail/D-INF-01-compose-and-k8s)

## 7. 未決事項 {#s7}
| # | 内容 |
| --- | --- |
| 1 | 本格版に HPA(混み具合で台数を自動で増やす)を入れるか。今は manifest の台数と手の操作で変える |
| 2 | `ipFilters.office` に軽量版(`172.30.89.0/24`)と本格版(`172.30.91.0/24`)の両方のネットワークが入っている。版ごとに範囲を分けるか(今は両方に同じ一覧を使う) |
| 3 | 軽量版の compose も manifest.json から作るか(今は手で合わせる) |

## 8. レビュー観点 {#s8}
- [ ] 全部品にメモリの上限があるか
- [ ] readiness と liveness が別の基準になっているか(liveness が DB を見ていないか)
- [ ] 更新中に応える台数が減らない設定か(`maxUnavailable`)
- [ ] 秘密の値が manifest やリポジトリに入っていないか(入っているなら見本の値だと分かるか)
- [ ] 環境の違いが一覧(manifest の `environments`)になっていて、それ以外に手で足した違いが無いか
- [ ] 生成物を手で直していないか(`render.mjs --check` が通るか)
- [ ] root で動いていないか

## この設計を体験する演習 {#exercises}
- [インフラ-1 止めずに版を上げる(ローリング更新)](/exercises/05-infra-rolling-update)
- [インフラ-2 設定値とシークレットを環境で分ける](/exercises/06-infra-config-and-secrets)
- [障害-2 メモリ不足で再起動を繰り返す](/exercises/15-incident-crashloop)
- [ネットワーク-3 Ingress とエンドポイント](/exercises/20-nw-ingress-endpoints)(manifest の 1 行が Ingress になる)
