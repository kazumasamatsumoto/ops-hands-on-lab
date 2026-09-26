# サンプルストア 体験ラボ(本格版: Kubernetes / kind)

軽量版(docker compose)と**同じアプリ・同じイメージ**を、Kubernetes の上で動かす版です。
Kubernetes は kind(Kubernetes IN Docker = Docker のコンテナの中で動く小さな Kubernetes)で手元に作ります。
形は、SAP Commerce Cloud(CCv2)でヘッドレスのお店を動かすときに寄せています。

本格版で見られるのは、軽量版では見えにくい次のようなことです。

- manifest.json に書いた aspect・エンドポイント・IP フィルタが、Deployment と Ingress になる様子(CCv2 の manifest とビルドの考え方)
- 同じ Pod が 2 つ動き、1 つ消えてもすぐ作り直される(レプリカ)
- ヘルスチェックに失敗した Pod が Not Ready になり、振り分け先から外れる
- 止めずに新しい版へ入れ替える(ローリング更新)
- メモリの上限を超えて強制終了(OOMKilled)→ 再起動の繰り返し(CrashLoopBackOff)
- 環境 d1・s1・p1 の違い(台数・キャッシュ・IP フィルタ)
- 1 つのリクエストの道筋(トレース): storefront の SSR → api → DB を 1 枚の図で見る

## 用意するもの

| もの | 目安・入れ方 |
| --- | --- |
| Docker Desktop | メモリの割り当て **8GB**(本格版だけで 3〜3.5GB ほど使います。下の「使うメモリ」) |
| kind | `brew install kind`(Mac)。v0.30 以上 |
| kubectl | `brew install kubectl`(Docker Desktop に付いてくる物でも可) |
| Node.js | 24 以上(`tools/manifest/render.mjs` を動かすため) |
| 空いているポート | 18080・13000・19090・19093・19094(軽量版と同じ番号) |

> **軽量版と本格版は同時に動かせません**(同じポート番号を使うため)。本格版を始める前に、リポジトリの一番上で `docker compose down` してください。

## 起動・停止・環境の切り替え

```bash
# 起動(ネットワーク作成 → クラスタ作成 → イメージのビルドと読み込み → 反映 → 全部 Ready まで待つ → cdn-waf 起動)
# 初回はノードや道具のイメージを取得するので 10〜15 分かかります。
k8s/up.sh

# 環境を切り替える(d1 = 開発、s1 = ステージング、p1 = 本番。既定は p1)。LAB_SKIP_BUILD=1 でビルドを飛ばせます
LAB_ENV=d1 LAB_SKIP_BUILD=1 k8s/up.sh
LAB_ENV=p1 LAB_SKIP_BUILD=1 k8s/up.sh

# 停止(クラスタと cdn-waf のコンテナを消します。DB・指標・ログ・トレースのデータも消えます)
k8s/down.sh
```

`k8s/up.sh` は何度実行しても大丈夫です。manifest.json や設定ファイルを直したときも、もう一度実行すれば反映されます
(ConfigMap を変えただけでは動いている Pod は変わらないので、そのあと `kubectl -n lab rollout restart deploy/prometheus` のように作り直します)。

開く場所は軽量版と同じです。

| 何か | URL |
| --- | --- |
| お店(storefront) | http://www.lab.localhost:18080 |
| API | http://api.lab.localhost:18080/occ/v2/samplestore/products/search?query=ノート |
| 管理画面(backoffice) | http://backoffice.lab.localhost:18080/backoffice/(`admin` / `admin`。社内の IP だけ) |
| Grafana | http://localhost:13000(ホームが「サンプルストア SLO」。トレースは「サンプルストア 1 リクエストの道筋」) |
| Prometheus | http://localhost:19090 |
| Alertmanager | http://localhost:19093 |
| pager | http://localhost:19094 |

kind はクラスタを作ると kubectl の接続先(コンテキスト)を `kind-lab` に切り替えます。以下のコマンドはその前提で、いつも `-n lab`(lab の部屋 = Namespace)を付けています。

> 変えられる値(ふだんは不要): `LAB_CLUSTER`(クラスタの名前。既定 `lab`)、`LAB_KIND_CONFIG`(クラスタ定義。既定 `k8s/kind-config.yaml`。
> Grafana などのホスト側のポートはここで決まる)、`LAB_HTTP_PORT`(お店の入口のホスト側のポート。既定 18080)、`LAB_CDN_WAF_IP`(既定 172.30.91.10)。
> 名前を変えたら `k8s/chaos.sh`・`k8s/down.sh` にも同じ `LAB_CLUSTER=...` を付けます。
> なお 18080 以外の番号にすると、ブラウザでは CORS と CSP の許可(`http://www.lab.localhost:18080` と書いてある所)に合わず、画面の一部が動きません。curl での確認用です。

## 全体の地図

```
ブラウザ / curl / k6
   │ http://www.lab.localhost:18080 ・ api.lab.localhost:18080 ・ backoffice.lab.localhost:18080
   ▼
┌──────────── Docker(クラスタの外) ────────────┐   CCv2 では: お客さんのクラウドの契約の CDN・WAF
│ cdn-waf コンテナ(<クラスタ名>-cdn-waf)        │   軽量版と同じイメージ・同じ cdn-waf/default.conf.template
│   キャッシュ / 全体のレート制限 / WAF / CSP など  │   ネットワーク lab-kind(172.30.91.10)と lab-kind-outside(社外の代わり)
└───────────────┬───────────────────────┘
                │ http://<クラスタ名>-control-plane:80   X-Forwarded-For: 利用者の IP(ホスト PC なら 127.0.0.1)
                ▼
┌──────────── kind のノード(Kubernetes。CCv2 では SAP の中) ────────────┐
│ ingress-nginx(ノードの 80 番)                     … Cloud Portal の「エンドポイント」と「IP フィルタ」   │
│   Ingress www        www.lab.localhost        → Service storefront:4000                          │
│   Ingress api        api.lab.localhost        → Service api:3001(token は回数制限)               │
│   Ingress backoffice backoffice.lab.localhost → Service backoffice:3001(社内の IP だけ)          │
│   Ingress *-blocked  /admin・/metrics・/readyz → 誰からでも 403                                  │
│                                                                                     │
│ Deployment storefront ×2(lab/web:local)        … JS Storefront(SSR)                         │
│ Deployment api ×2 / backoffice ×1 / worker ×1  … 1 つのイメージ lab/api:local を ASPECT で役割分け │
│ StatefulSet db(PostgreSQL)・Deployment search(Solr 9)                                      │
│ 観測: Prometheus・Alertmanager・pager・Grafana・Loki・Alloy・otel-collector・Tempo                 │
└─────────────────────────────────────────────────────────────┘
   Grafana 13000・Prometheus 19090・Alertmanager 19093・pager 19094 は、ノードの NodePort をホストにつないで見ます
```

### なぜ cdn-waf をクラスタの外に置くのか

CCv2 では、クラスタ(アプリが動く場所)は SAP の中にあり、CDN・WAF はお客さんが別に契約して前に置くのが普通です。持ち主も設定する画面も違います。
このラボでも同じ形にするため、cdn-waf は Kubernetes の Pod ではなく、**ただの Docker のコンテナ**として動かしています。

- cdn-waf からクラスタへは、kind のノード(Docker のコンテナ `<クラスタ名>-control-plane`)の 80 番に届けます。そこで ingress-nginx が待っています。
  クラスタから見ると、cdn-waf は「外から来るお客さん」の 1 人です。
- ingress-nginx は、利用者の本当の IP を cdn-waf が書く `X-Forwarded-For` から知ります。このヘッダは偽れるので、
  **ネットワーク lab-kind(172.30.91.0/24。cdn-waf のいる所)から来たときだけ**信じます(`k8s/vendor/ingress-nginx/kustomization.yaml` の `proxy-real-ip-cidr`)。
  本物の CDN でも、CDN が公開している IP の範囲だけを信じる、という設定をします。
- cdn-waf のログは Loki に入りません(クラスタの外なので)。`docker logs lab-cdn-waf` で見ます。CCv2 でも CDN のログはお客さん側で見るもので、Cloud Portal のログには入りません。

## CCv2 との対応

| ラボ(本格版) | どこにあるか | CCv2 で当たるもの |
| --- | --- | --- |
| cdn-waf コンテナ | `cdn-waf/`(軽量版と共通)、起動は `k8s/up.sh` | 外部の CDN・WAF(例: CloudFront + AWS WAF) |
| Ingress のホスト名のルール(`rules[].host`) | `k8s/generated/base/ingress.yaml` | Cloud Portal の「エンドポイント」 |
| Ingress の注釈 `allowlist-source-range` | 同上(manifest.json の `ipFilters` と `endpoints[].ipFilter`) | エンドポイントの「IP フィルタ」 |
| Deployment api・backoffice・worker(同じイメージ、`ASPECT` だけ違う) | `k8s/generated/base/*.yaml` | aspect(api・backoffice・backgroundProcessing) |
| manifest.json と `tools/manifest/render.mjs` | リポジトリ直下、`tools/manifest/` | manifest.json とビルド |
| `k8s/generated/envs/d1・s1・p1`(kustomize の overlay) | `LAB_ENV=d1 k8s/up.sh` | 環境 d1・s1・p1 |
| Secret `lab-secrets` | `k8s/platform/secret.yaml` | Cloud Portal の環境変数・秘密の置き場所 |
| db・search(Solr) | `k8s/platform/` | SAP が用意する DB・検索サービス |
| Prometheus + Grafana + Tempo(トレース) | `k8s/observability/` | Dynatrace(指標・APM) |
| Loki + Alloy + Grafana(ログ) | 同上 | OpenSearch(ログ) |

## フォルダの中身

```
k8s/
  kind-config.yaml            クラスタの定義(ノード 1 台、観測の道具のポートのつなぎ)
  up.sh / down.sh / chaos.sh  起動・停止・わざと壊すスイッチ
  generated/                  manifest.json から render.mjs が作る物(手で直さない)
    base/                       storefront・api・backoffice・worker の Deployment と Service、Ingress
    envs/d1|s1|p1/              環境ごとの差分(台数・環境変数・IP フィルタ・ConfigMap lab-environment)
  platform/                   土台: Namespace・Secret(見本の値)・db(PostgreSQL)・search(Solr)
  observability/              観測の道具の本体(Prometheus・Alertmanager・pager・Grafana・Loki・Alloy・otel-collector・Tempo)
  config/                     本格版だけ中身が違う設定(Prometheus の収集先、Alloy、Grafana のデータソース、トレースのダッシュボード、
                              otel-collector、Tempo)
  vendor/ingress-nginx/       ingress-nginx の kind 用の公式の定義(v1.15.1 の写し)と、ラボで足した設定
```

どれがどの順で反映されるかは `k8s/up.sh` のコメントにあります。どの YAML ができるかは、クラスタが無くても次で見られます。

```bash
node tools/manifest/render.mjs              # manifest.json → k8s/generated/
kubectl kustomize k8s/generated/envs/p1     # 環境 p1 の最終的な YAML
diff <(kubectl kustomize k8s/generated/envs/d1) <(kubectl kustomize k8s/generated/envs/p1)   # d1 と p1 の違いだけ
```

## Kubernetes の言葉と、画面で見えるもの

| 言葉 | 一言 | たとえ | このラボで見えるもの |
| --- | --- | --- | --- |
| Pod | コンテナを包んだ、動かす最小の単位 | お弁当箱(中身がコンテナ) | `kubectl -n lab get pods` の 1 行 1 行(`api-7c9f...-x2k4p`) |
| ReplicaSet | 「同じ Pod を N 個」保つ係 | 人数を数える班長 | `kubectl -n lab get rs`。ローリング更新のたびに新しい ReplicaSet ができる |
| Deployment | ReplicaSet を使って版の入れ替えまで面倒を見る係 | 店長 | `kubectl -n lab get deploy`(`READY 2/2`) |
| Service | Pod たちの代表の窓口(名前と番号が変わらない) | 代表電話番号 | `kubectl -n lab get svc`。`api` という名前で、Ready の Pod にだけつなぐ |
| Ingress | ホスト名・パスで、どの Service に渡すかの決まり | ビルの受付の案内板 | `kubectl -n lab get ingress`(HOSTS 欄) |
| probe(startup / readiness / liveness) | 起動が終わったか / 受けられるか / 生きているか | 開店準備 / 「準備できた?」/ 脈を取る | readiness 失敗で `READY 0/1`、liveness 失敗が続くと `RESTARTS` が増える |
| requests / limits | 予約 / 上限 | 会議室の予約 / ブレーカー | `kubectl -n lab describe pod` の `Requests:`・`Limits:` |
| OOMKilled | メモリの上限を超えて強制終了されたこと | ブレーカーが落ちた | `describe pod` の `Last State: Terminated  Reason: OOMKilled` |
| CrashLoopBackOff | 起動しては落ちるので、再起動の間隔を延ばしている状態 | 少し待ってからブレーカーを上げ直す | `get pods` の `STATUS` 欄。10 秒 → 20 秒 → 40 秒 … 最大 5 分 |
| NodePort | ノードの決まった番号で外に出す Service | 建物の通用口の番号 | `grafana` の `3000:30300/TCP` |
| overlay | 共通の定義(base)に、環境ごとの差分を重ねる書き方(kustomize) | 共通の制服 + 部署ごとの名札 | `k8s/generated/envs/d1/kustomization.yaml` |

## 確かめるコマンド

```bash
# SSR の HTML に CMS の部品が入っているか(cdn-waf → ingress-nginx → storefront → api)
curl -s http://www.lab.localhost:18080/ | grep -o 'data-cms-type="[^"]*"' | sort | uniq -c
# 検索の実体が Solr か(X-Search-Provider: solr)。日本語もそのまま検索できます
curl -s -D - -o /dev/null 'http://api.lab.localhost:18080/occ/v2/samplestore/products/search?query=%E3%83%8E%E3%83%BC%E3%83%88' | grep -i x-search-provider
# Ingress の一覧(ホスト名 → どこへ)と、付いている注釈(IP フィルタ・回数制限・閉じる口)
kubectl -n lab get ingress
kubectl -n lab get ingress -o custom-columns='NAME:.metadata.name,HOST:.spec.rules[0].host,PATH:.spec.rules[0].http.paths[*].path,ALLOW:.metadata.annotations.nginx\.ingress\.kubernetes\.io/allowlist-source-range,DENY:.metadata.annotations.nginx\.ingress\.kubernetes\.io/denylist-source-range,RPS:.metadata.annotations.nginx\.ingress\.kubernetes\.io/limit-rps'
# 中の人だけの口は外から 403
curl -s -o /dev/null -w '%{http_code}\n' http://api.lab.localhost:18080/admin/chaos
# ログインの回数制限(1 秒 1 回 + 余裕 5 回)。続けて 10 回送ると 7 回目から 429
for i in $(seq 10); do curl -s -o /dev/null -w '%{http_code} ' http://api.lab.localhost:18080/authorizationserver/oauth/token \
  -d 'grant_type=password&client_id=storefront&username=alice&password=password'; done; echo
```

### IP フィルタを確かめる(backoffice は社内だけ)

この PC から来た通信は、cdn-waf が「127.0.0.1 から来た」として伝えるので社内扱いです。
「社外」から来た様子は、社外の代わりのネットワーク `lab-kind-outside`(172.30.92.0/24)に置いたコンテナから見られます。

```bash
# 社外から → 403(ingress-nginx の allowlist-source-range で断られる)
docker run --rm --network lab-kind-outside curlimages/curl:8.16.0 -s -o /dev/null -w '%{http_code}\n' \
  -H 'Host: backoffice.lab.localhost' http://lab-cdn-waf:18080/backoffice/login
# 社外からでも、お店(www)は p1 なら誰でも → 200(d1・s1 では 403)
docker run --rm --network lab-kind-outside curlimages/curl:8.16.0 -s -o /dev/null -w '%{http_code}\n' \
  -H 'Host: www.lab.localhost' http://lab-cdn-waf:18080/
# ingress-nginx のログで、誰(remote_addr)がどこ(ingress)に来て何番(status)だったか
kubectl -n ingress-nginx logs deploy/ingress-nginx-controller --tail=5
```

## 短い演習(デモ)

ターミナルを 2〜3 個並べると分かりやすいです。1 つ目で Pod を見張り、2 つ目で操作、3 つ目でお客さんのまね(curl のくり返し)をします。

### 0. Pod を見張る

```bash
kubectl -n lab get pods -w          # -w = 変化があるたびに 1 行ずつ出す(止めるのは Ctrl+C)
kubectl -n lab get deploy,rs,svc,ingress
```

### 1. ローリング更新(止めずに入れ替える)

お客さんのまね(200 以外が出たら「止まった」ということです。`?t=` はキャッシュを避けて毎回 storefront まで届かせるため):

```bash
while true; do curl -s -o /dev/null -w '%{http_code}\n' "http://www.lab.localhost:18080/p/100001?t=$RANDOM"; sleep 0.2; done
```

別のターミナルで入れ替えます。

```bash
kubectl -n lab rollout restart deploy/storefront   # 同じイメージのまま Pod を全部作り直す(設定を変えたときもこれ)
kubectl -n lab rollout status deploy/storefront    # 「successfully rolled out」で完了
kubectl -n lab rollout undo deploy/storefront      # 1 つ前の版へ戻す
kubectl -n lab rollout history deploy/storefront
```

見えること: 新しい Pod が 1 つ増え(`maxSurge: 1`)、`READY 1/1` になってから古い Pod が 1 つ `Terminating` になる、をくり返します。
curl はずっと `200` のままです。止める前の 5 秒待ち(`preStop`)の間に、ingress-nginx が振り分け先から外すためです。

### 2. readiness で Not Ready になる(DB を止める)

```bash
kubectl -n lab scale statefulset/db --replicas=0    # DB を止める
kubectl -n lab get pods -w                          # api・backoffice・worker が READY 0/1 になる(RESTARTS は増えない)
# 振り分け先の一覧。Pod の IP は残りますが ready=false になり、振り分けられなくなる
# (-o jsonpath を付けないと、Not Ready の Pod の IP も区別なく並ぶので「外れた」ことが見えません)
kubectl -n lab get endpointslices -l kubernetes.io/service-name=api -o jsonpath='{range .items[*].endpoints[*]}{.addresses[0]}  ready={.conditions.ready}{"\n"}{end}'
curl -s -o /dev/null -w '%{http_code}\n' "http://api.lab.localhost:18080/occ/v2/samplestore/products/100001?t=$RANDOM"   # 503(つなぐ先が無い)
kubectl -n lab scale statefulset/db --replicas=1    # 戻す → しばらくで 1/1 に戻る
```

見どころ: `/readyz`(DB に届くか)で Not Ready になり振り分けから外れますが、`/healthz`(生きているか)は元気なので**再起動はされません**。
「DB が落ちただけで api を再起動しても直らない」ので、2 つの probe を分けています。

### 3. OOMKilled → CrashLoopBackOff(メモリ不足で再起動を繰り返す)

```bash
k8s/chaos.sh boot leakMb=20   # 起動時の値を「リクエストのたびに 20MB ためる」にする(Pod が作り直されても残る)
# お客さんのまね(?query= を変えてキャッシュを避け、api に届かせる)
while true; do curl -s -o /dev/null -w '%{http_code}\n' "http://api.lab.localhost:18080/occ/v2/samplestore/products/search?query=$RANDOM"; sleep 0.3; done
kubectl -n lab get pods -l app.kubernetes.io/name=api -w
```

見えること: api の Pod が `Running` → `OOMKilled` → `Running` → … → `CrashLoopBackOff` になり、`RESTARTS` が増えます(上限は `limits.memory: 256Mi`)。
curl には 502・503 が混ざります。理由を確かめて、片付けます。

```bash
kubectl -n lab describe pod -l app.kubernetes.io/name=api | grep -A5 'Last State'   # Reason: OOMKilled / Exit Code: 137
kubectl -n lab logs deploy/api --previous --tail=20                                # 落ちる直前のログ
kubectl -n lab get events --sort-by=.lastTimestamp | tail -20                      # BackOff などの出来事
k8s/chaos.sh boot-reset                                                            # 起動時の値を戻す(新しい Pod に入れ替わって直る)
kubectl -n lab rollout status deploy/api
```

> `k8s/chaos.sh set leakMb=5` のように「動いている Pod のスイッチ」だけ変えた場合は、1 回 OOMKilled で再起動するとスイッチが 0 に戻るので、
> CrashLoopBackOff までは行きません。繰り返し落ちる様子を見るときは `boot` を使います。

### 4. 台数を増やす(スケールアウト)

```bash
kubectl -n lab scale deploy/storefront --replicas=4
kubectl -n lab get pods -l app.kubernetes.io/name=storefront -w
kubectl -n lab scale deploy/storefront --replicas=2   # 戻す(k8s/up.sh をもう一度実行しても manifest の台数に戻ります)
```

HPA(負荷に合わせて自動で台数を変える仕組み)は入れていません。CPU の使用量を集める metrics-server が別に必要なためです。

### 5. 環境を切り替える(d1 と p1 の違い)

```bash
LAB_ENV=d1 LAB_SKIP_BUILD=1 k8s/up.sh
kubectl -n lab get deploy                                  # storefront・api が 1 台ずつ
kubectl -n lab get configmap lab-environment -o yaml       # LAB_ENV=d1・EDGE_CACHE=off
curl -sI "http://www.lab.localhost:18080/p/100001" | grep -i x-cache   # BYPASS(キャッシュなし。cdn-waf は EDGE_CACHE=off で起動し直される)
# 社外から www → 403(d1 はお店も社内だけ)
docker run --rm --network lab-kind-outside curlimages/curl:8.16.0 -s -o /dev/null -w '%{http_code}\n' -H 'Host: www.lab.localhost' http://lab-cdn-waf:18080/
LAB_ENV=p1 LAB_SKIP_BUILD=1 k8s/up.sh                      # 戻す(2 台ずつ、キャッシュあり、www は誰でも)
```

| | d1(開発) | s1(ステージング) | p1(本番) |
| --- | --- | --- | --- |
| 台数 storefront / api | 1 / 1 | 1 / 2 | 2 / 2 |
| cdn-waf のキャッシュ | なし | あり | あり |
| www・api の IP フィルタ | 社内だけ | 社内だけ | 誰でも |
| ログの細かさ | debug | info | info |

### 6. 1 つのリクエストの道筋(トレース)を見る

```bash
curl -s -o /dev/null "http://www.lab.localhost:18080/p/100001?t=$RANDOM"   # 1 回開く
```

Grafana(http://localhost:13000)のダッシュボード **「サンプルストア 1 リクエストの道筋」** を開き、「最近の道筋」の **Trace ID** を押します。
「選んだ道筋」に、storefront が受けたリクエスト → storefront から api への呼び出し → api が受けたリクエスト → DB(pg)への問い合わせ、
が段になって並びます。「この道筋のログ」には、同じ `trace_id` のログが並びます。

Explore から見る方法(右上の「サインイン」から `admin` / `admin` でログインし、左のメニューの Explore(日本語の表示では「探検」)を開きます。ログインしないままだと、メニューに Explore が出ません):

- **Tempo** を選び、TraceQL に `{resource.service.name="samplestore-storefront" && kind=server}` → 一覧の Trace ID を押す
- **Loki** を選び、`{service="api"} |= "trace_id"` → ログの行を開き、`trace_id` の横の **Tempo で道筋を見る** を押す(derived field)

コマンドで Tempo に直接聞くこともできます(Tempo は外に出していないので、Pod の中から聞きます)。

```bash
kubectl -n lab exec deploy/grafana -- wget -qO- 'http://tempo:3200/api/search?tags=service.name%3Dsamplestore-storefront&limit=5'
kubectl -n lab exec deploy/grafana -- wget -qO- "http://tempo:3200/api/traces/<trace_id>" | head -c 600
```

### 7. 定期ジョブの止まりのアラート(worker)

```bash
k8s/chaos.sh worker boot cronFail=true cronIntervalSeconds=10   # ジョブを全部失敗させ、間隔を 10 秒に
```

約 1〜2 分で `CronJobStaleDemo`、5〜6 分で `CronJobStale` が pager(http://localhost:19094)に届きます。片付けは `k8s/chaos.sh worker boot-reset`。

### 8. 検索の索引が作り直される様子(backoffice → worker → Solr)

管理画面で商品の価格を変えると、DB はすぐ変わりますが、Solr の索引(検索結果の価格)は worker の `searchIndexJob` が次に動くまで(最大 60 秒)古いままです。

```bash
kubectl -n lab logs deploy/worker -f | grep --line-buffered searchIndexJob   # 60 秒ごとに "result":"success","indexed":30(30 件を入れ直した)のログ
```

### 調べるときの基本の 3 つ

```bash
kubectl -n lab describe pod <Pod の名前>                    # 状態・probe の結果・再起動の理由・出来事(Events)
kubectl -n lab logs <Pod の名前>                            # ログ(-f で流し続ける、--previous で落ちる前)
kubectl -n lab logs -l app.kubernetes.io/name=api --tail=20 # api の全 Pod のログをまとめて
```

## わざと壊すスイッチ(本格版)

```bash
k8s/chaos.sh status                  # 全部の api Pod の今の状態
k8s/chaos.sh set latencyMs=1500      # 全部の api Pod に遅延
k8s/chaos.sh set errorRate=0.5
k8s/chaos.sh reset                   # 全部元に戻す
k8s/chaos.sh worker set cronFail=true
k8s/chaos.sh worker reset
k8s/chaos.sh boot leakMb=20          # 起動時の値を変える(Pod が作り直される)
k8s/chaos.sh boot-reset              # 起動時の値を戻す
```

スイッチは Pod ごとに持っています。`kubectl -n lab exec deploy/api -- curl ...` と手で打つと、2 つある api Pod の**どちらか 1 つ**にしか届きません
(片方だけ壊れている = 「ときどきだけ失敗する」障害の再現にも使えます)。

## 使うメモリ

| まとまり | 目安(検証で測った値) |
| --- | --- |
| kind のノードの中の Kubernetes 自身(API サーバー・etcd・kubelet など) | 900MB〜1GB |
| ingress-nginx | 170MB |
| アプリ(storefront ×2・api ×2・backoffice・worker) | 250〜300MB(leakMb の演習中は api が上限 256Mi まで増える) |
| db(PostgreSQL)・search(Solr。Java のヒープ 256MB) | 500MB |
| 観測(Grafana・Tempo・Loki・Alloy・Prometheus・otel-collector・Alertmanager・pager) | 950MB |
| cdn-waf(クラスタの外) | 50〜80MB |
| **合計** | **およそ 3〜3.5GB**(docker stats で見たノード 3.0〜3.3GiB + cdn-waf。Docker Desktop 8GB で余裕があります) |

Pod ごとの予約(requests)と上限(limits)は `kubectl -n lab describe node | grep -A30 'Allocated resources'` で見られます。

## 注意

- **ingress-nginx は開発が終わっています**(2026 年 3 月で保守終了。以後は修正が出ません)。このラボは「注釈で IP フィルタ・回数制限を書く」形を学ぶために、
  最後の版 v1.15.1 を写して使っています。新しく本番を作るなら、Gateway API に対応した別のコントローラーを選びます。
- `k8s/platform/secret.yaml` のパスワードはラボ専用の見本の値です。本番では秘密の値をリポジトリに入れません。
- クラスタを作るとき kind が `WARNING: Here be dragons! This is not supported currently.` と出します。ノードをつなぐネットワークを
  `lab-kind`(番号を固定したもの)に指定する設定 `KIND_EXPERIMENTAL_DOCKER_NETWORK` が「試験中の機能」だという注意で、動きには問題ありません。
  番号を固定しているのは、manifest.json の社内の範囲(`ipFilters.office`)と ingress-nginx の `proxy-real-ip-cidr` に同じ番号を書くためです。
- `tools/k6.sh` を本格版に向けるときは `LAB_DOCKER_NETWORK=lab-kind CDN_WAF_IP=172.30.91.10 tools/k6.sh browse.js` とします。

## うまく動かないとき

| 症状 | 見るところ・直し方 |
| --- | --- |
| `up.sh` が `address already in use` で止まる | 軽量版が動いていませんか。`docker compose down` してから `k8s/down.sh` → `k8s/up.sh` |
| `ネットワーク lab-kind の番号が…` で止まる | 同じ名前で別の番号のネットワークがあります。`docker network rm lab-kind` してからやり直す |
| Pod が `Pending` のまま | メモリが足りません。`kubectl -n lab describe pod <名前>` の Events に `Insufficient memory`。Docker Desktop のメモリを増やす |
| Pod が `ImagePullBackOff` | ネット接続を確認。`lab/api:local` なら `kind load docker-image lab/api:local --name lab` をやり直す |
| 古い画面のまま | イメージを作り直したら `kind load docker-image ...` と `rollout restart` の両方が必要です。`k8s/up.sh` がやるのはビルドと `kind load` までなので(名前が同じ `lab/api:local`・`lab/web:local` のため、動いている Pod は入れ替わりません)、続けて `kubectl -n lab rollout restart deploy/api deploy/backoffice deploy/worker deploy/storefront` を打ちます |
| お店が 502・504 | ingress-nginx か storefront が準備中です。`kubectl -n ingress-nginx get pods`・`kubectl -n lab get pods`、`docker logs lab-cdn-waf` |
| backoffice がこの PC からも 403 | cdn-waf を通していますか(`http://backoffice.lab.localhost:18080`)。`kubectl -n ingress-nginx logs deploy/ingress-nginx-controller` の `remote_addr` が 127.0.0.1 か確かめる |
| kubectl が別のクラスタにつながる | `kubectl config use-context kind-lab` |
