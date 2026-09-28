---
title: 仕組み-3 Kubernetes の基本(Pod・Deployment・Service・プローブ)
---

# 仕組み-3 Kubernetes の基本(Pod・Deployment・Service・プローブ)

::: tip このページで分かること
- `kubectl get pods` に出る 1 行 1 行が何で、`READY`・`STATUS`・`RESTARTS` が何を意味するか。
- Pod・ReplicaSet・Deployment・Service の関係と、1 リクエストが Service から Pod に届くまで。
- プローブ(readiness / liveness)、requests / limits、ローリング更新の設定の 1 行ずつの意味。
- CCv2 では、これを **SAP が裏で動かしている** こと(利用者は kubectl を打たない)。
:::

## 1. 一言でいうと {#s1}

Kubernetes は、**「この料理を常に 2 皿出しておいて」と頼むと、その通りの状態を保ち続けてくれる店長** です。
皿(Pod)が 1 つ割れたら、言われなくても新しく作ります。新しいレシピ(イメージ)に替えるときも、お店を閉めずに 1 皿ずつ入れ替えます。

**たとえ: レストランの店長と班長**

| Kubernetes の言葉 | 一言 | たとえ |
| --- | --- | --- |
| Pod | コンテナを包んだ、動かす最小の単位 | お弁当箱(中身がコンテナ) |
| ReplicaSet | 「同じ Pod を N 個」保つ係 | 人数を数える班長 |
| Deployment | ReplicaSet を使い、版の入れ替えまで面倒を見る係 | 店長(班長を入れ替えながら営業を続ける) |
| Service | Pod たちの代表の窓口。名前と番号が変わらない | 代表電話番号(かけると、手の空いている店員につながる) |
| startupProbe | 「起動が終わったか」の見回り(終わるまでほかの見回りを待たせる) | 開店準備中の札。準備中は呼びかけない |
| readinessProbe | 「お客さんを回してよいか」の見回り | 「接客できます」の札を出しているか |
| livenessProbe | 「生きているか」の見回り | 呼びかけに返事がなければ、交代させる |
| requests / limits | 予約する量 / 使ってよい上限 | 会議室の予約 / 部屋の定員 |

大事な考え方は **「手順を書くのではなく、あるべき姿を書く」** ことです。「api を 2 つ起動せよ」ではなく「api は 2 つあるべき」と書き、Kubernetes が今の姿との差を埋め続けます。

## 2. 1 リクエストの流れ {#s2}

### 2.1 リクエストが Pod に届くまで {#s2-1}

```text
 ingress-nginx
     │  「api という Service に渡す」(Ingress の backend)
     ▼
 Service api(ClusterIP。名前 api・ポート 3001)
     │  selector: app.kubernetes.io/name=api に当たる Pod のうち、
     │  READY になっている物だけを振り分け先(EndpointSlice)に載せる
     ├──▶ Pod api-xxxxx-aaaaa   READY 1/1  ← 振り分け先
     ├──▶ Pod api-xxxxx-bbbbb   READY 1/1  ← 振り分け先
     └─✕  Pod api-xxxxx-ccccc   READY 0/1  ← /readyz が 503 なので外されている
```

1. ingress-nginx は、Ingress に書かれた Service の名前(`api`)に渡します。
2. Service は、ラベルが一致する Pod の中から **readinessProbe に合格している物だけ** に振り分けます。
3. 合格していない Pod は、生きていても(再起動はされずに)振り分け先から外れるだけです。DB が止まると api の `/readyz` が 503 になり、api の Pod が全部 `0/1` になる、というのが典型です。

図では Service が振り分けるように描いていますが、ingress-nginx は実際には Service の振り分け先の一覧(EndpointSlice)を読み、**Pod の IP に直接** 送ります(Service の番号を経由しない)。どちらでも「READY の Pod だけが振り分け先」という考え方は同じです。api から db・search への呼び出しのように、クラスタの中の部品どうしは Service の名前(`db:5432`・`search:8983`)を経由します。

### 2.2 Pod が生まれてから、お客さんを受けるまで {#s2-2}

```text
 kubectl apply(あるべき姿を渡す)
   → Deployment api(replicas: 2)
       → ReplicaSet api-6d5f...(Pod を 2 つ保つ)
           → Pod api-6d5f...-2xkqp
               ① スケジューラが置く場所(ノード)を決める   requests(CPU 50m・メモリ 96Mi)が空いているノード
               ② イメージを用意してコンテナを起動              STATUS: ContainerCreating → Running
               ③ startupProbe     2 秒ごとに GET /healthz。通るまで(最大 60 回 = 120 秒)ほかの見回りは待つ
               ④ readinessProbe   5 秒ごとに GET /readyz       200 になるまで READY 0/1
               ⑤ READY 1/1 → Service の振り分け先に載る       ここで初めてお客さんが来る
               ⑥ livenessProbe    10 秒ごとに GET /healthz。3 回続けて失敗 → コンテナを再起動
               ⑦ メモリが limits(256Mi)を超えた → OOMKilled → 再起動。繰り返すと CrashLoopBackOff
```

## 3. 設定の読み方 {#s3}

ファイル: [k8s/generated/base/api.yaml](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/k8s/generated/base/api.yaml)(manifest.json から `tools/manifest/render.mjs` が作った物。手で直さない)。

### 3.1 Deployment の頭: 台数と入れ替え方 {#s3-1}

```yaml
kind: Deployment
metadata:
  name: api
spec:
  replicas: 2
  selector:
    matchLabels:
      app.kubernetes.io/name: api
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxUnavailable: 0
      maxSurge: 1
```

- `replicas: 2` … api の Pod を 2 つ保ちます(環境 d1 では overlay が 1 に上書き。[仕組み-12](./12-manifest-and-environments))。
- `selector.matchLabels` … 「このラベルの Pod が自分の子分」という目印です。
- `RollingUpdate` … 版を入れ替えるとき、止めずに少しずつ入れ替えます。
- `maxUnavailable: 0` … 入れ替え中も、使える Pod を 2 つより減らさない。
- `maxSurge: 1` … 入れ替え中だけ、1 つ多い 3 つまで増やしてよい。
- つまり「新しい Pod を 1 つ足す → READY になったら古い Pod を 1 つ消す」を 2 回繰り返します。

### 3.2 Pod の中身: コンテナ・環境変数 {#s3-2}

```yaml
    spec:
      terminationGracePeriodSeconds: 20
      containers:
        - name: api
          image: "lab/api:local"
          ports:
            - name: http
              containerPort: 3001
          env:
            - name: ASPECT
              value: api
            - name: PGPASSWORD
              valueFrom:
                secretKeyRef:
                  name: lab-secrets
                  key: PGPASSWORD
```

- `terminationGracePeriodSeconds: 20` … Pod を止め始めてから、強制終了(SIGKILL)までの猶予が 20 秒です。この 20 秒には、止める前の 5 秒待ち(`preStop`)も含まれます。5 秒待ったあとに止める合図(SIGTERM)を送るので、合図から強制終了までは残りの約 15 秒です。api は合図を受けると、受付中のリクエストを片付け、DB の接続を返してから止まります(アプリ側の上限は 10 秒)。
- `image` … 軽量版と同じイメージです。
- `env` … 環境変数。`ASPECT: api` で「api の役」になります([仕組み-8](./08-aspects-and-worker))。
- `secretKeyRef` … パスワードは manifest にも YAML にも値を書かず、Secret `lab-secrets` から読みます。

### 3.3 プローブ(見回り) {#s3-3}

```yaml
          startupProbe:
            httpGet:
              path: /healthz
              port: http
            periodSeconds: 2
            failureThreshold: 60
          readinessProbe:
            httpGet:
              path: /readyz
              port: http
            periodSeconds: 5
            timeoutSeconds: 3
            failureThreshold: 2
          livenessProbe:
            httpGet:
              path: /healthz
              port: http
            periodSeconds: 10
            timeoutSeconds: 3
            failureThreshold: 3
```

上の値は [k8s/generated/base/api.yaml](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/k8s/generated/base/api.yaml) のものです。storefront も同じ値で、readiness だけ `/healthz` を見ます(storefront には DB が無いため)。値は `tools/manifest/render.mjs` が決めていて、変えるときは render.mjs を直して作り直します。

- `startupProbe` … 起動したばかりの間だけの見回りです。2 秒ごとに `/healthz` を見て、通るまで(最大 60 回 = 120 秒)は readiness と liveness を始めません。起動が遅いときに「まだ準備中なのに固まったと思って再起動する」を防ぎます。
- `readinessProbe` … 5 秒ごとに `/readyz` を見ます。3 秒で返事が無いときも失敗に数え、2 回続けて失敗すると `READY 0/1` になり、振り分け先から外れます。api の `/readyz` は「起動の準備が終わり、DB に `SELECT 1` が通る」ときだけ 200 です。
- `livenessProbe` … 10 秒ごとに `/healthz` を見ます。3 回続けて失敗すると **コンテナを再起動** します。`/healthz` は DB を見ません。
- **なぜ 2 つに分けるか**: DB が止まったとき、api を再起動しても直りません。readiness で「お客さんを回さない」だけにし、liveness(再起動)は「プロセスそのものが固まった」ときだけにします。もし liveness に DB の確認を入れると、DB が止まった瞬間に api が全部再起動を繰り返す、という二次災害になります。
- storefront の readinessProbe は `/healthz` です(storefront には DB が無いため)。

### 3.4 requests と limits {#s3-4}

```yaml
          resources:
            requests:
              cpu: "50m"
              memory: "96Mi"
            limits:
              memory: "256Mi"
```

- `requests` … 「最低これだけは確保してほしい」という予約です。Pod をどのノードに置くかは、この値で決まります。`50m` は 0.05 CPU(1 CPU の 20 分の 1)、`96Mi` は 96 メビバイトです。
- `limits.memory` … 使ってよいメモリの上限です。超えると、そのコンテナは強制終了されます(`OOMKilled`、終了コード 137)。
- CPU の limits は書いていません。CPU は超えても殺されず、遅くなるだけ(絞られる)なので、ラボでは上限を付けずに様子を見やすくしています。
- 値は manifest.json の `resources`(`cpu`・`memory`・`memoryLimit`)から来ています。

### 3.5 Service {#s3-5}

```yaml
kind: Service
metadata:
  name: api
spec:
  selector:
    app.kubernetes.io/name: api
    app.kubernetes.io/part-of: samplestore
  ports:
    - name: http
      port: 3001
      targetPort: http
```

- `name: api` … クラスタの中では `http://api:3001` で呼べます。Pod が入れ替わって IP が変わっても、この名前は変わりません。storefront の `API_INTERNAL_URL` が軽量版と同じ `http://api:3001` で動くのはこのためです。
- `selector` … このラベルの Pod(のうち READY の物)に振り分けます。
- `targetPort: http` … Pod の側の `http` という名前のポート(3001)に渡します。

## 4. 確かめるコマンド {#s4}

本格版を `LAB_ENV=p1 k8s/up.sh`(PowerShell では `k8s/up.ps1 -Env p1`)で起動してから試します(既定は p1)。

::: code-group

```bash [Mac / Linux / WSL]
kubectl -n lab get pods
```

```powershell [PowerShell]
kubectl -n lab get pods
```

:::

期待する出力の形(名前の後ろの英数字は毎回変わります。並びは名前の順で、観測の道具の行は省いています):

```text
NAME                          READY   STATUS    RESTARTS      AGE
api-6d5f7c9b8d-2xkqp          1/1     Running   1 (2m ago)    3m
api-6d5f7c9b8d-9tq7w          1/1     Running   1 (2m ago)    3m
backoffice-7b9c6d5f4-kx2mz    1/1     Running   1 (2m ago)    3m
db-0                          1/1     Running   0             3m
search-5d9c8b7f6-m2x7c        1/1     Running   0             3m
storefront-5c8d7f6b9-h4jlp    1/1     Running   0             3m
storefront-5c8d7f6b9-w8r2n    1/1     Running   0             3m
worker-6f7d8c9b5-q5v8t        1/1     Running   1 (2m ago)    3m
...(このほか観測の道具: alertmanager・alloy・grafana・loki・otel-collector・pager・prometheus・tempo)
```

- クラスタを作った直後は、api・backoffice・worker の `RESTARTS` が `1` になることがあります。ノードが DB のイメージを取ってくる間、api などは 2 秒ごとに DB を 60 回(約 2 分)待ち、それでもつながらないと一度止まって作り直されるためです。作り直したあとは DB につながり、`1/1` になります。

- `db-0` のように後ろが番号だけなのは StatefulSet(DB のように「決まった名前とデータの置き場所」を持ち続ける物)の Pod です。ほかは Deployment の Pod です。

- 観測の道具もアプリと同じ Namespace `lab` にいます(Deployment の名前は `prometheus`・`alertmanager`・`pager`・`grafana`・`loki`・`alloy`・`otel-collector`・`tempo`)。入口の ingress-nginx だけは別の Namespace `ingress-nginx` にいるので、`kubectl -n ingress-nginx get pods` で見ます。

| 列 | 読み方 |
| --- | --- |
| `NAME` | `api`(Deployment)-`6d5f7c9b8d`(ReplicaSet の印)-`2xkqp`(Pod ごと) |
| `READY` | `1/1` = コンテナ 1 つのうち 1 つが readinessProbe に合格。`0/1` なら振り分け先から外れている |
| `STATUS` | `Running`(動いている)・`Pending`(置き場所が無い。メモリ不足など)・`CrashLoopBackOff`(落ちては再起動を繰り返し、待ち時間が延びている)・`ImagePullBackOff`(イメージが取れない) |
| `RESTARTS` | コンテナが再起動した回数。liveness の失敗や OOMKilled で増える |

::: code-group

```bash [Mac / Linux / WSL]
# Deployment・ReplicaSet・Service をまとめて見る
kubectl -n lab get deploy,rs,svc

# 振り分け先(Pod の IP)と、それぞれが振り分けてよい状態か(ready=true / false)を見る
kubectl -n lab get endpointslices -l kubernetes.io/service-name=api -o jsonpath='{range .items[*].endpoints[*]}{.addresses[0]}  ready={.conditions.ready}{"\n"}{end}'

# ある Pod の詳しい様子(プローブの結果・再起動の理由・出来事)
kubectl -n lab describe pod <Pod の名前>
#  Last State: Terminated  Reason: OOMKilled  Exit Code: 137  … メモリの上限を超えて殺された
#  Readiness probe failed: HTTP probe failed with statuscode: 503 … /readyz が 503

# ローリング更新を見る(別の端末で get pods -w を流しておくと、1 つずつ入れ替わる様子が見える)
kubectl -n lab get pods -w
kubectl -n lab rollout restart deploy/api
kubectl -n lab rollout status deploy/api      # 「successfully rolled out」で完了
kubectl -n lab rollout undo deploy/api        # 1 つ前の版に戻す

# 台数を変える(本来は manifest.json を直して作り直すのが筋。ここでは体験だけ)
kubectl -n lab scale deploy/api --replicas=3
kubectl -n lab scale deploy/api --replicas=2   # 戻す(k8s/up.sh をもう一度実行しても manifest の台数に戻ります)
```

```powershell [PowerShell]
# Deployment・ReplicaSet・Service をまとめて見る
kubectl -n lab get deploy,rs,svc

# 振り分け先(Pod の IP)と、それぞれが振り分けてよい状態か(ready=true / false)を見る
kubectl -n lab get endpointslices -l kubernetes.io/service-name=api -o jsonpath='{range .items[*].endpoints[*]}{.addresses[0]}  ready={.conditions.ready}{"\n"}{end}'

# ある Pod の詳しい様子(プローブの結果・再起動の理由・出来事)。get pods で見た名前を $pod に入れる
$pod = 'api-6d5f7c9b8d-2xkqp'
kubectl -n lab describe pod $pod
#  Last State: Terminated  Reason: OOMKilled  Exit Code: 137  … メモリの上限を超えて殺された
#  Readiness probe failed: HTTP probe failed with statuscode: 503 … /readyz が 503

# ローリング更新を見る(別の端末で get pods -w を流しておくと、1 つずつ入れ替わる様子が見える)
kubectl -n lab get pods -w
kubectl -n lab rollout restart deploy/api
kubectl -n lab rollout status deploy/api      # 「successfully rolled out」で完了
kubectl -n lab rollout undo deploy/api        # 1 つ前の版に戻す

# 台数を変える(本来は manifest.json を直して作り直すのが筋。ここでは体験だけ)
kubectl -n lab scale deploy/api --replicas=3
kubectl -n lab scale deploy/api --replicas=2   # 戻す(k8s/up.ps1 をもう一度実行しても manifest の台数に戻ります)
```

:::

PowerShell では `<Pod の名前>` のような `<` `>` の書き方がそのままでは打てないので、名前をいったん `$pod` に入れています。

軽量版(docker compose)には Pod も ReplicaSet もありません。近い物は次のとおりです。

::: code-group

```bash [Mac / Linux / WSL]
docker compose ps          # STATUS の (healthy) は、HEALTHCHECK の結果(api・backoffice・worker は /readyz、storefront は /healthz)
docker inspect --format '{{.State.OOMKilled}}' lab-api-1   # メモリ上限で殺されたか
```

```powershell [PowerShell]
docker compose ps          # STATUS の (healthy) は、HEALTHCHECK の結果(api・backoffice・worker は /readyz、storefront は /healthz)
docker inspect --format '{{.State.OOMKilled}}' lab-api-1   # メモリ上限で殺されたか
```

:::

## 5. CCv2 / Composable Storefront ではどこに当たるか {#s5}

| ラボ(本格版) | CCv2 で当たるもの |
| --- | --- |
| kind のクラスタ | SAP が運用する Kubernetes のクラスタ(利用者は kubectl で触らない) |
| Deployment(aspect ごと) | aspect ごとの Pod の集まり。Cloud Portal の環境の画面で、aspect ごとの台数や状態として見える |
| `replicas` | Cloud Portal での台数(スケーリング)の設定。**権限によっては画面に出ない** ことがあるので、案件の最初に誰が変えられるかを確かめる |
| ローリング更新 | デプロイのときの入れ替え方(止めずに入れ替える / 止めて入れ替える、を選ぶ) |
| readinessProbe / livenessProbe | SAP 側が組み込んでいる見回り。利用者が書くことは基本的に無い |
| `resources.limits.memory` | aspect ごとのメモリの大きさ(SAP 側の設定。足りなければ相談・スケールで対応) |
| Secret `lab-secrets` | Cloud Portal の環境ごとの設定・秘密の値の置き場所 |

## 6. よくある誤解 {#s6}

- **「Pod を 1 つ消したら、その分お店が減る」** → ReplicaSet がすぐ新しい Pod を作ります。減らしたいなら Deployment の `replicas` を変えます。
- **「Running なら、お客さんを受けている」** → `READY` が `1/1` になって初めて振り分け先に載ります。`Running` でも `0/1` なら受けていません。
- **「liveness に DB の確認を入れると安全」** → DB が止まると全 Pod が再起動を繰り返し、DB が戻っても立ち上がりが遅れます。外の都合は readiness で見ます。
- **「requests は上限」** → requests は予約(最低限)、limits が上限です。メモリの limits を超えると殺され、CPU は絞られるだけです。
- **「OOMKilled はアプリのバグだけが原因」** → 上限が小さすぎることもあります。`kubectl describe pod` の `Last State` と、指標のメモリの伸び方を見て判断します。

## 7. 関係する演習と設計書 {#s7}

- 演習: [インフラ-1 止めずに版を上げる(ローリング更新)](/exercises/05-infra-rolling-update)・[インフラ-2 設定値とシークレットを環境で分ける](/exercises/06-infra-config-and-secrets)・[性能-2 台数を増やして耐える](/exercises/13-perf-scale-out)・[障害-2 メモリ不足で再起動を繰り返す](/exercises/15-incident-crashloop)
- 設計書: [インフラ方式 4.3 メモリの上限](/design/architecture/03-infrastructure#s4-3)・[4.4 ヘルスチェックと再起動](/design/architecture/03-infrastructure#s4-4)・[4.6 止めずに入れ替える](/design/architecture/03-infrastructure#s4-6)・[BE 方式 4.6 ヘルスチェック](/design/architecture/02-backend#s4-6)・[4.8 穏やかな停止](/design/architecture/02-backend#s4-8)・[障害対応方式 4.4 再起動に任せる範囲](/design/architecture/08-incident-response#s4-4)・[D-INF-01 起動構成](/design/detail/D-INF-01-compose-and-k8s)
- 前後のページ: [仕組み-2 ingress](./02-ingress-and-endpoints) ・ [仕組み-4 storefront の SSR](./04-storefront-ssr)
