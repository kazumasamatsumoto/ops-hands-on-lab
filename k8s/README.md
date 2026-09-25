# サンプルストア 体験ラボ(本格版: Kubernetes / kind)

軽量版(docker compose)と**同じアプリ・同じ設定**を、Kubernetes の上で動かす版です。
Kubernetes は kind(Kubernetes IN Docker = Docker のコンテナの中で動く小さな Kubernetes)で手元に作ります。

本格版で見られるのは、軽量版では見えにくい次のようなことです。

- 同じ Pod が 2 つ動き、1 つ消えてもすぐ作り直される(レプリカ)
- ヘルスチェックに失敗した Pod が Not Ready になり、お客さんの振り分け先から外れる
- 止めずに新しい版へ入れ替える(ローリング更新)
- メモリの上限を超えて強制終了(OOMKilled)→ 再起動の繰り返し(CrashLoopBackOff)
- コマンド 1 つで台数を増やす(スケールアウト)

## 用意するもの

| もの | 目安・入れ方 |
| --- | --- |
| Docker Desktop | メモリの割り当て **8GB 推奨**(本格版だけで 2.5〜3GB ほど使います) |
| kind | `brew install kind`(Mac)。v0.30 以上 |
| kubectl | `brew install kubectl`(Docker Desktop に付いてくる物でも可) |
| 空いているポート | 18080・13000・19090・19093・19094(軽量版と同じ番号) |

> **軽量版と本格版は同時に動かせません**(同じポート番号を使うため)。本格版を始める前に、リポジトリの一番上で `docker compose down` してください。

## 起動と停止

```bash
# 起動(クラスタ作成 → イメージのビルドと読み込み → 反映 → 全部 Ready になるまで待つ)
# 初回はノードのイメージや観測の道具のイメージを取得するので 5〜15 分かかります。
k8s/up.sh

# 停止(クラスタごと消します。DB・指標・ログのデータも消えます)
k8s/down.sh
```

`k8s/up.sh` は何度実行しても大丈夫です。設定ファイルを直したときも、もう一度実行すれば反映されます
(ConfigMap を変えただけでは動いている Pod は変わらないので、そのあと `kubectl -n lab rollout restart deploy/edge` のように作り直します)。

> ふだんは不要ですが、クラスタの名前や定義ファイルを変えたいとき(軽量版と同時に動かしたい、など)は環境変数で指定できます。
> `LAB_CLUSTER`(クラスタの名前。既定は `lab`)と `LAB_KIND_CONFIG`(定義ファイル。既定は `k8s/kind-config.yaml`)です。
> 例: `hostPort` を 28080 などに変えた定義ファイルを別に作り、`LAB_CLUSTER=lab2 LAB_KIND_CONFIG=my-kind.yaml k8s/up.sh`。
> このとき `k8s/chaos.sh` と `k8s/down.sh` にも同じ `LAB_CLUSTER=lab2` を付け、`kind load ... --name lab` の `lab` も読み替えます。

開く場所は軽量版と同じです。

| 何か | URL |
| --- | --- |
| サンプルストア | http://localhost:18080 |
| Grafana | http://localhost:13000(ホームが「サンプルストア SLO」) |
| Prometheus | http://localhost:19090 |
| Alertmanager | http://localhost:19093 |
| pager | http://localhost:19094 |

kind はクラスタを作ると kubectl の接続先(コンテキスト)を `kind-lab` に切り替えます。以下のコマンドはその前提で、いつも `-n lab`(lab の部屋 = Namespace)を付けています。

## 軽量版との違い

| 項目 | 軽量版(docker compose) | 本格版(kind) |
| --- | --- | --- |
| 動かす単位 | コンテナ | Pod(コンテナを包む箱) |
| api・web の数 | 1 つずつ | 2 つずつ(`replicas: 2`) |
| 死活監視 | Docker の healthcheck(見るだけ) | readiness / liveness / startup の 3 種類の probe(振り分けから外す・再起動する) |
| メモリの上限 | `mem_limit`(api 256MB) | `resources.limits`(api **192Mi**)と `requests`(予約) |
| 落ちたとき | `restart: unless-stopped` で再起動 | kubelet が再起動。繰り返すと待ち時間が延びる(CrashLoopBackOff) |
| 版の入れ替え | 止めて作り直す | ローリング更新(止めずに 1 つずつ) |
| 設定と秘密 | compose ファイルの `environment` | ConfigMap(`api-config` / `web-config`)と Secret(`lab-secrets`) |
| DB のデータ | Docker のボリューム | PersistentVolumeClaim(保存場所の予約票) |
| 入口 | ポート公開(`ports`) | Service の NodePort(30080)→ kind がホストの 18080 につなぐ |
| 指標の集め方 | 決まった名前(`api:3001`)を見る | Kubernetes に「今いる Pod」を聞いて全部から集める |
| ログの集め方 | Alloy が Docker のソケットから | Alloy が Kubernetes の API から(`kubectl logs` と同じ) |
| カオスの切り替え | `tools/chaos.sh` | `k8s/chaos.sh`(全部の api Pod に送る。`boot` で起動時の値も変えられる) |
| `/admin/` | edge の外(ホスト)からは 403 | 同じく 403(`k8s/chaos.sh` は Pod の中から直接頼む) |

同じ物をそのまま使っているもの: api・web のイメージ(Dockerfile)、edge の nginx 設定と WAF の例外ルール(名前を調べる先と振り分け先の名前だけ `up.sh` が書き換え)、Prometheus のルール、Alertmanager、Grafana のデータソースとダッシュボード、Loki、pager。

## フォルダの中身

```
k8s/
  kind-config.yaml      クラスタの定義(ノード 1 台、ホストのポートとのつなぎ)
  up.sh / down.sh       起動と停止
  chaos.sh              わざと壊すスイッチ
  manifests/            Kubernetes に渡す設計図(kubectl apply -k k8s/manifests でまとめて反映)
    namespace.yaml        lab の部屋
    secret.yaml           DB のパスワードと JWT の署名鍵(ラボ専用の見本の値)
    configmap-app.yaml    api と web の環境変数
    db.yaml               PostgreSQL(StatefulSet + PVC)
    api.yaml / web.yaml   Deployment(2 つずつ、probe、requests/limits)と Service
    edge.yaml             nginx + ModSecurity(NodePort 30080)
    observability.yaml    Prometheus・Alertmanager・pager・Grafana・Loki・Alloy
  config/               本格版だけ中身が違う設定(Prometheus の収集先、Alloy のログの集め方)
```

## Kubernetes の言葉と、画面で見えるもの

| 言葉 | 一言 | たとえ | このラボで見えるもの |
| --- | --- | --- | --- |
| Pod | コンテナを包んだ、動かす最小の単位 | お弁当箱(中身がコンテナ) | `kubectl -n lab get pods` の 1 行 1 行(`api-7c9f...-x2k4p`) |
| ReplicaSet | 「同じ Pod を N 個」保つ係 | 人数を数える班長 | `kubectl -n lab get rs`。ローリング更新のたびに新しい ReplicaSet ができる |
| Deployment | ReplicaSet を使って版の入れ替えまで面倒を見る係 | 店長(班長を入れ替えながら営業を続ける) | `kubectl -n lab get deploy`(`READY 2/2`) |
| Service | Pod たちの代表の窓口(名前と番号が変わらない) | 代表電話番号 | `kubectl -n lab get svc`。`api` という名前で、Ready の Pod にだけつなぐ |
| probe(readiness) | 「お客さんを受けられるか」の確認 | 開店前の「準備できた?」 | 失敗すると `READY 0/1`。Pod は生きたまま振り分けから外れる |
| probe(liveness) | 「生きているか」の確認 | 脈を取る | 失敗が続くと `RESTARTS` が増える(再起動される) |
| requests | 最低これだけは確保、という予約 | 会議室の予約 | `kubectl -n lab describe pod` の `Requests:` |
| limits | これ以上は使わせない上限 | 電気のブレーカー | メモリを超えると即座に強制終了(次の行) |
| OOMKilled | メモリの上限を超えて強制終了されたこと | ブレーカーが落ちた | `describe pod` の `Last State: Terminated  Reason: OOMKilled` |
| CrashLoopBackOff | 起動しては落ちるので、再起動の間隔を延ばしている状態 | 何度も落ちるブレーカーを、少し待ってから上げ直す | `get pods` の `STATUS` 欄。待ち時間は 10 秒 → 20 秒 → 40 秒 … 最大 5 分 |
| ローリング更新 | 新しい Pod を足し、準備できたら古い Pod を減らす、を繰り返す入れ替え | 営業しながら店員を 1 人ずつ交代 | `kubectl -n lab rollout status deploy/web` |
| NodePort | ノードの決まった番号で外に出す Service | 建物の通用口の番号 | `edge` の `8080:30080/TCP` |

## 短い演習(デモ)

どのデモも、ターミナルを 2〜3 個並べると分かりやすいです。
1 つ目で Pod を見張り、2 つ目で操作、3 つ目でお客さんのまね(curl のくり返し)をします。

### 0. Pod を見張る

```bash
kubectl -n lab get pods -w          # -w = 変化があるたびに 1 行ずつ出す(止めるのは Ctrl+C)
kubectl -n lab get deploy,rs,svc    # Deployment・ReplicaSet・Service の一覧
```

### 1. ローリング更新(止めずに入れ替える)

お客さんのまね(止めるのは Ctrl+C。200 以外が出たら「止まった」ということです):

```bash
while true; do curl -s -o /dev/null -w '%{http_code}\n' "http://localhost:18080/products/1?t=$RANDOM"; sleep 0.2; done
```

`?t=$RANDOM` は edge のキャッシュを避けて、毎回 web まで届かせるためです。

別のターミナルで入れ替えます。

```bash
# 同じイメージのまま Pod を全部作り直す(設定を変えたときもこれ)
kubectl -n lab rollout restart deploy/web
kubectl -n lab rollout status deploy/web     # 「successfully rolled out」で完了

# 「新しい版のイメージ」に入れ替える場合(タグを付けて kind に読み込んでから set image)
docker tag lab/web:local lab/web:v2
kind load docker-image lab/web:v2 --name lab
kubectl -n lab set image deploy/web web=lab/web:v2
kubectl -n lab rollout status deploy/web

# 元に戻す(1 つ前の版へ)
kubectl -n lab rollout undo deploy/web
kubectl -n lab rollout history deploy/web
```

見えること: `get pods -w` で新しい Pod が 1 つ増え、`READY 1/1` になってから古い Pod が 1 つ `Terminating` になる、をくり返します。
curl のくり返しはずっと `200` のままです。

### 2. readiness で Not Ready になる(DB を止める)

```bash
kubectl -n lab scale statefulset/db --replicas=0    # DB を止める
kubectl -n lab get pods -w                          # api が READY 0/1 になる(RESTARTS は増えない)
kubectl -n lab get endpoints api                    # ENDPOINTS 欄が空になる(振り分け先が無い)(deprecated の警告は無視して大丈夫です)
curl -s -o /dev/null -w '%{http_code}\n' "http://localhost:18080/api/products/1?t=$RANDOM"   # 502(edge から見て、つなぐ先の Pod がいない)
kubectl -n lab scale statefulset/db --replicas=1    # 戻す → しばらくで api が 1/1 に戻る
```

見どころ: api は `/readyz`(DB に届くか)で Not Ready になり振り分けから外れますが、`/healthz`(生きているか)は元気なので**再起動はされません**。
「DB が落ちただけで api を再起動しても直らない」ので、2 つの probe を分けています。

### 3. OOMKilled → CrashLoopBackOff(メモリ不足で再起動を繰り返す)

```bash
# 起動時の値を「リクエストのたびに 20MB ためる」にする(Pod が作り直されても残る)
k8s/chaos.sh boot leakMb=20

# お客さんのまね(api にリクエストを送り続ける。?q= を変えてキャッシュを避けます)
while true; do curl -s -o /dev/null -w '%{http_code}\n' "http://localhost:18080/api/products?q=$RANDOM"; sleep 0.3; done

# 見張る
kubectl -n lab get pods -l app=api -w
```

見えること: api の Pod の `STATUS` が `Running` → `OOMKilled` → `Running` → … → `CrashLoopBackOff` になり、`RESTARTS` が増えていきます。
curl には 502(edge から見て、つなぐ先の api がいない)が混ざり始めます。理由は次で確かめます。

```bash
kubectl -n lab describe pod -l app=api | grep -A5 'Last State'   # Reason: OOMKilled / Exit Code: 137
kubectl -n lab logs deploy/api --previous --tail=20              # 落ちる直前のログ(--previous = 1 つ前のコンテナ)
kubectl -n lab get events --sort-by=.lastTimestamp | tail -20    # BackOff(再起動を待っている)などの出来事
```

片付け(起動時の値を元に戻す。新しい Pod に入れ替わり、10 秒ほどで直ります):

```bash
k8s/chaos.sh boot-reset
kubectl -n lab rollout status deploy/api
```

> `k8s/chaos.sh set leakMb=5` のように「動いている Pod のスイッチ」だけ変えた場合は、1 回 OOMKilled で再起動すると
> スイッチが起動時の値(0)に戻るので、CrashLoopBackOff までは行きません。繰り返し落ちる様子を見るときは `boot` を使います。

### 4. 台数を増やす(スケールアウト)

```bash
kubectl -n lab scale deploy/web --replicas=4
kubectl -n lab get pods -l app=web -w       # 4 つが Running・1/1 になる
kubectl -n lab get endpoints web            # 振り分け先が 4 つに増えている(3 つ + 「+ 1 more...」と出ます。deprecated の警告は無視して大丈夫です)
kubectl -n lab scale deploy/web --replicas=2  # 戻す
```

このラボでは HPA(負荷に合わせて自動で台数を変える仕組み)は入れていません。HPA には CPU の使用量を集める metrics-server が別に必要で、
kind では追加の設定が要るためです。本番では「CPU 70% を超えたら増やす」のように HPA で自動にするのが普通です。

### 5. 調べるときの基本の 3 つ

```bash
kubectl -n lab describe pod <Pod の名前>     # 状態・probe の結果・再起動の理由・出来事(Events)
kubectl -n lab logs <Pod の名前>             # ログ(-f で流し続ける、--previous で落ちる前)
kubectl -n lab logs -l app=api --tail=20     # api の全 Pod のログをまとめて
```

Grafana(http://localhost:13000)のログのパネルでも、同じログを Pod の名前つき(ラベル `pod`)で探せます。

## わざと壊すスイッチ(本格版)

```bash
k8s/chaos.sh status                 # 全部の api Pod の今の状態
k8s/chaos.sh set latencyMs=1500     # 全部の api Pod に遅延
k8s/chaos.sh set errorRate=0.5
k8s/chaos.sh set idorBug=true
k8s/chaos.sh set sqliBug=true
k8s/chaos.sh reset                  # 全部元に戻す
k8s/chaos.sh boot leakMb=20         # 起動時の値を変える(Pod が作り直される)
k8s/chaos.sh boot-reset             # 起動時の値を戻す
```

スイッチは Pod ごとに持っています。`kubectl -n lab exec deploy/api -- curl ...` と手で打つと、2 つある api Pod の**どちらか 1 つ**にしか届かない点に気を付けてください
(片方だけ壊れている = 「ときどきだけ失敗する」障害の再現にも使えます)。

## うまく動かないとき

| 症状 | 見るところ・直し方 |
| --- | --- |
| `up.sh` が `address already in use` で止まる | 軽量版が動いていませんか。`docker compose down` してから `k8s/down.sh` → `k8s/up.sh` |
| Pod が `Pending` のまま | メモリが足りません。`kubectl -n lab describe pod <名前>` の Events に `Insufficient memory`。Docker Desktop のメモリを増やす |
| Pod が `ImagePullBackOff` | ネット接続を確認。`lab/api:local` なら `kind load docker-image lab/api:local --name lab` をやり直す |
| `ErrImageNeverPull` や古い画面のまま | イメージを作り直したら `kind load docker-image ...` と `rollout restart` の両方が必要です |
| 画面が 403 になる | 別の localhost のアプリの Cookie が原因のことがあります。シークレットウィンドウで開くか、`curl` で確かめる |
| 初回の起動で api の `RESTARTS` が 1 以上になっている | DB のイメージ取得に時間がかかり(ネットが遅いと 3 分以上)、api が DB を待ちきれずにやり直しただけです。`READY 1/1` なら問題ありません |
| kubectl が別のクラスタにつながる | `kubectl config use-context kind-lab` |
