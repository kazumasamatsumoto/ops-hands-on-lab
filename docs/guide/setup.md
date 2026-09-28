# 準備と起動(軽量版・本格版)

このラボには 2 つの版があります。中で動くアプリ(storefront・api・backoffice・worker・DB・入口・観測の道具)は同じイメージで、
構成は SAP Commerce Cloud(CCv2)でヘッドレスのお店を動かすときの形に寄せています。

| | 軽量版 | 本格版 |
| --- | --- | --- |
| 仕組み | docker compose(Docker だけ) | kind(Docker の中で動く小さな Kubernetes) |
| 向いている演習 | ほとんど全部 | 台数・ヘルスチェック・ローリング更新・メモリ上限・トレース・環境の切り替えなど「Kubernetes ならでは」の演習 |
| 起動の速さ | 初回 数分、2 回目から 1 分ほど | 初回 10〜15 分、2 回目から数分 |
| メモリの目安 | 約 2.5GB | 約 3〜3.5GB |

**まず軽量版で始めてください。** 本格版は、演習ページに「本格版では」と書いてあるときに使います。
2 つの版は同じポート番号を使うので、**同時には動かせません**(片方を止めてからもう片方を起動します)。

## 用意するもの

| もの | 軽量版 | 本格版 | 入れ方・目安 |
| --- | --- | --- | --- |
| Docker Desktop(Mac / Windows)または Docker Engine(Linux) | 必要 | 必要 | Compose は v2.20 以上(`docker compose version` で確認) |
| Docker に割り当てるメモリ | **8GB** | **8GB** | Mac は Docker Desktop の Settings → Resources → Memory。Windows は `.wslconfig` で決めます([Windows で使う](/guide/windows#memory)) |
| ディスクの空き | 5GB | 10GB | イメージのダウンロード分 |
| kind | 不要 | 必要 | Mac は `brew install kind`(v0.30 以上)。Windows は `winget install Kubernetes.kind`、WSL2・Linux は curl で入れます([Windows で使う](/guide/windows#full)) |
| kubectl | 不要 | 必要 | Mac は `brew install kubectl`(Docker Desktop に付いてくる物でも可)。Windows は `winget install Kubernetes.kubectl`、WSL2・Linux は同上 |
| Node.js | あると便利 | 必要 | 24 以上(`tools/manifest/render.mjs` を動かすため) |
| 空いているポート | 18080・13000・19090・19093・19094 | 同じ | 下の「困ったとき」で確かめ方を説明しています |
| Windows だけ: PowerShell 7 | 必要 | 必要 | `winget install Microsoft.PowerShell`。Windows PowerShell 5.1 では動きません([Windows で使う](/guide/windows)) |

::: warning 軽量版と本格版は同時に動かさないでください
両方を同時に動かすと、メモリを 5GB 以上使い、どちらもポート 18080 などを使うので衝突します。
片方を止めて(`docker compose down` または `k8s/down.sh`)から、もう片方を起動してください。
:::

以下のコマンドは、どれもリポジトリの一番上のフォルダ(`docker-compose.yml` がある場所)で打ちます。

::: tip Windows の人へ
コマンドの囲みには **「Mac / Linux / WSL」と「PowerShell」の 2 つのタブ** があります。Windows では次のどちらかを選びます。準備のしかたは [Windows で使う](/guide/windows) にまとめているので、先にそちらを済ませてください。

- **WSL2 の Ubuntu**(おすすめ): 「Mac / Linux / WSL」のタブの bash のコマンドを、Ubuntu の中でそのまま打ちます。Mac・Linux とまったく同じコマンドです。
- **PowerShell 7 + Docker Desktop**(WSL を使えない人向け): 「PowerShell」のタブのコマンドを打ちます。`tools/chaos.sh` などのスクリプトは、同じ名前の `tools/chaos.ps1` を使います。
:::

## `*.localhost` の名前について

第 2 版は、お店・API・管理画面を **3 つのホスト名** で開きます。

| 何か | URL |
| --- | --- |
| お店(storefront) | http://www.lab.localhost:18080 |
| API(api) | http://api.lab.localhost:18080 |
| 管理画面(backoffice) | http://backoffice.lab.localhost:18080/backoffice/ |

`www.lab.localhost` のように `.localhost` で終わる名前は、**Chrome・Edge・Firefox・curl(7.85 以降)では設定なしで** 自分の PC(127.0.0.1)になります。

::: tip Safari で開けないときは
Safari は名前の解決を OS に任せるので、macOS 26(Tahoe)より前の Mac では `*.localhost` を自動では解決しません(ほかにも同じようなブラウザがあります)。次の 1 行を `/etc/hosts`(Windows は `C:\Windows\System32\drivers\etc\hosts`)に足してください(管理者の権限が要ります)。

```
127.0.0.1 www.lab.localhost api.lab.localhost backoffice.lab.localhost
```

::: code-group

```bash [Mac / Linux / WSL]
sudo sh -c 'echo "127.0.0.1 www.lab.localhost api.lab.localhost backoffice.lab.localhost" >> /etc/hosts'
```

```powershell [PowerShell]
# 管理者として開いた PowerShell で(Windows では、確実にするためこの 1 行を入れておくことをおすすめします)
Add-Content -Path "$env:SystemRoot\System32\drivers\etc\hosts" -Value "`r`n127.0.0.1 www.lab.localhost api.lab.localhost backoffice.lab.localhost"
```

:::

::: tip PowerShell では `curl` ではなく `curl.exe`
PowerShell の `curl` は別のコマンド(Invoke-WebRequest)の別名です。このサイトの「PowerShell」のタブでは、必ず `curl.exe` と書いています(コンテナの中で打つ `docker compose exec api curl …` は Linux の curl なので `.exe` を付けません)。
:::

18080 番は、この PC の中(127.0.0.1)からだけ開けるようにしています。同じ LAN の別の PC からは届きません(攻撃の見本を外に向けないためにも大事です)。

## 軽量版(docker compose)

### 起動

::: code-group

```bash [Mac / Linux / WSL]
docker compose up -d --build
docker compose ps      # STATUS が healthy になれば準備完了(1〜2 分。loki と alloy は検査が無いので Up だけです)
curl -s -o /dev/null -w '%{http_code}\n' http://www.lab.localhost:18080/    # 200 ならお店が開いている
```

```powershell [PowerShell]
docker compose up -d --build
docker compose ps      # STATUS が healthy になれば準備完了(1〜2 分。loki と alloy は検査が無いので Up だけです)
curl.exe -s -o NUL -w '%{http_code}\n' http://www.lab.localhost:18080/     # 200 ならお店が開いている
```

:::

### 止める

::: code-group

```bash [Mac / Linux / WSL]
docker compose down        # 止める(DB などのデータは残る)
docker compose down -v     # 止めて、データも消す(まっさらに戻す)
```

```powershell [PowerShell]
docker compose down        # 止める(DB などのデータは残る)
docker compose down -v     # 止めて、データも消す(まっさらに戻す)
```

:::

演習を 1 つ終えるたびに、その演習の「片付け」でスイッチを戻してください。全部終わったら `docker compose down -v` でまっさらに戻せます。

## 本格版(kind)

### 起動・環境の切り替え・停止

::: code-group

```bash [Mac / Linux / WSL]
docker compose down        # 軽量版が動いていたら先に止める
k8s/up.sh                  # クラスタ作成 → イメージの用意 → 反映 → 全部 Ready まで待つ(初回 10〜15 分)
kubectl -n lab get pods    # READY がどれも整えば準備完了

# 環境を切り替える(d1 = 開発、s1 = ステージング、p1 = 本番。既定は p1)。LAB_SKIP_BUILD=1 でビルドを飛ばせます
LAB_ENV=d1 LAB_SKIP_BUILD=1 k8s/up.sh
LAB_ENV=p1 LAB_SKIP_BUILD=1 k8s/up.sh

k8s/down.sh                # クラスタごと消す(データも消える。次の up.sh でまっさらに作り直される)
```

```powershell [PowerShell]
docker compose down        # 軽量版が動いていたら先に止める
k8s/up.ps1                 # クラスタ作成 → イメージの用意 → 反映 → 全部 Ready まで待つ(初回 10〜15 分)
kubectl -n lab get pods    # READY がどれも整えば準備完了

# 環境を切り替える(d1 = 開発、s1 = ステージング、p1 = 本番。既定は p1)。-SkipBuild でビルドを飛ばせます
k8s/up.ps1 -Env d1 -SkipBuild
k8s/up.ps1 -Env p1 -SkipBuild

k8s/down.ps1               # クラスタごと消す(データも消える。次の up.ps1 でまっさらに作り直される)
```

:::

`k8s/up.sh`(`k8s/up.ps1`)は何度実行しても大丈夫です。開く場所(URL)は軽量版と同じです。
本格版だけの操作(Pod を見張る・ローリング更新・台数を増やす・トレースを見る など)は `k8s/README.md` にまとめています。

## 開く場所(どちらの版も同じ)

| 何か | URL | ひとこと |
| --- | --- | --- |
| お店(storefront) | http://www.lab.localhost:18080 | Angular の SSR。画面の中身は api の CMS の JSON で決まります |
| API(api) | http://api.lab.localhost:18080 | 例: http://api.lab.localhost:18080/occ/v2/samplestore/products/search?query=ノート |
| 管理画面(backoffice) | http://backoffice.lab.localhost:18080/backoffice/ | `admin` / `admin`。社内の IP からだけ(この PC は社内扱い) |
| Grafana | http://localhost:13000 | ダッシュボード。ログインなしで見られます(編集は admin / admin) |
| Prometheus | http://localhost:19090 | 指標。「Status → Target health」で集め先、「Alerts」でアラート |
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

PowerShell では、`tools/chaos.sh` を `tools/chaos.ps1`、`k8s/chaos.sh` を `k8s/chaos.ps1` に読み替えます(引数は同じ)。起動時の値は、環境変数を入れてから起動します。

::: code-group

```bash [Mac / Linux / WSL]
tools/chaos.sh status
CHAOS_LEAK_MB=20 docker compose up -d api    # 起動時の値を変える(この 1 回だけ)
docker compose up -d api                     # 戻す
```

```powershell [PowerShell]
tools/chaos.ps1 status
$env:CHAOS_LEAK_MB = '20'; docker compose up -d api     # 起動時の値を変える(環境変数はターミナルを閉じるまで残る)
Remove-Item Env:CHAOS_LEAK_MB; docker compose up -d api  # 戻す(環境変数を消してから起動し直す)
```

:::

違いのポイント:

- 本格版は、既定の環境 p1(と s1)では api が 2 つ(Pod が 2 つ)動いています(d1 は 1 つ)。`k8s/chaos.sh` は動いている api の Pod 全部に同じ指示を送ります。
- どちらの版も、対象が落ちて作り直されると、スイッチは「起動時の値」に戻ります。
  本格版で「何度も落ちる」様子(CrashLoopBackOff)を見るときは `boot` を使います。
- **演習が終わったら、その演習の「片付け」でスイッチを必ず戻してください。** 戻し忘れると、次の演習の数字がずれます。

## 困ったとき

Windows だけで起きること(お店が 502 で ingress のログに `40-ip-filter.sh: not found`・`curl` が Invoke-WebRequest のエラーを出す・スクリプトの実行が許可されていない・`docker: command not found`・Windows のポートの予約・改行コード `\r` のエラー・日本語が化ける・会社のプロキシ など)は、[Windows で使う: 困ったとき](/guide/windows#troubleshooting) にまとめています。

### ポートがもう使われている(`port is already allocated` / `address already in use`)

別のアプリか、もう片方の版が同じ番号を使っています。

::: code-group

```bash [Mac / Linux / WSL]
# ラボのコンテナが使っていないか
docker ps --format '{{.Names}}\t{{.Ports}}' | grep -E '18080|13000|1909[034]'
```

```powershell [PowerShell]
# ラボのコンテナが使っていないか
docker ps --format '{{.Names}}\t{{.Ports}}' | Select-String -Pattern '18080|13000|1909[034]'
# ラボ以外のアプリが使っていないか(OwningProcess がそのアプリのプロセス番号)
Get-NetTCPConnection -LocalPort 18080 -State Listen
```

:::

ラボ以外のアプリが使っていないかは、PC の種類で調べ方が違います(13000・19090・19093・19094 も同様)。

| PC | 打つ場所 | コマンド |
| --- | --- | --- |
| Mac | ターミナル | `lsof -iTCP:18080 -sTCP:LISTEN` |
| Linux | ターミナル | `ss -ltnp 'sport = :18080'` |
| Windows | PowerShell | `Get-NetTCPConnection -LocalPort 18080 -State Listen`(WSL2 を使っている人も、WSL の外の PowerShell で打ちます) |

Windows では、ほかのアプリが使っていなくても、**Windows が予約している番号**に当たって起動できないことがあります。確かめ方と直し方は [Windows で使う: ポートが使えない](/guide/windows#reserved-ports) にあります。

- 軽量版が動いたまま本格版を起動した → `docker compose down` してから `k8s/down.sh` → `k8s/up.sh`(PowerShell は `.ps1`)
- 本格版が動いたまま軽量版を起動した → `k8s/down.sh`(`k8s/down.ps1`)してから `docker compose up -d`
- 別のアプリ → そのアプリを止めるか、`docker-compose.yml`(または本格版は `k8s/kind-config.yaml`)の番号を変える

### メモリが足りない(動きが遅い・コンテナが勝手に落ちる・Pod が Pending のまま)

- Docker Desktop の Settings → Resources → Memory を **8GB** にしてください(Windows ではこの欄が無く、`.wslconfig` で決めます。[Windows で使う](/guide/windows#memory))。
- 要らないコンテナが動いていないか `docker stats --no-stream` で確かめ、止めます。
- 本格版で Pod が `Pending` のままなら `kubectl -n lab describe pod <名前>` の最後(Events)に `Insufficient memory` と出ていないか見ます。
- api だけが落ちるなら、スイッチ `leakMb` が入っていないか確かめます(`tools/chaos.sh status`)。

### `www.lab.localhost` が開けない

- Chrome・Edge・Firefox・curl(7.85 以降)は設定なしで開けます。macOS 26 より前の Safari など一部は、上の「`*.localhost` の名前について」の `/etc/hosts` の 1 行が要ります。Windows の PowerShell は `curl.exe --version` で 7.85 以上かを確かめ、hosts にも 1 行入れておくのが確実です([Windows で使う](/guide/windows))。
- `curl` で確かめるとき、`?` の入った URL は zsh(Mac の標準のシェル)では必ず `"..."` で囲みます(囲まないと `no matches found`)。PowerShell でも `&` の入った URL は必ず `"..."` で囲みます(囲まないと `&` が別の意味になります)。

### 管理画面(backoffice)がこの PC からも 403 になる

- `http://backoffice.lab.localhost:18080/backoffice/`(cdn-waf を通す住所)で開いていますか。
- IP フィルタを変える演習([ネットワーク-3](/exercises/20-nw-ingress-endpoints))のあとなら、`docker compose up -d ingress`(つまみを付けずに起動)で既定の許す範囲に戻ります。

### そのほか

| 症状 | 見るところ |
| --- | --- |
| 画面が 502・504 になる | storefront か api がまだ起動中です。軽量版は `docker compose ps`、本格版は `kubectl -n lab get pods` で待ちます |
| 変えたはずのバナー・価格が反映されない | cdn-waf のキャッシュ(30 秒)が効いています。30 秒待つか、`EDGE_CACHE=off docker compose up -d cdn-waf`(PowerShell は `$env:EDGE_CACHE='off'; docker compose up -d cdn-waf`)([ネットワーク-1](/exercises/07-nw-cache)) |
| Grafana のグラフが空 | 数字は 5 秒ごとに集め、5 分の平均で計算します。サイトを何回か開いて 1〜2 分待ちます |
| CSP で `Refused to execute inline script ... 'sha256-...'` が出る | Angular の更新で埋め込みスクリプトの指紋が変わりました。README の「CSP の指紋」で足します |
| 本格版で古いイメージのまま | `k8s/up.sh`(`k8s/up.ps1`)をもう一度実行するとイメージを作り直してノードに読み込みます(`kind load`)。ただし名前が同じ `lab/api:local`・`lab/web:local` のままなので、動いている Pod は入れ替わりません。続けて `kubectl -n lab rollout restart deploy/api deploy/backoffice deploy/worker deploy/storefront` で作り直します |
| 本格版で kubectl が別のクラスタを見ている | `kubectl config use-context kind-lab` |
