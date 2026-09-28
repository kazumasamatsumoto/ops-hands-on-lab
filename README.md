# サンプルストア 体験ラボ

性能・セキュリティ・SRE・インフラの「設計書に書いてあること」を、**実物を自分の手で動かし、壊し、測って**から理解するための練習場です。
題材は架空のネットストア「サンプルストア」(サンプル株式会社)です。

- 方式設計書・詳細設計書を読んでも「なぜこの文書が要るのか」「何をしているのか」がピンと来ない人向けです。
- 構成は、SAP Commerce Cloud(CCv2)でヘッドレスのお店(画面と API を分けた作り)を動かすときの形に寄せています。ラボで覚えたことが、実案件の構成図や API の URL にそのまま重なります。
- すべて自分の PC の中(Docker)で動きます。外部のサービスには何も送りません。

> この README は「軽量版(docker compose だけで動く版)」の説明です。Kubernetes で動かす本格版は `k8s/` にあります。

## 用意するもの

| もの | 目安 |
| --- | --- |
| Docker Desktop(Mac / Windows)または Docker Engine + Compose v2(Linux) | Compose は `include:` が使える v2.20 以上 |
| Docker に割り当てるメモリ | **8GB**(ラボ全体の上限はおよそ 2.5GB。残りは余裕です)。Windows では `.wslconfig` で決めます |
| ディスクの空き | 5GB ほど(イメージのダウンロード分) |
| 空いているポート | 18080・13000・19090・19093・19094 |

**Windows の人へ**: 2 つのやり方があります。どちらも準備の手順(入れる物・メモリの設定・リポジトリを置く場所・困ったとき)は [docs/guide/windows.md](docs/guide/windows.md)(演習サイトの「Windows で使う」)にあります。

- **WSL2 の Ubuntu(おすすめ)**: Docker Desktop と WSL2 の Ubuntu を使い、この README と同じ bash のコマンドを Ubuntu の中で打ちます。
- **PowerShell 7 + Docker Desktop**: Ubuntu を入れずに、下の「PowerShell」の囲みのコマンドを PowerShell 7 で打ちます。`tools/chaos.sh` などのスクリプトは、同じ名前の `tools/chaos.ps1`(引数は同じ)を使います。`curl` は必ず `curl.exe` と書きます。

## 起動と停止

**Mac / Linux / WSL**

```bash
# 起動(初回はイメージの取得とビルドで数分かかります)
docker compose up -d --build

# 状態を見る(STATUS が healthy になれば準備完了)
docker compose ps

# 停止(データは残る)
docker compose down

# 停止して、データ(DB・指標・ログ)も消す = まっさらに戻す
docker compose down -v
```

**PowerShell**

```powershell
# 起動(初回はイメージの取得とビルドで数分かかります)
docker compose up -d --build

# 状態を見る(STATUS が healthy になれば準備完了)
docker compose ps

# 停止(データは残る)
docker compose down

# 停止して、データ(DB・指標・ログ)も消す = まっさらに戻す
docker compose down -v
```

## 開く場所(URL)

| 何か | URL | ひとこと |
| --- | --- | --- |
| お店の画面(storefront) | http://www.lab.localhost:18080 | Angular の SSR。画面の中身は api の CMS の JSON で決まります |
| API(api) | http://api.lab.localhost:18080 | 例: http://api.lab.localhost:18080/occ/v2/samplestore/products/search?query=ノート |
| 管理画面(backoffice) | http://backoffice.lab.localhost:18080/backoffice/ | `admin` / `admin`。社内の IP からだけ(この PC は「社内」扱い) |
| Grafana(ダッシュボード) | http://localhost:13000 | ログインなしで閲覧できます。ホームが「サンプルストア SLO」です(編集は admin / admin) |
| Prometheus(指標) | http://localhost:19090 | 「Status → Target health」で収集先、「Alerts」でアラートの状態 |
| Alertmanager(通知のまとめ役) | http://localhost:19093 | 今鳴っているアラート |
| pager(通知の受け口) | http://localhost:19094 | Alertmanager から届いた通知の一覧(5 秒ごとに更新) |

見本の会員: `alice` / `bob` / `carol`(パスワードはどれも `password`)。商品は `100001`〜`100030`(例: http://www.lab.localhost:18080/p/100001)。

**`*.localhost` の名前について**: `www.lab.localhost` のように `.localhost` で終わる名前は、Chrome・Edge・Firefox・curl(7.85 以降)では設定なしで自分の PC(127.0.0.1)になります。
**Safari** などで開けないときは、`/etc/hosts`(Windows は `C:\Windows\System32\drivers\etc\hosts`)に次の 1 行を足してください(管理者の権限が要ります)。Windows の PowerShell で使う人は、確実にするため最初から足しておくことをおすすめします(管理者の PowerShell で `` Add-Content -Path "$env:SystemRoot\System32\drivers\etc\hosts" -Value "`r`n127.0.0.1 www.lab.localhost api.lab.localhost backoffice.lab.localhost" ``)。

```
127.0.0.1 www.lab.localhost api.lab.localhost backoffice.lab.localhost
```

18080 番は、この PC の中(127.0.0.1)からだけ開けるようにしています。同じ LAN の別の PC からは届きません。

## 全体の地図

```
ブラウザ / k6 / Playwright
   │  http://www.lab.localhost:18080 ・ http://api.lab.localhost:18080 ・ http://backoffice.lab.localhost:18080
   ▼
cdn-waf(nginx + ModSecurity + OWASP CRS)  … クラスタの外の CDN と WAF の役(CCv2 の案件では、別に契約する CDN・WAF に当たる)
   │  キャッシュ / 全体のレート制限(IP ごと) / 攻撃の遮断 / セキュリティヘッダ・CSP
   ▼
ingress(nginx)                               … クラスタの入口(CCv2 の Cloud Portal の「エンドポイント」と「IP フィルタ」に当たる)
   │  ホスト名で振り分け / backoffice の IP フィルタ / ログインの回数制限 / /admin・/metrics・/readyz を外から閉じる
   ├── www.lab.localhost        ──▶ storefront:4000(Angular 21 SSR。CCv2 の JS Storefront)
   │                                    └──▶ api:3001(SSR 中は中の近道で直接)
   ├── api.lab.localhost        ──▶ api:3001(ASPECT=api。OCC 風 REST・OAuth・商品画像)
   └── backoffice.lab.localhost ──▶ backoffice:3001(ASPECT=backoffice。管理画面。社内 IP だけ)
       (外に出さない)                worker:3001(ASPECT=backgroundProcessing。定期ジョブ)
                                         ▼
                                    db:5432(PostgreSQL 17。検索も DB で代用。本格版は Solr)

観測(observability/compose.yml)
   Prometheus ──5 秒ごと──▶ storefront・api・backoffice・worker の /metrics(中から直接)
       └─ ルールで SLI・バーンレート・定期ジョブの止まりを計算 ─▶ Alertmanager ─▶ pager
   Alloy ──Docker のソケット──▶ 各コンテナのログ ─▶ Loki(ラベル service でサービスごとに絞れる)
   Grafana ──▶ Prometheus と Loki を表示
```

api・backoffice・worker は**同じイメージ**を、環境変数 `ASPECT` で役割を変えて動かしています(CCv2 の aspect と同じ考え方)。

### なぜ入口が 2 段(cdn-waf と ingress)なのか

役割と持ち主が違うからです。たとえると、ショッピングモールの警備員(cdn-waf)と、お店の受付係(ingress)です。

| | cdn-waf | ingress |
| --- | --- | --- |
| 置き場所 | クラスタの外(利用者の近く) | クラスタの入口 |
| CCv2 で当たるもの | 別に契約する CDN・WAF | Cloud Portal のエンドポイントと IP フィルタ |
| やること | よく聞かれる答えを代わりに返す(キャッシュ)、攻撃を止める(WAF)、1 人が送りすぎたら止める | ホスト名でどの窓口(サービス)かを決める、社員専用の部屋(backoffice)に入れてよい人かを IP で決める、ログインの回数制限 |
| 設定の場所 | `cdn-waf/default.conf.template` | `ingress/default.conf.template`(本格版は Ingress リソース) |

ingress は、利用者の本当の IP を cdn-waf が書く `X-Forwarded-For` から知ります。このヘッダは偽れるので、**cdn-waf(172.30.89.10)から来たときだけ**信じます。

| サービス | イメージ(バージョン固定) | メモリ上限 |
| --- | --- | --- |
| db | postgres:17.11-alpine | 256MB |
| api / backoffice / worker | apps/api をビルド(node:24.21.0-alpine)。`lab/api:local` | 256MB / 192MB / 192MB |
| storefront | apps/web をビルド(node:24.21.0-bookworm-slim)。`lab/web:local` | 384MB |
| ingress | nginx:1.30.4-alpine | 64MB |
| cdn-waf | owasp/modsecurity-crs:4.25.1-nginx-alpine-202609241109-lts | 128MB |
| prometheus | prom/prometheus:v3.15.0 | 256MB |
| alertmanager | prom/alertmanager:v0.34.1 | 64MB |
| pager | node:24.21.0-alpine(observability/pager/server.mjs) | 64MB |
| grafana | grafana/grafana:12.4.11 | 256MB |
| loki | grafana/loki:3.7.8 | 256MB |
| alloy | grafana/alloy:v1.20.0 | 128MB |

## 確かめるコマンド

**Mac / Linux / WSL**

```bash
# SSR の HTML に CMS の部品が入っているか(JS なしで見える)
curl -s http://www.lab.localhost:18080/ | grep -o 'data-cms-type="[^"]*"'
# キャッシュ(2 回目は X-Cache-Status: HIT。30 秒で切れる)
curl -sI http://www.lab.localhost:18080/p/100001 | grep -i x-cache
# 無い商品は 404
curl -s -o /dev/null -w '%{http_code}\n' http://www.lab.localhost:18080/p/NO-SUCH-CODE
# CORS: www のオリジンなら Access-Control-Allow-Origin が返る
curl -sI -H 'Origin: http://www.lab.localhost:18080' http://api.lab.localhost:18080/occ/v2/samplestore/products/100001 | grep -i access-control
# トークンをもらって注文を見る
TOKEN=$(curl -s http://api.lab.localhost:18080/authorizationserver/oauth/token \
  -d 'grant_type=password&client_id=storefront&username=alice&password=password' | sed 's/.*"access_token":"\([^"]*\)".*/\1/')
curl -s -H "Authorization: Bearer $TOKEN" http://api.lab.localhost:18080/occ/v2/samplestore/users/current/orders
# 中の人だけの口は外から 403
curl -s -o /dev/null -w '%{http_code}\n' http://api.lab.localhost:18080/admin/chaos
```

**PowerShell**

```powershell
# SSR の HTML に CMS の部品が入っているか(JS なしで見える)
curl.exe -s http://www.lab.localhost:18080/ | Select-String -Pattern 'data-cms-type="[^"]*"' -AllMatches | ForEach-Object { $_.Matches.Value }
# キャッシュ(2 回目は X-Cache-Status: HIT。30 秒で切れる)
curl.exe -sI http://www.lab.localhost:18080/p/100001 | Select-String x-cache
# 無い商品は 404
curl.exe -s -o NUL -w '%{http_code}\n' http://www.lab.localhost:18080/p/NO-SUCH-CODE
# CORS: www のオリジンなら Access-Control-Allow-Origin が返る
curl.exe -sI -H 'Origin: http://www.lab.localhost:18080' http://api.lab.localhost:18080/occ/v2/samplestore/products/100001 | Select-String access-control
# トークンをもらって注文を見る
$TOKEN = (curl.exe -s http://api.lab.localhost:18080/authorizationserver/oauth/token `
  -d 'grant_type=password&client_id=storefront&username=alice&password=password' | ConvertFrom-Json).access_token
curl.exe -s -H "Authorization: Bearer $TOKEN" http://api.lab.localhost:18080/occ/v2/samplestore/users/current/orders
# 中の人だけの口は外から 403
curl.exe -s -o NUL -w '%{http_code}\n' http://api.lab.localhost:18080/admin/chaos
```

### IP フィルタを確かめる(backoffice は社内だけ)

この PC(ホスト)から来た通信は、cdn-waf が「127.0.0.1 から来た」として ingress に伝えるので、社内扱いで通ります。
「社外」から来た様子は、社外の代わりのネットワーク `lab_outside` に置いたコンテナから見られます。

**Mac / Linux / WSL**

```bash
# 社外(lab_outside)から → 403
docker run --rm --network lab_outside curlimages/curl:8.16.0 -s -o /dev/null -w '%{http_code}\n' \
  -H 'Host: backoffice.lab.localhost' http://cdn-waf:18080/backoffice/login
# 社外からでも、お店(www)は誰でも → 200
docker run --rm --network lab_outside curlimages/curl:8.16.0 -s -o /dev/null -w '%{http_code}\n' \
  -H 'Host: www.lab.localhost' http://cdn-waf:18080/

# この PC も社外扱いにする(許す範囲から 127.0.0.1 を外す)→ ブラウザでも 403 になる
BACKOFFICE_IP_ALLOWLIST=172.30.89.0/24 docker compose up -d ingress
# 元に戻す
docker compose up -d ingress
```

**PowerShell**(`docker run … curlimages/curl` はコンテナの中の Linux の curl なので、そのまま)

```powershell
# 社外(lab_outside)から → 403
docker run --rm --network lab_outside curlimages/curl:8.16.0 -s -o /dev/null -w '%{http_code}\n' `
  -H 'Host: backoffice.lab.localhost' http://cdn-waf:18080/backoffice/login
# 社外からでも、お店(www)は誰でも → 200
docker run --rm --network lab_outside curlimages/curl:8.16.0 -s -o /dev/null -w '%{http_code}\n' `
  -H 'Host: www.lab.localhost' http://cdn-waf:18080/

# この PC も社外扱いにする(許す範囲から 127.0.0.1 を外す)→ ブラウザでも 403 になる
$env:BACKOFFICE_IP_ALLOWLIST = '172.30.89.0/24'; docker compose up -d ingress
# 元に戻す(環境変数を消してから起動し直す)
Remove-Item Env:BACKOFFICE_IP_ALLOWLIST; docker compose up -d ingress
```

今の許す範囲は `docker compose exec ingress cat /etc/nginx/ip-filters/backoffice.conf` で見られます。

## わざと壊すスイッチ(カオス)

`/admin/chaos` は ingress で「外からは 403」にしているため、切り替えは `tools/chaos.sh`(PowerShell は `tools/chaos.ps1`。引数は同じ)を使います(コンテナの中から直接頼みます)。

**Mac / Linux / WSL**

```bash
tools/chaos.sh status                   # api の今の状態
tools/chaos.sh set latencyMs=1500       # OCC の API とトークンに 1.5 秒の遅延
tools/chaos.sh set errorRate=0.5        # 半分を 500 エラーに
tools/chaos.sh set leakMb=5             # リクエストのたびに 5MB ずつメモリをため込む(上限 256MB で落ちて再起動)
tools/chaos.sh set idorBug=true         # 他人の注文が見えてしまう(認可の事故)
tools/chaos.sh set sqliBug=true         # 検索の query に SQL インジェクションの穴(cdn-waf の WAF が止める様子を見る)
tools/chaos.sh reset                    # api のスイッチを全部元に戻す
tools/chaos.sh worker set cronFail=true # worker の定期ジョブを全部失敗させる
tools/chaos.sh worker reset
```

**PowerShell**

```powershell
tools/chaos.ps1 status                   # api の今の状態
tools/chaos.ps1 set latencyMs=1500       # OCC の API とトークンに 1.5 秒の遅延
tools/chaos.ps1 set errorRate=0.5        # 半分を 500 エラーに
tools/chaos.ps1 set leakMb=5             # リクエストのたびに 5MB ずつメモリをため込む(上限 256MB で落ちて再起動)
tools/chaos.ps1 set idorBug=true         # 他人の注文が見えてしまう(認可の事故)
tools/chaos.ps1 set sqliBug=true         # 検索の query に SQL インジェクションの穴(cdn-waf の WAF が止める様子を見る)
tools/chaos.ps1 reset                    # api のスイッチを全部元に戻す
tools/chaos.ps1 worker set cronFail=true # worker の定期ジョブを全部失敗させる
tools/chaos.ps1 worker reset
```

- 起動時の値は `docker-compose.yml` の `CHAOS_*` で決まり、コマンドの前に書いて変えられます(例: `CHAOS_LEAK_MB=20 docker compose up -d api`。PowerShell は `$env:CHAOS_LEAK_MB = '20'; docker compose up -d api`、戻すときは `Remove-Item Env:CHAOS_LEAK_MB; docker compose up -d api`)。
- 対象が再起動すると、スイッチは起動時の値に戻ります。

## 調整できるところ(つまみ)

コマンドの前に書くと、その起動のときだけ変えられます(例: `EDGE_CACHE=off docker compose up -d cdn-waf`)。書かなければ既定値に戻ります。
PowerShell では `$env:EDGE_CACHE = 'off'; docker compose up -d cdn-waf` と書きます。この環境変数はターミナルを閉じるまで残るので、戻すときは `Remove-Item Env:EDGE_CACHE; docker compose up -d cdn-waf` と、消してから起動し直します。

| つまみ | 反映のしかた | 既定 | 意味 |
| --- | --- | --- | --- |
| `EDGE_CACHE` | `docker compose up -d cdn-waf` | `on` | cdn-waf のキャッシュの ON / OFF(ここ 1 か所) |
| `EDGE_GLOBAL_RATE` / `EDGE_GLOBAL_BURST` | 同上 | `20r/s` / `80` | IP ごとの全体のレート制限と、まとめて通す数 |
| `BLOCKING_PARANOIA` | 同上 | `1` | WAF の疑い深さ(1〜4)。上げるほど厳しく、誤遮断も増える |
| `ANOMALY_INBOUND` | 同上 | `5` | 怪しさの点数がこれ以上で遮断。上げるほど甘くなる |
| `WWW_CSP` | docker-compose.yml を直して同上 | 下記 | www の Content-Security-Policy |
| 例外ルール | cdn-waf/modsecurity/lab-exclusions-before.conf | なし(見本だけ) | 誤遮断を「狭く」直す書き方の見本 |
| `BACKOFFICE_IP_ALLOWLIST` | `docker compose up -d ingress` | `127.0.0.1/32 172.30.89.0/24 172.30.91.0/24` | backoffice に入ってよい範囲(IP フィルタ) |
| `RENDER_MODE` | `docker compose up -d storefront` | `ssr` | `ssr` / `csr` の切り替え |
| `SSR_TIMEOUT_MS` | 同上 | `3000` | SSR をあきらめて空の HTML を返すまでの時間 |
| `SSR_WINDOW_BUG` | 同上 | `false` | `true` でサーバー側の描画が 500 になる |
| `CHAOS_LATENCY_MS` など `CHAOS_*` | `docker compose up -d api` | 壊さない | カオスの起動時の値 |
| `CHAOS_CRON_FAIL` | `docker compose up -d worker` | `false` | `true` で定期ジョブが全部失敗する |
| `CRON_INTERVAL_SECONDS` | 同上 | `60` | 定期ジョブの間隔(秒) |

### CSP の指紋(script-src の sha256)

www の CSP は、自分のサイトの JS ファイルと、Angular が HTML に埋め込む小さなスクリプト 4 つ(sha256 の指紋)だけを許しています。
Angular を更新すると指紋が変わることがあり、ブラウザの開発者ツールに `Refused to execute inline script ... 'sha256-...'` と出ます。
そのときは、表示された `sha256-...` を docker-compose.yml の `WWW_CSP` に足し、`docker compose up -d cdn-waf` で反映します。
表示を待たずに自分で計算するなら、次のようにします(HTML の中の `<script>` の中身を sha256 にして base64 にしたものが指紋です)。

**Mac / Linux / WSL**

```bash
curl -s http://www.lab.localhost:18080/login | python3 -c '
import sys,re,hashlib,base64
for a,b in re.findall(r"<script([^>]*)>(.*?)</script>", sys.stdin.read(), re.S):
    if "src=" in a or "json" in a: continue
    print("sha256-" + base64.b64encode(hashlib.sha256(b.encode()).digest()).decode())'
# 属性の中のスクリプト onload="this.media='all'" の指紋(これがあるので 'unsafe-hashes' も要ります)
printf "%s" "this.media='all'" | openssl dgst -sha256 -binary | base64
```

**PowerShell**

```powershell
$html = curl.exe -s http://www.lab.localhost:18080/login | Out-String
$sha = [Security.Cryptography.SHA256]::Create()
foreach ($m in [regex]::Matches($html, '<script([^>]*)>(.*?)</script>', 'Singleline')) {
  if ($m.Groups[1].Value -match 'src=|json') { continue }
  'sha256-' + [Convert]::ToBase64String($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($m.Groups[2].Value)))
}
# 属性の中のスクリプト onload="this.media='all'" の指紋(これがあるので 'unsafe-hashes' も要ります)
[Convert]::ToBase64String($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes("this.media='all'")))
```

connect-src と img-src に `http://api.lab.localhost:18080` が入っているのは、ブラウザが別オリジンの api から JSON と商品画像を取るためです。

## 道具(tools/)

どのスクリプトにも、同じ名前の PowerShell 版(`tools/chaos.ps1` など。引数は同じ)があります。Windows の PowerShell 7 ではそちらを使います。

| スクリプト | 何をするか |
| --- | --- |
| `tools/chaos.sh` | わざと壊すスイッチの切り替え(上記) |
| `tools/k6.sh smoke.js` | 主な URL を 1 回ずつ確かめる(スモークテスト。10 秒ほど) |
| `tools/k6.sh browse.js` | 普通の利用者のまね(トップ → 検索 → 商品詳細)で負荷をかける。`-e VUS=10 -e DURATION=5m` で調整 |
| `tools/k6.sh ramp.js` | 段階的に負荷を上げる試験。cdn-waf 経由だとレート制限の 429 も見える。`API_URL=http://api:3001 tools/k6.sh ramp.js`(PowerShell は `$env:API_URL = 'http://api:3001'; tools/k6.ps1 ramp.js`)で api に直接 |
| `tools/backup.sh` | DB のバックアップを `backups/` に取る(`pg_dump`) |
| `tools/restore.sh [ファイル]` | バックアップから DB を戻す(`psql`)。省略すると最新のファイル |
| `tools/e2e.sh` | E2E テスト(トップ → 検索 → 商品詳細 → ログイン → 注文履歴、他人の注文が見えないこと、無い商品の 404)と画面比較を Playwright で流す。基準画像の撮り直しは `tools/e2e.sh --update-snapshots` |
| `tools/attack-samples.sh` | SQL インジェクション・XSS の典型的な文字列を api の検索と画面の検索に送り、WAF が 403 で止めるか確かめる |
| `node tools/manifest/render.mjs` | manifest.json から本格版の Kubernetes の定義(k8s/generated/)を作る。`--check` で軽量版との食い違いを確かめる |

> **`tools/attack-samples.sh` は、このラボ(www.lab.localhost・api.lab.localhost)にだけ使ってください。**
> 実在するサイトや他人のサーバーに送ってはいけません。許可なく送ると法律に触れるおそれがあります。

k6 と Playwright は Docker のイメージ(`grafana/k6:1.8.1`・`mcr.microsoft.com/playwright:v1.63.0-noble`)で動くので、PC に入れる必要はありません。
どちらもコンテナの中から、ブラウザと同じ URL(`http://www.lab.localhost:18080`)で cdn-waf を通ります。

## アラートの見本を鳴らす

### エラーバジェットの消費(api)

**Mac / Linux / WSL**

```bash
tools/chaos.sh set errorRate=0.5
tools/k6.sh browse.js -e DURATION=3m -e PAGES=0
```

**PowerShell**

```powershell
tools/chaos.ps1 set errorRate=0.5
tools/k6.ps1 browse.js -e DURATION=3m -e PAGES=0
```

1〜2 分で pager(http://localhost:19094)に `ErrorBudgetBurnDemo`(デモ用の短い窓のアラート)と `ErrorBudgetBurnPage`(緊急)が届きます。片付けは `tools/chaos.sh reset`(`tools/chaos.ps1 reset`)です。

### 定期ジョブの止まり(worker)

**Mac / Linux / WSL**

```bash
# ジョブを全部失敗させ、間隔を 10 秒に縮めて起動し直す
CHAOS_CRON_FAIL=true CRON_INTERVAL_SECONDS=10 docker compose up -d worker
```

**PowerShell**

```powershell
# ジョブを全部失敗させ、間隔を 10 秒に縮めて起動し直す
$env:CHAOS_CRON_FAIL = 'true'; $env:CRON_INTERVAL_SECONDS = '10'; docker compose up -d worker
```

- 約 1〜2 分: `CronJobStaleDemo`(デモ用。1 分以上成功なし)と `CronJobFailureRatioHigh`(失敗率 50% 超え)
- 約 5〜6 分: `CronJobStale`(本物のしきい値。5 分以上成功なし)

どれも pager に届きます。Grafana の「worker(定期ジョブ)」の段で、失敗の回数と「最後の成功からの時間」が伸びていく様子が見えます。
片付けは `docker compose up -d worker`(つまみを書かずに起動し直すと既定値に戻ります。PowerShell は `Remove-Item Env:CHAOS_CRON_FAIL, Env:CRON_INTERVAL_SECONDS; docker compose up -d worker`)。

ルールと計算式は `observability/prometheus/rules/` のコメントにあります。SLO(目標)とアラートを持つのは storefront と api です。

## manifest.json と環境(d1・s1・p1)

`manifest.json` は、aspect・台数・環境変数・エンドポイント・IP フィルタ・環境ごとの違いを 1 か所にまとめた設計図です(CCv2 の manifest の考え方をまねた、このラボ独自の形)。
項目の意味は [tools/manifest/README.md](tools/manifest/README.md) にあります。軽量版の docker-compose.yml は、この manifest に手で合わせています。

## フォルダの中身

```
apps/api/        api・backoffice・worker(1 つのイメージ。Node.js + Express + PostgreSQL)
apps/web/        storefront(Angular 21 SSR)
cdn-waf/         cdn-waf の nginx 設定と WAF の例外ルール
ingress/         ingress の nginx 設定と IP フィルタを作るスクリプト(軽量版だけ)
observability/   Prometheus・Alertmanager・Grafana・Loki・Alloy・pager
tools/           k6・Playwright・バックアップ・カオス・攻撃の見本・manifest の変換
manifest.json    構成の設計図
docs/            演習ページ
k8s/             本格版(kind)。k8s/generated/ は render.mjs が作る
```

## 注意

- これは学習用です。パスワードなどは、わざと分かりやすい見本の値にしています。本番で同じことはしません。
- ラボ内のデータはすべて架空です。
