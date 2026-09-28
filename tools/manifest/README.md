# manifest.json と render.mjs

リポジトリ直下の `manifest.json` は、サンプルストアの構成を 1 か所にまとめた「設計図」です。
CCv2 では manifest.json に「どのアプリを、どの aspect で、どの環境変数で動かすか」を書き、Cloud Portal でビルドとデプロイをすると、
裏で Kubernetes のリソースが作られます。このラボはその考え方をまねた、**このラボ独自の簡単な形**です(CCv2 の書式そのものではありません)。

`tools/manifest/render.mjs` は manifest.json を読んで、本格版(kind)の Kubernetes の定義を `k8s/generated/` に書き出します。
「manifest に 1 行書くと、裏でこういうリソースができる」を、自分の目で確かめるための道具です。

```sh
node tools/manifest/render.mjs            # k8s/generated/ を作り直す(Node.js 24 だけで動く。追加のパッケージなし)
node tools/manifest/render.mjs --check    # 軽量版(docker-compose.yml と ingress/default.conf.template)と食い違いがないか確かめる
kubectl kustomize k8s/generated/envs/p1   # 環境 p1 で最終的にどんな YAML になるかを見る(クラスタは要りません)
```

軽量版(docker compose)は manifest.json から作らず、手で合わせています。manifest.json を変えたら docker-compose.yml も直し、`--check` で確かめます。

## できる物(k8s/generated/)

```
k8s/generated/
  base/                    どの環境でも同じ部分
    kustomization.yaml     下のファイルの目次
    storefront.yaml        Deployment + Service(storefront)
    api.yaml               Deployment + Service(ASPECT=api)
    backoffice.yaml        Deployment + Service(ASPECT=backoffice)
    worker.yaml            Deployment + Service(ASPECT=backgroundProcessing。Service は指標の収集用)
    ingress.yaml           エンドポイントごとの Ingress(ingress-nginx 用)
  envs/d1|s1|p1/           環境ごとの差分(kustomize の overlay)
    kustomization.yaml     台数(replicas)・ConfigMap lab-environment・下のパッチの一覧
    patches/*.yaml         環境変数の上書き・IP フィルタの上書き
```

## manifest.json の項目

| 項目 | 例 | 意味 | できる物 |
|---|---|---|---|
| `name` | `samplestore` | お店(アプリ全体)の名前 | ラベル `app.kubernetes.io/part-of` |
| `namespace` | `lab` | Kubernetes の部屋(Namespace)の名前 | 各環境の `namespace:` |
| `images.storefront` | `lab/web:local` | storefront のイメージ | storefront の Deployment の `image` |
| `images.platform` | `lab/api:local` | api・backoffice・worker に共通のイメージ(aspect で役を変える) | 3 つの Deployment の `image` |
| `secrets.name` / `secrets.keys` | `lab-secrets` / `PGPASSWORD` など | 秘密の値を置く Secret の名前と、その中の鍵の名前。**値は manifest に書きません** | `env[].valueFrom.secretKeyRef` |
| `storefront.service` | `storefront` | storefront の Service(中の住所)の名前 | Deployment・Service の名前 |
| `storefront.port` | `4000` | 待ち受けるポート | `containerPort`・Service の `port` |
| `storefront.replicas` | `2` | 台数(環境で上書きされます) | `spec.replicas` |
| `storefront.ssr.renderMode` | `ssr` | `ssr` か `csr` | 環境変数 `RENDER_MODE` |
| `storefront.ssr.timeoutMs` | `3000` | SSR をあきらめるまでの時間 | 環境変数 `SSR_TIMEOUT_MS` |
| `storefront.env` | `API_INTERNAL_URL` など | そのほかの環境変数 | `env` |
| `storefront.resources` | `cpu`・`memory`・`memoryLimit` | 予約する CPU・メモリ(requests)と、メモリの上限(limits) | `resources` |
| `aspects[].name` | `api`・`backoffice`・`backgroundProcessing` | aspect の名前(CCv2 の aspect のうち、ヘッドレスで主に使う 3 つ。CCv2 にはほかに accstorefront・admin もある) | 環境変数 `ASPECT`、ラベル `lab/aspect` |
| `aspects[].service` | `api`・`backoffice`・`worker` | Deployment・Service の名前 | 同左 |
| `aspects[].port` | `3001` | 待ち受けるポート | `containerPort`・Service |
| `aspects[].replicas` | `2` | 台数(環境で上書きされます) | `spec.replicas` |
| `aspects[].env` | `CORS_ALLOWED_ORIGINS` など | その aspect だけの環境変数 | `env` |
| `aspects[].secretEnv` | `["PGPASSWORD"]` | Secret から読む環境変数 | `env[].valueFrom.secretKeyRef` |
| `aspects[].resources` | 同上 | 同上 | `resources` |
| `commonEnv` | `PGHOST: db` など | 3 つの aspect に共通の環境変数 | 各 Deployment の `env` |
| `tracing.otlpEndpoint` | `http://otel-collector:4318` | トレースの送り先(**本格版だけ**。軽量版にはトレースの道具が無い) | storefront と 3 つの aspect の環境変数 `OTEL_EXPORTER_OTLP_ENDPOINT` |
| `ipFilters.<名前>` | `office: ["127.0.0.1/32", "172.30.89.0/24", "172.30.91.0/24"]` | 名前付きの「許す IP の範囲」の一覧(CCv2 の IP フィルタに当たる) | Ingress の注釈 `allowlist-source-range` |
| `endpoints[].name` | `www`・`api`・`backoffice` | エンドポイントの名前(CCv2 の Cloud Portal の「エンドポイント」に当たる) | Ingress の名前 |
| `endpoints[].host` | `www.lab.localhost` | ホスト名 | Ingress の `rules[].host` |
| `endpoints[].service` | `storefront` | 行き先の Service | Ingress の `backend` |
| `endpoints[].ipFilter` | `office` か `null` | 使う IP フィルタ(`null` は誰でも) | 同上の注釈。範囲の外からは 403 |
| `endpoints[].blockedPaths` | `["/admin", "/metrics", "/readyz"]` | 外から閉じるパス | Ingress `<名前>-blocked`(注釈 `denylist-source-range: 0.0.0.0/0` で、誰からでも 403 にする) |
| `endpoints[].rateLimits[]` | `{path, rps: 1, burst: 5}` | パスごとの回数制限(IP ごと) | Ingress `<名前>-ratelimit-N` の注釈 `limit-rps`・`limit-burst-multiplier` |
| `environments.<d1\|s1\|p1>.description` | | 環境の説明 | kustomization.yaml の先頭のコメント |
| `environments.*.replicas` | `{storefront: 2, api: 2, …}` | 環境ごとの台数(キーは `storefront` と aspect の名前) | overlay の `replicas:` |
| `environments.*.cdnCache` | `true` / `false` | cdn-waf のキャッシュの ON/OFF | ConfigMap `lab-environment` の `EDGE_CACHE`(cdn-waf が読む) |
| `environments.*.ipFilterOverrides` | `{www: "office"}` | 環境ごとに IP フィルタを足す(例: 開発・検証環境はお店も社内だけ) | `patches/ip-filter-*.yaml` |
| `environments.*.searchProvider` | `solr` | 検索の実体。本格版は Solr | `patches/env-*.yaml` の `SEARCH_PROVIDER`、ConfigMap |
| `environments.*.env` | `{LOG_LEVEL: debug}` | 環境ごとに足す・上書きする環境変数 | `patches/env-*.yaml` |

## 環境の違い(d1・s1・p1)

| | d1(開発) | s1(ステージング) | p1(本番) |
|---|---|---|---|
| 台数 storefront / api | 1 / 1 | 1 / 2 | 2 / 2 |
| cdn-waf のキャッシュ | なし(変えた物がすぐ見える) | あり | あり |
| www・api の IP フィルタ | 社内だけ | 社内だけ | 誰でも |
| backoffice の IP フィルタ | 社内だけ | 社内だけ | 社内だけ |
| ログの細かさ | debug | info | info |

CCv2 でも、開発・検証の環境は社内の IP だけに絞り、本番だけを公開する、という分け方がよく使われます。

## 注意

- `ipFilters.office` の 3 つの範囲: `127.0.0.1/32` は「ホスト PC から来た」通信(cdn-waf がこの番号で伝えます)、`172.30.89.0/24` は軽量版の
  Docker ネットワーク、`172.30.91.0/24` は本格版の kind のネットワーク `lab-kind`(k8s/up.sh、PowerShell 版は k8s/up.ps1 が番号を固定して作ります)。
  社外の代わりのネットワーク(軽量版 `172.30.90.0/24`、本格版 `172.30.92.0/24`)は入れないので、そこからは 403 になります。
- 本格版の ingress-nginx が「利用者の IP」を知る仕組み: cdn-waf が `X-Forwarded-For` に利用者の IP を書き、ingress-nginx は
  `lab-kind` のネットワーク(= CDN の IP の範囲)から来たときだけそれを信じます(`k8s/vendor/ingress-nginx/kustomization.yaml` の `proxy-real-ip-cidr`)。
- 生成する Deployment には、manifest に書かない共通の決まりも入ります: 3 種類の見回り(startup・readiness・liveness)、
  ローリング更新(`maxUnavailable: 0`・`maxSurge: 1`)、止める前の 5 秒待ち(`preStop`)。
- Ingress の注釈は ingress-nginx の書き方です(`nginx.ingress.kubernetes.io/...`)。ほかの Ingress コントローラーでは書き方が変わります。
