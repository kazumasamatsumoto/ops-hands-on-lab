---
title: 仕組み-12 manifest と環境(d1・s1・p1)
---

# 仕組み-12 manifest と環境(d1・s1・p1)

::: tip このページで分かること
- `manifest.json` の項目 1 つずつが、`tools/manifest/render.mjs` を通って、どんな Kubernetes の YAML になるか。
- 環境 d1(開発)・s1(ステージング)・p1(本番)の違いと、その違いが YAML のどこに現れるか。
- 軽量版(docker-compose.yml)と manifest.json の関係(手で合わせ、`--check` で食い違いを見る)。
- CCv2 の manifest.json・ビルド・環境との対応。
:::

## 1. 一言でいうと {#s1}

`manifest.json` は、お店の構成の **設計図** です。「どの部品を、どの役(aspect)で、何台、どの環境変数で動かし、どのホスト名で外に出し、どこからの人を通すか」を 1 か所に書きます。
`render.mjs` がそれを読んで、Kubernetes が分かる YAML(Deployment・Service・Ingress と、環境ごとの差分)を書き出します。

**たとえ: 家の間取り図と施工図**

- manifest.json … お客さんと決める **間取り図**。「寝室 2 つ、南向き、玄関は 1 つ」のように、何が欲しいかだけを書く。
- render.mjs … 間取り図から **施工図** を起こす設計士。柱の位置や配線(YAML の細かい書き方)は設計士が決まった書き方で描く。
- k8s/generated/ … 施工図。職人(Kubernetes)はこれを見て建てる。施工図を直接いじらず、直したいときは間取り図を直して描き直す。
- 環境 d1・s1・p1 … 同じ間取り図から建てる **モデルルーム・内覧会用・本物の家**。部屋数(台数)や鍵(IP フィルタ)だけが違う。

## 2. 1 リクエストの流れ {#s2}

ここでの「1 リクエスト」は、**manifest に 1 行書いてから、それが動いている Pod になるまで** の流れです。

```text
 ① manifest.json を直す              例: aspects の api の "replicas": 2
 ② node tools/manifest/render.mjs    manifest.json を読み、k8s/generated/ を丸ごと書き直す
      base/api.yaml                  Deployment(replicas: 2・環境変数・プローブ・resources)+ Service
      base/ingress.yaml              エンドポイントごとの Ingress(ホスト名・IP フィルタ・回数制限・閉じる口)
      envs/p1/kustomization.yaml     環境 p1 の差分(台数・ConfigMap lab-environment・パッチの一覧)
      envs/p1/patches/*.yaml         環境変数・IP フィルタの上書き
 ③ kubectl kustomize k8s/generated/envs/p1
                                     base に p1 の差分を重ねた「最終の YAML」を組み立てる(見るだけ。クラスタは要らない)
 ④ LAB_ENV=p1 k8s/up.sh              ③ と同じ物を kubectl apply でクラスタに渡す
 ⑤ Kubernetes                        あるべき姿(api は 2 台)と今の姿を比べ、足りなければ Pod を作る
```

軽量版は manifest から作りません。docker-compose.yml と ingress の設定を **手で** manifest に合わせ、`node tools/manifest/render.mjs --check` で食い違いが無いかを確かめます。

```text
 manifest.json ──render.mjs──▶ k8s/generated/(本格版)
      │
      └──(手で合わせる)──▶ docker-compose.yml・ingress/default.conf.template(軽量版)
                              ▲
                              └── render.mjs --check が突き合わせる
```

## 3. 設定の読み方 {#s3}

### 3.1 aspect 1 つぶん {#s3-1}

[manifest.json](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/manifest.json):

```json
    {
      "name": "api",
      "service": "api",
      "port": 3001,
      "replicas": 2,
      "env": {
        "CORS_ALLOWED_ORIGINS": "http://www.lab.localhost:18080",
        "SEARCH_PROVIDER": "db"
      },
      "secretEnv": ["PGPASSWORD"],
      "resources": { "cpu": "50m", "memory": "96Mi", "memoryLimit": "256Mi" }
    },
```

これが [k8s/generated/base/api.yaml](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/k8s/generated/base/api.yaml) の次の部分になります。

| manifest.json | できる YAML | 意味 |
| --- | --- | --- |
| `"name": "api"` | `env: ASPECT=api`・ラベル `lab/aspect: api` | どの役で動かすか([仕組み-8](./08-aspects-and-worker)) |
| `"service": "api"` | Deployment と Service の `name: api` | クラスタの中の住所 `http://api:3001` になる |
| `"port": 3001` | `containerPort: 3001`・Service の `port: 3001` | 待ち受けるポート |
| `"replicas": 2` | `spec.replicas: 2` | 台数(環境で上書きされる) |
| `"env"` | `env:` の並び | 環境変数 |
| `"secretEnv": ["PGPASSWORD"]` | `valueFrom.secretKeyRef`(Secret `lab-secrets` の鍵 `PGPASSWORD`) | 秘密の値は manifest にも YAML にも書かない |
| `"resources"` | `requests.cpu: 50m`・`requests.memory: 96Mi`・`limits.memory: 256Mi` | 予約と上限([仕組み-3](./03-kubernetes-basics)) |
| `commonEnv`(`PGHOST` など) | 3 つの aspect すべての `env:` | aspect に共通の環境変数 |
| `images.platform` | `image: "lab/api:local"` | 3 つの aspect に共通のイメージ |
| `tracing.otlpEndpoint` | `env: OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-collector:4318` | トレースの送り先(本格版だけ。[仕組み-11](./11-observability)) |

どの Deployment にも、決まった形で `startupProbe`・`readinessProbe`・`livenessProbe`・`RollingUpdate(maxUnavailable: 0, maxSurge: 1)` が付きます。これは manifest に書かず、render.mjs が「この会社の決まり」として描き足す部分です。

### 3.2 エンドポイント 1 つぶん {#s3-2}

```json
    {
      "name": "api",
      "host": "api.lab.localhost",
      "service": "api",
      "ipFilter": null,
      "blockedPaths": ["/admin", "/metrics", "/readyz"],
      "rateLimits": [{ "path": "/authorizationserver/oauth/token", "rps": 1, "burst": 5 }]
    },
```

これが [k8s/generated/base/ingress.yaml](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/k8s/generated/base/ingress.yaml) の 3 つの Ingress になります。

| manifest.json | できる Ingress | 意味 |
| --- | --- | --- |
| `"name": "api"`・`"host"`・`"service"` | Ingress `api`(`host: api.lab.localhost` → Service `api`) | エンドポイント([仕組み-2](./02-ingress-and-endpoints)) |
| `"ipFilter": null` | 注釈なし | 誰でも通す(`"office"` なら注釈 `allowlist-source-range` が付く) |
| `"blockedPaths"` | Ingress `api-blocked`(注釈 `denylist-source-range: "0.0.0.0/0"` で、どの IP からでも 403) | 中の人だけの口を閉じる(中の見張りは Ingress を通らず直接取りに行く) |
| `"rateLimits"` | Ingress `api-ratelimit-1`(注釈 `limit-rps: "1"`・`limit-burst-multiplier: "5"`) | パスごとの回数制限 |

### 3.3 環境 1 つぶん {#s3-3}

```json
    "d1": {
      "description": "開発環境。1 台ずつ、キャッシュなし(変えた物がすぐ見える)、お店も社内からだけ",
      "replicas": { "storefront": 1, "api": 1, "backoffice": 1, "backgroundProcessing": 1 },
      "cdnCache": false,
      "ipFilterOverrides": { "www": "office", "api": "office" },
      "searchProvider": "solr",
      "env": { "LOG_LEVEL": "debug" }
    },
```

これが [k8s/generated/envs/d1/kustomization.yaml](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/k8s/generated/envs/d1/kustomization.yaml) とパッチになります。

```yaml
# 環境 d1: 開発環境。1 台ずつ、キャッシュなし(変えた物がすぐ見える)、お店も社内からだけ
namespace: lab
resources:
  - ../../base
replicas:
  - name: storefront
    count: 1
  - name: api
    count: 1
  ...
configMapGenerator:
  - name: lab-environment
    literals:
      - "LAB_ENV=d1"
      - "EDGE_CACHE=off"
      - "SEARCH_PROVIDER=solr"
patches:
  - path: patches/env-api.yaml
  - path: patches/ip-filter-www.yaml
  ...
```

- `resources: - ../../base` … 共通の部分(base)を土台にします。
- `replicas:` … 台数だけを上書きします。manifest の `backgroundProcessing` は、Deployment の名前 `worker` に直して書かれます。
- `configMapGenerator` … 環境の情報を ConfigMap `lab-environment` に入れます。`EDGE_CACHE=off` は、クラスタの外の cdn-waf が起動のときに読みます(`cdnCache: false` のため)。
- `patches:` … 環境変数(`LOG_LEVEL=debug`・`SEARCH_PROVIDER=solr`)と IP フィルタ(www・api も社内だけ)の上書きです。

kustomize(カスタマイズ)は、「土台の YAML に、環境ごとの差分を重ねる」道具です。コピーして 3 通り書くと、直し忘れで環境ごとに食い違いますが、差分だけを持てば「違うのはここだけ」が一目で分かります。

### 3.4 d1・s1・p1 の違い {#s3-4}

| | d1(開発) | s1(ステージング) | p1(本番) |
| --- | --- | --- | --- |
| 台数 storefront / api / backoffice / worker | 1 / 1 / 1 / 1 | 1 / 2 / 1 / 1 | 2 / 2 / 1 / 1 |
| cdn-waf のキャッシュ(`cdnCache`) | なし(変えた物がすぐ見える) | あり | あり |
| www・api の IP フィルタ | 社内だけ | 社内だけ | 誰でも |
| backoffice の IP フィルタ | 社内だけ | 社内だけ | 社内だけ |
| 検索(`searchProvider`) | solr | solr | solr |
| ログの細かさ(`LOG_LEVEL`) | debug | info | info |

- **s1 を本番と同じ設定にする理由**: 本番で初めて起きる失敗(キャッシュが効いているときだけ起きる不具合など)を、本番の手前で見つけるためです。台数だけ少なくしてお金を節約します。
- **d1 でキャッシュを切る理由**: 開発中は「直したのに画面が変わらない」が一番の時間の無駄だからです([仕組み-5](./05-headless-cms))。

## 4. 確かめるコマンド {#s4}

```bash
# 軽量版と manifest が食い違っていないか(Node.js 24 だけで動く)
node tools/manifest/render.mjs --check
# → manifest.json と docker-compose.yml・ingress/default.conf.template は食い違っていません(軽量版の既定値で比べています)。

# manifest から YAML を作り直す
node tools/manifest/render.mjs
git diff --stat k8s/generated/       # 何が変わったか

# 環境ごとの最終の YAML を見比べる(クラスタは要らない)
kubectl kustomize k8s/generated/envs/d1 > /tmp/d1.yaml
kubectl kustomize k8s/generated/envs/p1 > /tmp/p1.yaml
diff /tmp/d1.yaml /tmp/p1.yaml | head -40
# → replicas の数・LOG_LEVEL・EDGE_CACHE・allowlist-source-range の行が違う

# 1 行書くと裏でリソースが変わる、を体験する
#   manifest.json の environments.p1.replicas の "api" を 3 にする → render → envs/p1/kustomization.yaml の api が count: 3
#   (aspects[] の "replicas" は base の値。d1・s1・p1 はどれも environments.*.replicas で上書きするので、
#    台数を変えたいときは environments.*.replicas を直す)
grep -A1 'name: api' k8s/generated/envs/p1/kustomization.yaml

# 環境を切り替えて起動する(本格版)
LAB_ENV=d1 k8s/up.sh
kubectl -n lab get configmap lab-environment -o yaml | grep -E 'LAB_ENV|EDGE_CACHE|SEARCH_PROVIDER'
kubectl -n lab get deploy                        # d1 ならどれも 1/1
```

- 環境を切り替えると、`k8s/up.sh` は最後に cdn-waf のコンテナ(`lab-cdn-waf`)を消して作り直します。キャッシュの ON/OFF(`EDGE_CACHE`)は、そのとき ConfigMap `lab-environment` から読みます(d1 は off、s1・p1 は on)。作り直すので、ためていたキャッシュも空になります。
- イメージを変えていないときは `LAB_SKIP_BUILD=1` を付けると、ビルドを飛ばして早く切り替わります(例: `LAB_ENV=d1 LAB_SKIP_BUILD=1 k8s/up.sh`)。アプリのコードを直したときは付けません。

## 5. CCv2 / Composable Storefront ではどこに当たるか {#s5}

| ラボ | CCv2 で当たるもの |
| --- | --- |
| `manifest.json` | CCv2 のリポジトリの manifest.json(どの拡張を入れ、aspect ごとにどのプロパティ・Web アプリで動かすか)と、JS Storefront 側の manifest.json(どのアプリを SSR で動かすか) |
| `aspects[]` | manifest.json の aspect ごとの設定(api・backoffice・backgroundProcessing など) |
| `render.mjs` → `k8s/generated/` | Cloud Portal での **ビルド**(リポジトリの中身と manifest からイメージと設定を作る)。裏の Kubernetes の YAML は SAP が作るので、利用者は見ない |
| `k8s/up.sh`(`kubectl apply`) | Cloud Portal での **デプロイ**(ビルドを環境に入れる。入れ替え方と DB の更新のしかたを選ぶ) |
| `environments.d1 / s1 / p1` | 環境 d1(開発)・s1(ステージング)・p1(本番)。環境の名前の付け方も同じ考え方 |
| `environments.*.env` | 環境ごとのプロパティ(Cloud Portal の環境ごとの設定、または manifest の persona ごとのプロパティ) |
| `environments.*.replicas` | 環境ごとの aspect の台数(Cloud Portal のスケーリング。権限によっては画面に出ない) |
| `ipFilters`・`ipFilterOverrides` | 環境ごとのエンドポイントの IP フィルタ |
| `secrets`(値は書かない) | Cloud Portal の秘密の値の置き場所 |
| `render.mjs --check` | ビルドの前の確かめ(設定の書き間違いに早く気付く) |

CCv2 では、同じビルドを d1 → s1 → p1 と順に入れていきます。**ビルドは 1 回、入れる先だけが違う** のが大事で、ラボでも同じイメージを 3 つの環境で使っています(`API_PUBLIC_URL` を JS に焼き込まないのはこのためです。[仕組み-4](./04-storefront-ssr))。

## 6. よくある誤解 {#s6}

- **「k8s/generated/ の YAML を直接直せばよい」** → 次に render.mjs を動かすと消えます。直すのは manifest.json です(ファイルの先頭にも書いてあります)。
- **「環境ごとに manifest を 3 つ持つ」** → 1 つの manifest に「共通」と「環境ごとの差分」を書きます。3 つ持つと、直し忘れで環境ごとにずれていきます。
- **「s1 は本番より手を抜いてよい」** → 設定は本番と同じにし、違いは台数くらいに抑えます。違いが多いほど「s1 では動いたのに本番で落ちた」が起きます。
- **「秘密の値も manifest に書けば、1 か所で管理できる」** → manifest はリポジトリに入る(= 多くの人が読める)ので、書くのは Secret の **名前と鍵の名前** だけです。値は別の置き場所に入れます。
- **「軽量版も manifest から自動で作られる」** → 軽量版は手で合わせています。manifest を直したら docker-compose.yml も直し、`--check` で確かめます。

## 7. 関係する演習と設計書 {#s7}

- 演習: [インフラ-2 設定値とシークレットを環境で分ける](/exercises/06-infra-config-and-secrets)・[インフラ-1 止めずに版を上げる](/exercises/05-infra-rolling-update)・[性能-2 台数を増やして耐える](/exercises/13-perf-scale-out)・[ネットワーク-3 Ingress とエンドポイント](/exercises/20-nw-ingress-endpoints)
- 設計書: [インフラ方式 4.1 2 つの版で同じイメージを使う](/design/architecture/03-infrastructure#s4-1)・[4.5 設定値と秘密情報](/design/architecture/03-infrastructure#s4-5)・[4.7 manifest.json から Kubernetes の定義を作る](/design/architecture/03-infrastructure#s4-7)・[4.8 環境 d1・s1・p1](/design/architecture/03-infrastructure#s4-8)・[全体方式 4.2 設定は環境変数、秘密の値は別の置き場所](/design/architecture/00-overall#s4-2)・[4.5 版を固定する](/design/architecture/00-overall#s4-5)・[4.7 構成を manifest.json 1 か所に書く](/design/architecture/00-overall#s4-7)・[QA 方式 4.5 manifest と compose の食い違いを確かめる](/design/architecture/06-qa#s4-5)・[D-INF-01 起動構成(compose と Kubernetes)](/design/detail/D-INF-01-compose-and-k8s)
- 前のページ: [仕組み-11 観測](./11-observability) ・ 最初に戻る: [仕組み-0 全体の流れ](./00-overview)
