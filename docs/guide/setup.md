# 準備と起動(軽量版・本格版)

このラボには 2 つの版があります。中で動くアプリ(storefront・api・backoffice・worker・DB・入口・観測の道具)は同じイメージで、
構成は SAP Commerce Cloud(CCv2)でヘッドレスのお店を動かすときの形に寄せています。

| | 軽量版 | 本格版 |
| --- | --- | --- |
| 仕組み | docker compose(Docker だけ) | kind(Docker の中で動く小さな Kubernetes) |
| 向いている演習 | ほとんど全部 | 台数・ヘルスチェック・ローリング更新・メモリ上限・トレース・環境の切り替えなど「Kubernetes ならでは」の演習 |
| 起動の速さ | 初回 数分、2 回目から 1 分ほど | 初回 10〜15 分、2 回目から数分 |
| メモリの目安 | 約 2.5GB | 約 3GB |

**まず軽量版で始めてください。** 本格版は、演習ページに「本格版では」と書いてあるときに使います。
2 つの版は同じポート番号を使うので、**同時には動かせません**(片方を止めてからもう片方を起動します)。

## 用意するもの

| もの | 軽量版 | 本格版 | 入れ方・目安 |
| --- | --- | --- | --- |
| Docker Desktop(Mac / Windows)または Docker Engine(Linux) | 必要 | 必要 | Compose は v2.20 以上(`docker compose version` で確認) |
| Docker に割り当てるメモリ | **8GB** | **8GB** | Docker Desktop の Settings → Resources → Memory |
| ディスクの空き | 5GB | 10GB | イメージのダウンロード分 |
| kind | 不要 | 必要 | `brew install kind`(Mac、v0.30 以上) |
| kubectl | 不要 | 必要 | `brew install kubectl`(Docker Desktop に付いてくる物でも可) |
| Node.js | あると便利 | 必要 | 24 以上(`tools/manifest/render.mjs` を動かすため) |
| 空いているポート | 18080・13000・19090・19093・19094 | 同じ | 下の「困ったとき」で確かめ方を説明しています |

::: warning 軽量版と本格版は同時に動かさないでください
両方を同時に動かすと、メモリを 5GB 以上使い、どちらもポート 18080 などを使うので衝突します。
片方を止めて(`docker compose down` または `k8s/down.sh`)から、もう片方を起動してください。
:::

以下のコマンドは、どれもリポジトリの一番上のフォルダ(`docker-compose.yml` がある場所)で打ちます。

## `*.localhost` の名前について

第 2 版は、お店・API・管理画面を **3 つのホスト名** で開きます。

| 何か | URL |
| --- | --- |
| お店(storefront) | http://www.lab.localhost:18080 |
| API(api) | http://api.lab.localhost:18080 |
| 管理画面(backoffice) | http://backoffice.lab.localhost:18080/backoffice/ |

`www.lab.localhost` のように `.localhost` で終わる名前は、**Chrome・Edge・Firefox・curl では設定なしで** 自分の PC(127.0.0.1)になります。

::: tip Safari で開けないときは
Safari など一部のブラウザは `*.localhost` を自動では解決しません。次の 1 行を `/etc/hosts`(Windows は `C:\Windows\System32\drivers\etc\hosts`)に足してください(管理者の権限が要ります)。

```
127.0.0.1 www.lab.localhost api.lab.localhost backoffice.lab.localhost
```

Mac なら `sudo sh -c 'echo "127.0.0.1 www.lab.localhost api.lab.localhost backoffice.lab.localhost" >> /etc/hosts'` です。
:::

18080 番は、この PC の中(127.0.0.1)からだけ開けるようにしています。同じ LAN の別の PC からは届きません(攻撃の見本を外に向けないためにも大事です)。

## 軽量版(docker compose)

### 起動

```bash
docker compose up -d --build
docker compose ps      # STATUS が healthy になれば準備完了(1〜2 分。loki と alloy は検査が無いので Up だけです)
```

### 止める

```bash
docker compose down        # 止める(DB などのデータは残る)
docker compose down -v     # 止めて、データも消す(まっさらに戻す)
```

演習を 1 つ終えるたびに、その演習の「片付け」でスイッチを戻してください。全部終わったら `docker compose down -v` でまっさらに戻せます。

## 本格版(kind)

### 起動・環境の切り替え・停止

```bash
docker compose down        # 軽量版が動いていたら先に止める
k8s/up.sh                  # クラスタ作成 → イメージの用意 → 反映 → 全部 Ready まで待つ(初回 10〜15 分)
kubectl -n lab get pods    # READY がどれも整えば準備完了

# 環境を切り替える(d1 = 開発、s1 = ステージング、p1 = 本番。既定は p1)。LAB_SKIP_BUILD=1 でビルドを飛ばせます
LAB_ENV=d1 LAB_SKIP_BUILD=1 k8s/up.sh
LAB_ENV=p1 LAB_SKIP_BUILD=1 k8s/up.sh

k8s/down.sh                # クラスタごと消す(データも消える。次の up.sh でまっさらに作り直される)
```

`k8s/up.sh` は何度実行しても大丈夫です。開く場所(URL)は軽量版と同じです。
本格版だけの操作(Pod を見張る・ローリング更新・台数を増やす・トレースを見る など)は `k8s/README.md` にまとめています。

## 開く場所(どちらの版も同じ)

| 何か | URL | ひとこと |
| --- | --- | --- |
| お店(storefront) | http://www.lab.localhost:18080 | Angular の SSR。画面の中身は api の CMS の JSON で決まります |
| API(api) | http://api.lab.localhost:18080 | 例: http://api.lab.localhost:18080/occ/v2/samplestore/products/search?query=ノート |
| 管理画面(backoffice) | http://backoffice.lab.localhost:18080/backoffice/ | `admin` / `admin`。社内の IP からだけ(この PC は社内扱い) |
| Grafana | http://localhost:13000 | ダッシュボード。ログインなしで見られます(編集は admin / admin) |
| Prometheus | http://localhost:19090 | 指標。「Status → Targets」で集め先、「Alerts」でアラート |
| Alertmanager | http://localhost:19093 | 今鳴っているアラート |
| pager | http://localhost:19094 | 届いた通知の一覧(5 秒ごとに更新) |

見本の会員: `alice` / `bob` / `carol`(パスワードはどれも `password`)。商品は `100001`〜`100030`(例: http://www.lab.localhost:18080/p/100001)。

## わざと壊すスイッチ(カオス)の切り替え

api・worker には、遅くする・エラーを返す・メモリをため込む・認可の穴・SQL インジェクションの穴・定期ジョブの失敗 などの「わざと壊すスイッチ」があります。
切り替えの入口(`/admin/chaos`)は外から遮断しているので、ブラウザや `curl` では変えられません(それが正しい動きです)。代わりに、次のスクリプトが対象のコンテナの中から切り替えます。

| やりたいこと | 軽量版 | 本格版 | どの役に効くか |
| --- | --- | --- | --- |
| 今の状態を見る | `tools/chaos.sh status` | `k8s/chaos.sh status` | api |
| OCC の API とトークンに 1.5 秒の遅延 | `tools/chaos.sh set latencyMs=1500` | `k8s/chaos.sh set latencyMs=1500` | api |
| 半分を 500 エラーに | `tools/chaos.sh set errorRate=0.5` | `k8s/chaos.sh set errorRate=0.5` | api |
| リクエストごとにメモリをため込む | `tools/chaos.sh set leakMb=5` | `k8s/chaos.sh set leakMb=5` | api |
| 他人の注文が見えるバグ | `tools/chaos.sh set idorBug=true` | `k8s/chaos.sh set idorBug=true` | api |
| 検索の query に SQL インジェクションの穴 | `tools/chaos.sh set sqliBug=true` | `k8s/chaos.sh set sqliBug=true` | api |
| 定期ジョブを全部失敗させる | `tools/chaos.sh worker set cronFail=true` | `k8s/chaos.sh worker set cronFail=true` | worker |
| api のスイッチを全部戻す | `tools/chaos.sh reset` | `k8s/chaos.sh reset` | api |
| worker のスイッチを戻す | `tools/chaos.sh worker reset` | `k8s/chaos.sh worker reset` | worker |
| 起動時の値を変える(作り直しても残す) | `CHAOS_LEAK_MB=20 docker compose up -d api` | `k8s/chaos.sh boot leakMb=20`(戻すのは `boot-reset`) | api |

違いのポイント:

- 本格版は api が 2 つ(Pod が 2 つ)動いています。`k8s/chaos.sh` は 2 つ全部に同じ指示を送ります。
- どちらの版も、対象が落ちて作り直されると、スイッチは「起動時の値」に戻ります。
  本格版で「何度も落ちる」様子(CrashLoopBackOff)を見るときは `boot` を使います。
- **演習が終わったら、その演習の「片付け」でスイッチを必ず戻してください。** 戻し忘れると、次の演習の数字がずれます。

## 困ったとき

### ポートがもう使われている(`port is already allocated` / `address already in use`)

別のアプリか、もう片方の版が同じ番号を使っています。

```bash
lsof -iTCP:18080 -sTCP:LISTEN     # 18080 を使っているアプリを調べる(13000・19090・19093・19094 も同様)
docker ps --format '{{.Names}}\t{{.Ports}}' | grep -E '18080|13000|1909[034]'
```

- 軽量版が動いたまま本格版を起動した → `docker compose down` してから `k8s/down.sh` → `k8s/up.sh`
- 本格版が動いたまま軽量版を起動した → `k8s/down.sh` してから `docker compose up -d`
- 別のアプリ → そのアプリを止めるか、`docker-compose.yml`(または本格版は `k8s/kind-config.yaml`)の番号を変える

### メモリが足りない(動きが遅い・コンテナが勝手に落ちる・Pod が Pending のまま)

- Docker Desktop の Settings → Resources → Memory を **8GB** にしてください。
- 要らないコンテナが動いていないか `docker stats --no-stream` で確かめ、止めます。
- 本格版で Pod が `Pending` のままなら `kubectl -n lab describe pod <名前>` の最後(Events)に `Insufficient memory` と出ていないか見ます。
- api だけが落ちるなら、スイッチ `leakMb` が入っていないか確かめます(`tools/chaos.sh status`)。

### `www.lab.localhost` が開けない

- Chrome・Edge・Firefox・curl は設定なしで開けます。Safari など一部は、上の「`*.localhost` の名前について」の `/etc/hosts` の 1 行が要ります。
- `curl` で確かめるとき、`?` の入った URL は zsh(Mac の標準のシェル)では必ず `"..."` で囲みます(囲まないと `no matches found`)。

### 管理画面(backoffice)がこの PC からも 403 になる

- `http://backoffice.lab.localhost:18080/backoffice/`(cdn-waf を通す住所)で開いていますか。
- IP フィルタを変える演習([ネットワーク-3](/exercises/20-nw-ingress-endpoints))のあとなら、`docker compose up -d ingress`(つまみを付けずに起動)で既定の許す範囲に戻ります。

### そのほか

| 症状 | 見るところ |
| --- | --- |
| 画面が 502・504 になる | storefront か api がまだ起動中です。軽量版は `docker compose ps`、本格版は `kubectl -n lab get pods` で待ちます |
| 変えたはずのバナー・価格が反映されない | cdn-waf のキャッシュ(30 秒)が効いています。30 秒待つか、`EDGE_CACHE=off docker compose up -d cdn-waf`([ネットワーク-1](/exercises/07-nw-cache)) |
| Grafana のグラフが空 | 数字は 5 秒ごとに集め、5 分の平均で計算します。サイトを何回か開いて 1〜2 分待ちます |
| CSP で `Refused to execute inline script ... 'sha256-...'` が出る | Angular の更新で埋め込みスクリプトの指紋が変わりました。README の「CSP の指紋」で足します |
| 本格版で古いイメージのまま | `k8s/up.sh` をもう一度実行するとイメージを作り直してノードに読み込みます(`kind load`)。ただし名前が同じ `lab/api:local`・`lab/web:local` のままなので、動いている Pod は入れ替わりません。続けて `kubectl -n lab rollout restart deploy/api deploy/backoffice deploy/worker deploy/storefront` で作り直します |
| 本格版で kubectl が別のクラスタを見ている | `kubectl config use-context kind-lab` |
