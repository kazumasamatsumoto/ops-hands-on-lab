# 準備と起動(軽量版・本格版)

このラボには 2 つの版があります。中で動くアプリ(画面・API・DB・入口・観測の道具)は同じです。

| | 軽量版 | 本格版 |
| --- | --- | --- |
| 仕組み | docker compose(Docker だけ) | kind(Docker の中で動く小さな Kubernetes) |
| 向いている演習 | ほとんど全部 | 台数・ヘルスチェック・ローリング更新・メモリ上限など「Kubernetes ならでは」の演習 |
| 起動の速さ | 初回 数分、2 回目から 1 分ほど | 初回 5〜15 分、2 回目から数分 |
| メモリの目安 | 約 2GB | 約 2.5〜3GB |

**まず軽量版で始めてください。** 本格版は、演習ページに「本格版」と書いてあるときに使います。
2 つの版は同じポート番号を使うので、**同時には動かせません**(片方を止めてからもう片方を起動します)。

## 用意するもの

| もの | 軽量版 | 本格版 | 入れ方・目安 |
| --- | --- | --- | --- |
| Docker Desktop(Mac / Windows)または Docker Engine(Linux) | 必要 | 必要 | Compose は v2.20 以上(`docker compose version` で確認) |
| Docker に割り当てるメモリ | 8GB 推奨 | 8GB 推奨 | Docker Desktop の Settings → Resources → Memory |

::: warning 軽量版と本格版は同時に動かさないでください
両方を同時に動かすと、メモリを 5GB 近く使います。Docker のメモリが 8GB 未満だと、本格版の Pod が「Pending(起動待ち)」のまま止まることがあります。片方を止めて(`docker compose down` または `k8s/down.sh`)から、もう片方を起動してください。どちらもポート 18080 などを使うので、同時には動きません。
:::
| ディスクの空き | 5GB | 10GB | イメージのダウンロード分 |
| kind | 不要 | 必要 | `brew install kind`(v0.30 以上) |
| kubectl | 不要 | 必要 | `brew install kubectl` |
| 空いているポート | 18080・13000・19090・19093・19094 | 同じ | 下の「困ったとき」で確かめ方を説明しています |

以下のコマンドは、どれもリポジトリの一番上のフォルダで打ちます。

## 軽量版(docker compose)

### 起動

```bash
docker compose up -d --build
docker compose ps      # STATUS が healthy になれば準備完了(1〜2 分)
```

### 止める

```bash
docker compose down        # 止める(DB などのデータは残る)
docker compose down -v     # 止めて、データも消す(まっさらに戻す)
```

## 本格版(kind)

### 起動

```bash
docker compose down        # 軽量版が動いていたら先に止める
k8s/up.sh                  # クラスタ作成 → イメージの用意 → 反映 → 全部 Ready まで待つ
kubectl -n lab get pods    # READY がどれも 1/1 なら準備完了
```

`k8s/up.sh` は最後に開く場所(URL)を表示します。何度実行しても大丈夫です。

### 止める

```bash
k8s/down.sh                # クラスタごと消す(データも消える。次の up.sh でまっさらに作り直される)
```

本格版だけの操作(Pod を見張る・ローリング更新・台数を増やす など)は `k8s/README.md` にまとめています。

## 開く場所(どちらの版も同じ)

| 何か | URL | ひとこと |
| --- | --- | --- |
| サンプルストア | http://localhost:18080 | お店の入口(edge)。見本の会員は `alice` / `bob` / `carol`、パスワードはどれも `password` |
| Grafana | http://localhost:13000 | ダッシュボード。ログインなしで見られます(編集は admin / admin) |
| Prometheus | http://localhost:19090 | 指標。「Status → Targets」で集め先、「Alerts」でアラート |
| Alertmanager | http://localhost:19093 | 今鳴っているアラート |
| pager | http://localhost:19094 | 届いた通知の一覧(5 秒ごとに更新) |

## わざと壊すスイッチ(カオス)の切り替え

API には、遅くする・エラーを返す・メモリをため込む などの「わざと壊すスイッチ」があります。
切り替えの入口(`/admin/chaos`)は社内からだけに制限しているので、ブラウザで http://localhost:18080/admin/chaos を開くと 403 になります(それが正しい動きです)。
代わりに、次のスクリプトで API の「中」から切り替えます。

| やりたいこと | 軽量版 | 本格版 |
| --- | --- | --- |
| 今の状態を見る | `tools/chaos.sh status` | `k8s/chaos.sh status` |
| 全 API に 1.5 秒の遅延 | `tools/chaos.sh set latencyMs=1500` | `k8s/chaos.sh set latencyMs=1500` |
| 半分を 500 エラーに | `tools/chaos.sh set errorRate=0.5` | `k8s/chaos.sh set errorRate=0.5` |
| メモリをため込む | `tools/chaos.sh set leakMb=5` | `k8s/chaos.sh set leakMb=5` |
| 他人の注文が見えるバグ | `tools/chaos.sh set idorBug=true` | `k8s/chaos.sh set idorBug=true` |
| 検索に SQL インジェクションの穴 | `tools/chaos.sh set sqliBug=true` | `k8s/chaos.sh set sqliBug=true` |
| 全部元に戻す | `tools/chaos.sh reset` | `k8s/chaos.sh reset` |
| 起動時の値を変える(作り直しても残す) | `docker-compose.yml` の `CHAOS_*` を変えて `docker compose up -d api` | `k8s/chaos.sh boot leakMb=20`(戻すのは `k8s/chaos.sh boot-reset`) |

違いのポイント:

- 本格版は API が 2 つ(Pod が 2 つ)動いています。`k8s/chaos.sh` は 2 つ全部に同じ指示を送ります。
- どちらの版も、API が落ちて作り直されると、スイッチは「起動時の値」に戻ります。
  本格版で「何度も落ちる」様子(CrashLoopBackOff)を見るときは `boot` を使います。

## 困ったとき

### ポートがもう使われている(`port is already allocated` / `address already in use`)

別のアプリか、もう片方の版が同じ番号を使っています。

```bash
lsof -iTCP:18080 -sTCP:LISTEN     # 18080 を使っているアプリを調べる(13000・19090・19093・19094 も同様)
docker ps --format '{{.Names}}\t{{.Ports}}' | grep -E '18080|13000|1909[034]'
```

- 軽量版が動いたまま本格版を起動した → `docker compose down` してから `k8s/down.sh` → `k8s/up.sh`
- 本格版が動いたまま軽量版を起動した → `k8s/down.sh` してから `docker compose up -d`
- 別のアプリ → そのアプリを止めるか、`docker-compose.yml`(または `k8s/kind-config.yaml` の `hostPort`)の番号を変える

### メモリが足りない(動きが遅い・コンテナが勝手に落ちる・Pod が Pending のまま)

- Docker Desktop の Settings → Resources → Memory を **8GB** にしてください。
- 他のコンテナが動いていないか `docker stats --no-stream` で確かめ、要らない物は止めます。
- 本格版で Pod が `Pending` のままなら `kubectl -n lab describe pod <名前>` の最後(Events)に `Insufficient memory` と出ていないか見ます。
- API だけが落ちるなら、スイッチ `leakMb` が入っていないか確かめます(`tools/chaos.sh status` / `k8s/chaos.sh status`)。

### ブラウザで開くと 403 になる・キャッシュがいつも BYPASS になる

ブラウザは `localhost` の Cookie を、ポート番号が違う**別のアプリとも共有**します。
ほかに localhost で動かしているアプリ(開発中のサイトなど)の Cookie が、ラボにも一緒に送られることがあります。

- **403(WAF の誤遮断)**: その Cookie の長い文字列を WAF が「怪しい」と判定することがあります。ラボでは Cookie を検査の対象から外す例外ルールを入れていますが、それでも出るときは、シークレットウィンドウで開いてください。
- **`X-Cache-Status: BYPASS`**: edge は「Cookie を持っている人 = ログイン中の人」とみなして、その人の画面をためません。キャッシュの HIT / MISS を見る演習では、Cookie を送らない `curl` を使うと分かりやすいです。

```bash
curl -sI http://localhost:18080/products | grep -i x-cache-status    # 1 回目 MISS、30 秒以内の 2 回目 HIT
```

### そのほか

| 症状 | 見るところ |
| --- | --- |
| 画面が 502 になる | web か api がまだ起動中です。軽量版は `docker compose ps`、本格版は `kubectl -n lab get pods` で待ちます |
| Grafana のグラフが空 | 数字は 5 秒ごとに集め、5 分の平均で計算します。サイトを何回か開いて 1〜2 分待ちます |
| 本格版で古いイメージのまま | イメージを作り直したら `k8s/up.sh` をもう一度実行し、`kubectl -n lab rollout restart deploy/api`(web なら deploy/web) |
| 本格版で kubectl が別のクラスタを見ている | `kubectl config use-context kind-lab` |
