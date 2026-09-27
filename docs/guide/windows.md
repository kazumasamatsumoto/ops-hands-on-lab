# Windows で使う(WSL2)

このラボは、Mac と Linux のターミナル(bash)で打つコマンドで書いています。
Windows では **WSL2(ダブリューエスエル ツー)** の上の **Ubuntu** の中で、ほかのページと **まったく同じコマンド** を打ちます。

- **WSL2** は、Windows の中で本物の Linux を動かす Windows の機能です。「Windows の中に、Linux の PC がもう 1 台入っている」と考えてください。
- **Ubuntu** は、その中で動かす Linux の種類(ディストリビューション)です。このページでは Ubuntu 24.04 を使います。
- **Docker Desktop** は、WSL2 の Ubuntu から使えるように「つなぐ」設定をします(WSL インテグレーション)。

PowerShell(Windows のコマンド画面)を使うのは、**WSL の外でしかできない少しの作業だけ** です(WSL を入れる・メモリを決める・Windows が予約しているポートを調べる・ブラウザを開く)。
それ以外はすべて Ubuntu のターミナルで、ほかのページに書いてある bash のコマンドをそのまま打ちます。

::: warning 動作確認の範囲
この手順は **macOS(実機)** と **Ubuntu 24.04(Linux)** で確かめました。**Windows の実機では、手順の全体はまだ確かめていません**(実機で見つかった改行コードの問題は直しました。[困ったとき](#ingress-crlf))。
PowerShell・WSL・Docker Desktop の画面の手順は、Microsoft と Docker の公開文書に沿って書いています。
うまくいかなかったときは、ページの最後の「[不具合を知らせる](#report)」から教えてください。
:::

## 全体の流れ

| 順番 | やること | 打つ場所 | かかる時間の目安 |
| --- | --- | --- | --- |
| 1 | [用意するものを確かめる](#requirements) | Windows の画面 | 5 分 |
| 2 | [WSL2 と Ubuntu を入れる](#install-wsl) | PowerShell(管理者) | 10〜20 分(再起動あり) |
| 3 | [Docker Desktop を入れて Ubuntu とつなぐ](#docker-desktop) | Windows の画面 → Ubuntu | 10 分 |
| 4 | [メモリの上限を決める](#memory) | PowerShell | 5 分 |
| 5 | [Ubuntu に道具を入れる](#tools) | Ubuntu | 5〜10 分 |
| 6 | [改行コードを設定して、ラボを取ってくる](#clone) | Ubuntu | 5 分 |
| 7 | [軽量版を起動する](#start-light) | Ubuntu | 初回 数分 |
| 8 | [Windows のブラウザで開く](#browser) | Windows のブラウザ | すぐ |
| 9 | [演習ページ(このサイト)を手元で開く](#docs-site)(任意) | Ubuntu | 数分 |
| 10 | [本格版(kind)を使う](#full)(必要になったら) | Ubuntu | 初回 10〜15 分 |

## 1. 用意するもの {#requirements}

| もの | 目安 | 確かめ方 |
| --- | --- | --- |
| Windows | **Windows 11**(23H2 以降がおすすめ)、または **Windows 10 の 22H2** | Windows キー + R →「`winver`」と打って Enter。出てきた画面にバージョンが書いてあります。Windows 10 は Microsoft のサポートが 2025 年 10 月に終わっているので、Docker Desktop の最新版が対応しているかを Docker 社のサイトで確かめてください |
| 仮想化(CPU の機能) | **有効** になっていること | タスク マネージャー(Ctrl + Shift + Esc)→「パフォーマンス」→「CPU」→ 右下の「仮想化: 有効」 |
| 管理者の権限 | WSL と Docker Desktop を入れるときに要ります | 会社の PC で権限が無いときは、情報システム部門に「WSL2 と Docker Desktop を使いたい」と相談してください |
| メモリ(PC 全体) | **16GB 以上をおすすめ**(8GB だと軽量版だけでもきついです) | タスク マネージャー →「パフォーマンス」→「メモリ」 |
| ディスクの空き | 20GB ほど(Ubuntu・Docker のイメージ・ラボ) | エクスプローラーで C ドライブを右クリック →「プロパティ」 |

::: tip 仮想化が「無効」のとき
PC の電源を入れた直後の設定画面(BIOS / UEFI)で、「Intel Virtualization Technology(VT-x)」や「SVM Mode(AMD)」を有効にします。
入り方や名前は PC のメーカーごとに違います。会社の PC なら、自分で変えずに情報システム部門に相談してください。
:::

::: warning Docker Desktop の利用条件(会社で使う人へ)
Docker Desktop は、**従業員 250 人以上、または年間の売上高が 1,000 万米ドルを超える会社** で仕事に使うときは、有料の契約(Pro・Team・Business)が要ります。
個人の学習や、小さな会社の利用は無料です。会社の PC で使う前に、会社に契約があるかを確かめてください(条件は Docker 社のサイトで最新のものを確かめてください)。
:::

## 2. WSL2 と Ubuntu を入れる {#install-wsl}

1. スタートメニューで「PowerShell」と打ち、「**管理者として実行**」を選びます。
2. 次の 1 行を打ちます(ここは PowerShell です)。

   ```powershell
   wsl --install -d Ubuntu-24.04
   ```

3. 「再起動してください」と出たら、PC を再起動します。
4. 再起動のあと、Ubuntu の黒い画面が自動で開きます(開かなければスタートメニューから「Ubuntu 24.04」を開きます)。
   **Ubuntu の中で使うユーザー名とパスワード** を聞かれるので決めます。

   - ユーザー名は半角の英小文字がおすすめです(例: `taro`)。Windows のユーザー名と同じでなくてかまいません。
   - パスワードは、打っても画面に何も出ません(故障ではありません)。あとで `sudo`(管理者として実行)のときに使うので、忘れないでください。

5. PowerShell に戻って、WSL の版が **2** になっていることを確かめます。

   ```powershell
   wsl -l -v
   ```

   ```
     NAME            STATE           VERSION
   * Ubuntu-24.04    Running         2
   ```

   `VERSION` が `1` なら、`wsl --set-version Ubuntu-24.04 2` で 2 にします。
   `wsl` のコマンドが古いと言われたら、`wsl --update` で新しくします。

::: tip Ubuntu のターミナルの開き方
以後「Ubuntu で打つ」と書いたら、スタートメニューの「Ubuntu 24.04」か、Windows ターミナルのタブの「Ubuntu 24.04」を開いて打ちます。
画面の左に `taro@PC名:~$` のように出ていれば Ubuntu の中です(`PS C:\>` と出ていたら PowerShell です)。
:::

## 3. Docker Desktop を入れて Ubuntu とつなぐ {#docker-desktop}

1. Docker 社のサイト(docs.docker.com の「Install Docker Desktop on Windows」)から、Docker Desktop のインストーラーを取ってきて実行します。
   途中の「**Use WSL 2 instead of Hyper-V**」には、チェックを入れたままにします。
2. Docker Desktop を起動し、左下が「**Engine running**」(緑)になるまで待ちます。
3. 右上の歯車(Settings)を開いて、次の 2 か所を確かめます。

   | 場所 | 設定 |
   | --- | --- |
   | General | 「**Use the WSL 2 based engine**」に **チェックが入っている** |
   | Resources → **WSL integration** | 「Enable integration with my default WSL distro」に **チェック**、その下の一覧の **Ubuntu-24.04 を ON** |

   最後に「**Apply & restart**」を押します。
4. **Ubuntu のターミナルを一度閉じて、開き直します**(つないだ設定は、開き直したターミナルから効きます)。
5. Ubuntu で、Docker が使えるかを確かめます。

   ```bash
   docker version            # Client と Server の両方が出ればよい
   docker compose version    # v2.20 以上ならよい
   docker run --rm hello-world
   ```

   `Hello from Docker!` と出れば、Ubuntu から Docker Desktop を使えています。

::: warning Ubuntu の中に、別の Docker を入れないでください
ネットの記事には「Ubuntu に `sudo apt install docker.io` で Docker を入れる」方法も載っていますが、このページでは **使いません**。
Docker Desktop と両方あると、どちらに命令が届いているのか分からなくなります。Docker は Docker Desktop の 1 つだけにします。
:::

## 4. メモリの上限を決める(.wslconfig) {#memory}

Mac の Docker Desktop には「Settings → Resources → Memory」の欄がありますが、**WSL2 で動かす Docker Desktop にはこの欄がありません**。
WSL2 のときの Docker は、WSL2(Windows の中の Linux)に割り当てられたメモリを使います。そのため、**WSL2 のメモリの上限** を決めます。

決める場所は、Windows の自分のフォルダの `.wslconfig` というファイルです(`%UserProfile%\.wslconfig`。例: `C:\Users\taro\.wslconfig`)。

1. PowerShell(管理者でなくてよい)でメモ帳を開きます。ファイルが無ければ「作りますか」と聞かれるので「はい」を選びます。

   ```powershell
   notepad "$env:USERPROFILE\.wslconfig"
   ```

2. 次の 2 行を書いて保存します(PC のメモリが 16GB なら 8GB。32GB 以上なら 12GB でもかまいません)。

   ```ini
   [wsl2]
   memory=8GB
   ```

3. WSL を一度止めて、設定を読み直させます。止めると Docker Desktop も止まるので、そのあと Docker Desktop を起動し直します。

   ```powershell
   wsl --shutdown
   ```

4. Ubuntu を開き直して、確かめます。

   ```bash
   free -h      # Mem: の total が 7.7Gi くらい(8GB と書いたとき)ならよい
   ```

::: tip メモ帳で保存するときの注意
メモ帳は、名前の最後に勝手に `.txt` を付けることがあります(`.wslconfig.txt` になると読まれません)。
上の `notepad "$env:USERPROFILE\.wslconfig"` の開き方なら `.txt` は付きません。エクスプローラーで確かめるときは「表示 → ファイル名拡張子」にチェックを入れます。
:::

## 5. Ubuntu に道具を入れる {#tools}

ここからは **Ubuntu で打ちます**。

```bash
sudo apt update
sudo apt install -y git curl jq python3 openssl ca-certificates
curl --version | head -1     # 7.85 以上ならよい(Ubuntu 24.04 は 8.5)
```

`curl` の版を確かめるのは、7.85 より古いと `www.lab.localhost` のような名前を自分の PC(127.0.0.1)として扱わず、演習の `%header{...}` という書き方も使えないためです。

### Node.js(版 24)

Node.js は、`tools/manifest/render.mjs`(manifest から Kubernetes の定義を作る道具)と、この演習サイトを手元で開くときに使います。
**nvm**(Node.js の版を切り替える道具)で入れます。

```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash
source ~/.bashrc
nvm install 24
node --version     # v24. で始まればよい
```

## 6. 改行コードを設定して、ラボを取ってくる {#clone}

```bash
git config --global core.autocrlf input    # 取ってきたファイルの改行を変えない(Windows 流の CRLF にしない)
cd ~
git clone https://github.com/kazumasamatsumoto/ops-hands-on-lab.git
cd ~/ops-hands-on-lab
grep -c $'\r' tools/chaos.sh               # 0 ならよい(CRLF が混ざっていない)
```

### なぜ `~`(Ubuntu の自分のフォルダ)に置くのか

Ubuntu からは、Windows の C ドライブも `/mnt/c` として見えます。しかし、**ラボは `/mnt/c` の下(例: `/mnt/c/Users/taro/...`)に置かないでください。**

| 置き場所 | 速さ | ファイルの変更に気付くか | 改行コード・実行の権限 |
| --- | --- | --- | --- |
| `~/ops-hands-on-lab`(Ubuntu の中) | 速い | 気付く(演習サイトの自動更新が効く) | 崩れない |
| `/mnt/c/...`(Windows の C ドライブ) | とても遅い(ビルドが何倍もかかる。ウイルス対策の検査も毎回走る) | 気付かないことがある | 崩れることがある |

`/mnt/c` は「Windows と Linux の間の通訳を毎回通る道」なので遅い、と考えてください。

::: tip Windows のアプリでファイルを見たいとき
Ubuntu で `explorer.exe .` と打つと、今のフォルダがエクスプローラーで開きます(住所は `\\wsl.localhost\Ubuntu-24.04\home\taro\ops-hands-on-lab` のようになります)。
ファイルを直すなら、VS Code に拡張機能「WSL」を入れて、Ubuntu で `code .` と打つのがおすすめです。右下の表示が「LF」になっていれば、改行コードは正しいままです。
:::

::: info このリポジトリの改行コードの設定
リポジトリの一番上の `.gitattributes` で、シェルスクリプト・nginx の設定・YAML などを **LF で取り出す** ように決めています。
そのため、Windows の git(`core.autocrlf=true`)で取ってきても、通常は壊れません。それでも Ubuntu の中で取ってくるのが一番確実です。
:::

## 7. 軽量版を起動する {#start-light}

[準備と起動](/guide/setup) と同じコマンドです(Ubuntu で、`~/ops-hands-on-lab` の中で打ちます)。

```bash
cd ~/ops-hands-on-lab
docker compose up -d --build
docker compose ps      # STATUS が healthy になれば準備完了(初回は数分)
curl -s -o /dev/null -w '%{http_code}\n' http://www.lab.localhost:18080/    # 200 ならよい
```

止めるときも同じです(`docker compose down`)。演習ページに出てくる `tools/chaos.sh` などのスクリプトも、そのまま Ubuntu で打てます。

## 8. Windows のブラウザで開く {#browser}

ブラウザは **Windows の Edge か Chrome** を使います(Ubuntu の中にブラウザを入れる必要はありません)。

| 何か | URL |
| --- | --- |
| お店(storefront) | http://www.lab.localhost:18080 |
| API | http://api.lab.localhost:18080/occ/v2/samplestore/products/search?query=ノート |
| 管理画面(backoffice) | http://backoffice.lab.localhost:18080/backoffice/ |
| Grafana | http://localhost:13000 |
| Prometheus・Alertmanager・pager | http://localhost:19090 ・ http://localhost:19093 ・ http://localhost:19094 |

- Docker Desktop が、コンテナのポートを **Windows の localhost(127.0.0.1)にもつないでくれる** ので、Windows のブラウザでそのまま開けます。
- `www.lab.localhost` のように `.localhost` で終わる名前は、**Edge と Chrome が自分で 127.0.0.1 に直します**。hosts ファイルを直す必要はありません。
- PowerShell から開くなら `Start-Process "http://www.lab.localhost:18080"` です。
- 開発者ツールは **F12**(Mac の option+command+I の代わり)です。

## 9. 演習ページ(このサイト)を手元で開く(任意) {#docs-site}

このサイトはネットで公開しているので、ふつうはそちらを見れば十分です。手元のファイルを直して確かめたいときだけ、次のようにします。

```bash
cd ~/ops-hands-on-lab/docs
npm ci
npm run dev        # 止めるのは Ctrl+C
```

Windows のブラウザで http://localhost:15178 を開きます(自動でブラウザが開かないことがありますが、そのときは手で開けば大丈夫です)。

## 10. 本格版(kind)を使う {#full}

本格版は、演習ページに「本格版では」と書いてあるときだけ使います。**軽量版と同時には動かせません**(メモリが足りなくなり、ポートもぶつかります)。

### kind と kubectl を入れる(最初の 1 回だけ)

版は、ラボで確かめた物に固定します(kind v0.30.0 = Kubernetes v1.34.0、kubectl v1.34.1。[k8s/README.md](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/k8s/README.md) と同じ)。

```bash
ARCH=$(dpkg --print-architecture)   # ふつうの Windows PC は amd64(ARM の PC なら arm64)
curl -fsSLo kind "https://kind.sigs.k8s.io/dl/v0.30.0/kind-linux-${ARCH}"
curl -fsSLo kubectl "https://dl.k8s.io/release/v1.34.1/bin/linux/${ARCH}/kubectl"
sudo install -m 0755 kind kubectl /usr/local/bin/ && rm kind kubectl
kind version            # kind v0.30.0 ...
kubectl version --client
```

Docker Desktop にも kubectl が付いてきますが、Ubuntu の中では上で入れた物を使います(`which kubectl` で `/usr/local/bin/kubectl` と出ればよい)。

### 起動と停止

```bash
cd ~/ops-hands-on-lab
docker compose down        # 軽量版が動いていたら先に止める
k8s/up.sh                  # 初回 10〜15 分
kubectl -n lab get pods    # READY がどれも整えば準備完了
k8s/down.sh                # 止める(クラスタごと消す)
```

開く URL は軽量版と同じで、Windows のブラウザで開きます。`.wslconfig` の `memory` は **8GB 以上** にしてください。

## Mac と Windows(WSL)で違うところ {#differences}

| こと | Mac | Windows(WSL2) |
| --- | --- | --- |
| コマンドを打つ場所 | ターミナル(zsh) | Ubuntu のターミナル(bash)。PowerShell は下の早見表の作業だけ |
| ラボを置く場所 | どこでもよい | **`~/ops-hands-on-lab`**(Ubuntu の中)。`/mnt/c` は避ける |
| Docker のメモリ | Docker Desktop の Settings → Resources → Memory | `%UserProfile%\.wslconfig` の `memory=`(→ `wsl --shutdown`) |
| kind・kubectl の入れ方 | `brew install kind kubectl` | [上の curl の手順](#full) |
| Node.js の入れ方 | `brew` など | [nvm](#tools) |
| ポートを使っているアプリを調べる | `lsof -iTCP:18080 -sTCP:LISTEN` | PowerShell で `Get-NetTCPConnection -LocalPort 18080 -State Listen`。**Windows の予約範囲** も確かめる([下](#reserved-ports)) |
| hosts ファイル(ふつうは不要) | `/etc/hosts` | `C:\Windows\System32\drivers\etc\hosts`(メモ帳を管理者として開く) |
| ファイルを画面で見る | Finder | Ubuntu で `explorer.exe .` |
| ブラウザの開発者ツール | option+command+I | F12 |
| `?` の入った URL を `"..."` で囲む | 必ず(囲まないと zsh が `no matches found`) | 囲まなくても動くが、ページどおり囲めばよい |
| `time` の結果の見方 | 最後の `total` | `real` の行 |
| 改行コード | 気にしなくてよい | LF のまま使う(`.gitattributes` で固定済み。前に取ってきた物は [取り出し直す](#ingress-crlf)) |

## PowerShell 早見表(WSL の外で打つのはこれだけ) {#powershell}

| やりたいこと | コマンド | 管理者 |
| --- | --- | --- |
| WSL2 と Ubuntu 24.04 を入れる | `wsl --install -d Ubuntu-24.04` | 要る |
| 入っている Linux と版(1 か 2)を見る | `wsl -l -v` | 不要 |
| WSL を新しくする | `wsl --update` | 確認を聞かれたら許可 |
| WSL を止める(`.wslconfig` を読み直させる・メモリを返す) | `wsl --shutdown` | 不要 |
| メモリの上限のファイルを開く | `notepad "$env:USERPROFILE\.wslconfig"` | 不要 |
| Windows が予約しているポートの範囲を見る | `netsh interface ipv4 show excludedportrange protocol=tcp` | 不要 |
| 18080 番を使っているアプリを見る | `Get-NetTCPConnection -LocalPort 18080 -State Listen` | 不要 |
| 予約の範囲を作り直させる | `net stop winnat` → `net start winnat` | 要る |
| ブラウザでお店を開く | `Start-Process "http://www.lab.localhost:18080"` | 不要 |
| hosts ファイルを開く(ふつうは不要) | `notepad C:\Windows\System32\drivers\etc\hosts` | 要る |

## 困ったとき {#troubleshooting}

### お店が 502 になり、ingress のログに `40-ip-filter.sh: not found` と出る {#ingress-crlf}

**Windows の実機で実際に起きた症状です。** http://www.lab.localhost:18080 を開くと 502 になり、ingress のログに次のように出ます。

```bash
docker compose logs ingress | grep -i 'not found'
# → /docker-entrypoint.sh: ... 40-ip-filter.sh: not found
```

原因は **改行コード** です。Windows の git は既定(`core.autocrlf=true`)で、取ってきたファイルの改行を Windows 流の **CRLF** に変えることがあります。
ingress の起動時に動く小さなスクリプト(`ingress/40-ip-filter.sh`)の 1 行目が `#!/bin/sh` + 見えない `\r` になり、「`/bin/sh\r` という物は無い」= `not found` で止まっていました。
ingress が起動しないので、その手前の cdn-waf が行き先を失って 502 を返します。

今のリポジトリでは、2 つの手当てをしています。

- `.gitattributes` で、スクリプトや設定ファイルを **LF で取り出す** ように決めた(新しく取ってくる人は、この問題が起きません)。
- 軽量版の ingress は、起動のたびに `40-ip-filter.sh` から `\r` を取り除いてから動かす(`docker-compose.yml` の `ingress:` の `entrypoint`)。

**前に取ってきたリポジトリ(すでに CRLF になっている物)は、`git pull` だけでは直りません。** 手元のファイルは CRLF のまま残るからです。取ってきたフォルダの中で、次のようにします(WSL の Ubuntu でも、Windows 側の git でも同じコマンドです)。

```bash
git pull
git status --short                       # 自分で直したファイルがあれば、先に別の場所へ写しておく(次の行で消えます)
git rm --cached -r -q . && git reset --hard   # 全部のファイルを、.gitattributes の決まり(LF)で取り出し直す
grep -c $'\r' tools/chaos.sh             # 0 ならよい
docker compose up -d --force-recreate    # 直したファイルで、全部のコンテナを作り直す
docker compose ps                        # ingress も (healthy) になればよい
```

同じ理由で、WSL の Ubuntu で動かすほかのスクリプト(`tools/*.sh`・`k8s/*.sh`)も、CRLF のままだと `/usr/bin/env: 'bash\r': No such file or directory` で動きません(次の項目)。上の取り出し直しで、これもまとめて直ります。

### ポートが使えない(Windows の予約範囲) {#reserved-ports}

`docker compose up` で次のように出て、起動できないことがあります。

```
Error response from daemon: Ports are not available: exposing port TCP 127.0.0.1:18080 -> 0.0.0.0:0:
listen tcp 127.0.0.1:18080: bind: An attempt was made to access a socket in a way forbidden by its access permissions.
```

Windows は、Hyper-V や WSL のために **ポートの番号をまとめて予約** することがあります。予約された番号は、どのアプリも使えません。PowerShell で確かめます。

```powershell
netsh interface ipv4 show excludedportrange protocol=tcp
```

出方の例です(英語の Windows では `Start Port` `End Port`)。

```
開始ポート    終了ポート
----------    --------
     13000       13099
     50000       50059     *
```

ラボが使う **18080・13000・19090・19093・19094** のどれかが、どれかの行の「開始〜終了」の間に入っていたら、それが原因です(上の例では 13000 が入っています)。

1. **まず試すこと**: 管理者の PowerShell で予約を作り直させます。そのあと Ubuntu で `docker compose up -d` をやり直します。

   ```powershell
   net stop winnat
   net start winnat
   ```

   `net stop winnat` の間は、WSL と Docker のネットワークが一時的に止まります。Docker Desktop が動いていて止められないと言われたら、Docker Desktop を終了してから打ち、打ち終わったら起動し直します。
2. **何度やっても同じ番号が予約されるとき**: Windows が自由に使う番号の範囲(動的ポートの範囲)が、低い番号から始まる設定になっていることがあります。管理者の PowerShell で今の範囲を見ます。

   ```powershell
   netsh int ipv4 show dynamicport tcp
   ```

   「開始ポート」が 49152 より小さい(例: 1024)なら、Windows の既定の範囲(49152 から 16384 個)に戻して、再起動します。**会社の PC では、変える前に情報システム部門に確かめてください**(ほかのソフトがこの設定を前提にしていることがあります)。

   ```powershell
   netsh int ipv4 set dynamicport tcp start=49152 num=16384
   ```

3. **観測の道具(13000・19090・19093・19094)だけが当たるとき**: [observability/compose.yml](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/observability/compose.yml) の `ports:` の左側の番号(例: `"13000:3000"` の `13000`)を空いている番号に変えてもかまいません。開く URL もその番号に変わります。
   **18080 は変えないでください**(CORS の許可先・CSP・画面が使う API の住所など、あちこちに 18080 が書いてあり、変えると演習が動きません)。18080 が当たるときは、1 か 2 で直します。

予約ではなく、ほかのアプリが使っているだけのときは、`Get-NetTCPConnection -LocalPort 18080 -State Listen` の `OwningProcess`(プロセスの番号)を、タスク マネージャーの「詳細」タブの「PID」と見比べて、そのアプリを止めます。

### `docker: command not found` / `The command 'docker' could not be found in this WSL 2 distro`

Ubuntu と Docker Desktop がつながっていません。

1. Docker Desktop が起動していて、左下が「Engine running」か確かめます。
2. Settings → Resources → **WSL integration** で **Ubuntu-24.04 が ON** か確かめ、「Apply & restart」を押します。
3. **Ubuntu のターミナルを閉じて開き直します。**

`permission denied while trying to connect to the Docker daemon socket` と出るときも、多くは Docker Desktop がまだ起動しきっていないか、つなぐ設定が OFF です。上の 1〜3 を確かめます。

### WSL2 が動かない(仮想化・Windows の機能)

`wsl --install` のあとで次のように出るときは、仮想化か、Windows の機能が有効になっていません。

```
WslRegisterDistribution failed with error: 0x80370102
```

- [1. 用意するもの](#requirements) の「仮想化: 有効」を確かめます。
- 管理者の PowerShell で、WSL に要る 2 つの Windows の機能を有効にし、再起動します。

  ```powershell
  dism.exe /online /enable-feature /featurename:Microsoft-Windows-Subsystem-Linux /all /norestart
  dism.exe /online /enable-feature /featurename:VirtualMachinePlatform /all /norestart
  ```

- 会社の PC では、決まり(ポリシー)で止められていることがあります。そのときは情報システム部門に相談してください。

### `/usr/bin/env: 'bash\r': No such file or directory` / `/bin/bash^M: bad interpreter` {#crlf}

スクリプトの改行コードが、Windows 流の **CRLF** になっています(`\r` や `^M` が、行の最後に付いた余計な文字です)。
Windows 側の git で取ってきた、`/mnt/c` の下に置いた、CRLF で保存するエディタで直した、のどれかで起きます。

すでに取ってきたリポジトリなら、まず [上の項目](#ingress-crlf) の「`git rm --cached -r -q . && git reset --hard`」で取り出し直します。
それでも直らないとき、または `/mnt/c` の下に置いているときは、**Ubuntu の中で取り直す** のが一番確実です(nginx の設定や YAML も同じように壊れている可能性があるためです)。

```bash
git config --global core.autocrlf input
cd ~
mv ops-hands-on-lab ops-hands-on-lab.old     # 自分で直した物があれば、あとでここから写す
git clone https://github.com/kazumasamatsumoto/ops-hands-on-lab.git
```

急ぎでスクリプトだけ直すなら、Ubuntu で次のようにします(この `sed -i` の書き方は Ubuntu 用です)。

```bash
sed -i 's/\r$//' tools/*.sh k8s/*.sh ingress/*.sh
```

`Permission denied` と出てスクリプトが動かないときは、実行の権限が外れています。`chmod +x tools/*.sh k8s/*.sh` で付け直すか、`bash tools/chaos.sh status` のように `bash` を前に付けて動かします。

### とても遅い(`/mnt/c` とウイルス対策)

- `pwd` と打って、`/mnt/c/...` と出たら、ラボが Windows 側に置かれています。[6.](#clone) のとおり `~` に取り直してください。ビルドや起動の速さが大きく変わります。
- Windows のウイルス対策(Microsoft Defender など)は、Windows 側のファイルを開くたびに検査します。`~` に置けば、この検査の影響をほとんど受けません。
- 会社の PC で、ウイルス対策の検査の対象から外す設定(除外)を自分で足すことはしないでください。必要なら情報システム部門に相談してください。

### 会社のネットワーク(プロキシ・VPN)でイメージや部品を取ってこられない

`docker compose up --build` や `npm ci` が、次のようなエラーで止まることがあります。

```
TLS handshake timeout
x509: certificate signed by unknown authority
```

- **Docker Desktop のプロキシ**: Settings → Resources → **Proxies** →「Manual proxy configuration」をオンにして、会社のプロキシの住所(例: `http://proxy.example.co.jp:8080`)を HTTP と HTTPS の欄に書きます。「Bypass proxy settings for these hosts」には `localhost,127.0.0.1,.localhost` を書きます。
- **Ubuntu の中のプロキシ**(git・curl・npm 用): `~/.bashrc` の最後に書いて、Ubuntu を開き直します。**`NO_PROXY` に `.localhost` を必ず入れます**(入れないと、`curl http://www.lab.localhost:18080` まで会社のプロキシに送られて、ラボに届きません)。

  ```bash
  export HTTP_PROXY=http://proxy.example.co.jp:8080
  export HTTPS_PROXY=http://proxy.example.co.jp:8080
  export NO_PROXY=localhost,127.0.0.1,.localhost
  export http_proxy=$HTTP_PROXY https_proxy=$HTTPS_PROXY no_proxy=$NO_PROXY
  ```

- **会社の証明書**(`x509: certificate signed by unknown authority`): 会社のネットワークが通信の中身を検査していると、会社の証明書を入れないとつながりません。Ubuntu に入れるには、情報システム部門からもらった証明書のファイル(拡張子を `.crt` にする)で次のようにします。Docker Desktop 側の扱いは、情報システム部門の案内に従ってください。

  ```bash
  sudo cp 会社の証明書.crt /usr/local/share/ca-certificates/
  sudo update-ca-certificates
  ```

- **VPN**: VPN につないだときだけ、Ubuntu から外に出られない(名前が引けない)ことがあります。VPN を切って動くなら VPN が原因です。まず `wsl --update` で WSL を新しくし、それでも駄目なら情報システム部門に相談してください。
- プロキシの住所や証明書は会社ごとに違います。分からないときは、自分で探さずに情報システム部門に聞いてください。

### メモリが足りない(遅い・コンテナが勝手に落ちる・Pod が Pending のまま)

- **軽量版と本格版を同時に動かさない** でください。片方を止めてから(`docker compose down` または `k8s/down.sh`)もう片方を起動します。
- `.wslconfig` の `memory=` が 8GB になっているかを、Ubuntu の `free -h` で確かめます([4.](#memory))。
- どのコンテナがメモリを使っているかは `docker stats --no-stream` で見ます。
- Windows のタスク マネージャーでは、WSL2 が使っているメモリは「**VmmemWSL**」(古い Windows では「Vmmem」)という名前で見えます。
- 演習が終わったら、`docker compose down` のあとで、PowerShell の `wsl --shutdown` を打つと、WSL2 が使っていたメモリが Windows に返ります。

### `www.lab.localhost` が開けない

- **Edge か Chrome** で開いていますか。どちらも `.localhost` を自分で 127.0.0.1 に直します。
- 会社の PC で、ブラウザが **プロキシ** を使う設定になっていると、`www.lab.localhost` までプロキシに送られて開けないことがあります。Windows の「設定 → ネットワークとインターネット → プロキシ」の「次のエントリで始まるアドレス以外にプロキシ サーバーを使います」に `*.localhost` を足します(会社で決まっている設定なら、情報システム部門に相談してください)。
- それでも開けないときの最後の手段は、hosts ファイルに 1 行足すことです。スタートメニューで「メモ帳」を右クリック →「管理者として実行」→ `C:\Windows\System32\drivers\etc\hosts` を開き、最後に次の 1 行を足して保存します。

  ```
  127.0.0.1 www.lab.localhost api.lab.localhost backoffice.lab.localhost
  ```

- `http://localhost:13000`(Grafana)なども開けないときは、Ubuntu で `docker compose ps` を見て、コンテナが動いているか・ポートが出ているかを確かめます。動いているのに開けないなら、[ポートの予約](#reserved-ports) も確かめます。
- Ubuntu の中の `curl` では開けるのに、Windows のブラウザでは開けないときは、Docker Desktop を再起動してみてください(ポートを Windows につなぐのは Docker Desktop の仕事です)。

### 管理画面(backoffice)が 403 になる

「この PC は社内扱い」かどうかは、ingress が見た「どこから来たか(IP アドレス)」で決まります。Windows でも Mac と同じ仕組みで動く想定ですが、Windows の実機では確かめていません。
403 になったら、Ubuntu で次を打って、`remote_addr` に出た IP を [不具合を知らせる](#report) で教えてください。

```bash
curl -s -o /dev/null http://backoffice.lab.localhost:18080/backoffice/login
docker compose logs --tail=1 ingress
docker compose exec -T ingress cat /etc/nginx/ip-filters/backoffice.conf     # 許している範囲
```

## 動作確認の範囲と、不具合を知らせる {#report}

この手順とラボのスクリプトは、次の範囲で確かめています。

| 環境 | 確かめたこと |
| --- | --- |
| macOS(実機) | 全部の手順(軽量版・本格版・演習) |
| Ubuntu 24.04(Linux。bash 5.2・GNU の道具・curl 8.5) | 全部のスクリプトの文法(`bash -n`・ShellCheck)、manifest の食い違いチェック、演習ページにある「状態を変えないコマンド」約 60 個を、動いているラボに向けて実行(curl・grep・sed・python3・docker compose logs / exec / ps など) |
| **Windows の実機** | **手順の全体はまだ確かめていません**(WSL2・Docker Desktop・PowerShell の手順は、Microsoft と Docker の公開文書に沿って書いています)。利用者の実機で「お店が 502・`40-ip-filter.sh: not found`」(改行コード)が見つかり、直しました。前に取ってきたリポジトリの取り出し直しの手順は、Linux で CRLF の状態をまねて確かめました |

うまくいかなかったとき・書いてあるとおりにならなかったときは、GitHub の Issues(https://github.com/kazumasamatsumoto/ops-hands-on-lab/issues)で教えてください。次の 4 つがあると、原因を早く見つけられます。

1. Windows の版(`winver` の画面に出る物)
2. PowerShell の `wsl --version` の結果
3. Ubuntu の `docker version` の結果
4. 打ったコマンドと、出たエラーの全文(画面の写真ではなく、文字を貼ってもらえると助かります)
