# サンプルストア 体験ラボ

性能・セキュリティ・SRE・インフラの「設計書に書いてあること」を、**実物を自分の手で動かし、壊し、測って**から理解するための練習場です。
題材は架空のネットストア「サンプルストア」(サンプル株式会社)です。

- 方式設計書・詳細設計書を読んでも「なぜこの文書が要るのか」「何をしているのか」がピンと来ない人向けです。
- 先に手を動かして「あ、こうなるのか」を体験し、そのあとで言葉と設計書の節を結びつけます。
- すべて自分の PC の中(Docker)で動きます。外部のサービスには何も送りません。

> この README は「軽量版(docker compose だけで動く版)」の説明です。Kubernetes で動かす本格版は `k8s/` にあります(別の説明を参照)。

## 用意するもの

| もの | 目安 |
| --- | --- |
| Docker Desktop(Mac / Windows)または Docker Engine + Compose v2(Linux) | Compose は `include:` が使える v2.20 以上 |
| Docker に割り当てるメモリ | **8GB**(ラボ全体の上限はおよそ 2GB。残りは余裕です) |
| ディスクの空き | 5GB ほど(イメージのダウンロード分) |
| 空いているポート | 18080・13000・19090・19093・19094 |

## 起動と停止

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

## 開く場所(URL)

| 何か | URL | ひとこと |
| --- | --- | --- |
| サンプルストア(お店の入口) | http://localhost:18080 | edge(CDN と WAF の代わり)を通って web / api に届きます |
| Grafana(ダッシュボード) | http://localhost:13000 | ログインなしで閲覧できます。ホームが「サンプルストア SLO」です(編集は admin / admin) |
| Prometheus(指標) | http://localhost:19090 | 「Status → Targets」で収集先、「Alerts」でアラートの状態 |
| Alertmanager(通知のまとめ役) | http://localhost:19093 | 今鳴っているアラート |
| pager(通知の受け口) | http://localhost:19094 | Alertmanager から届いた通知の一覧(5 秒ごとに更新) |

見本の会員: `alice` / `bob` / `carol`(パスワードはどれも `password`)。

## 全体の地図

```
ブラウザ / k6 / Playwright
   │  http://localhost:18080
   ▼
edge(nginx + ModSecurity + OWASP CRS)          … CDN と WAF の代わり
   │  キャッシュ 30 秒 / レート制限 / 攻撃の遮断 / 管理画面の IP 制限 / セキュリティヘッダ・CSP
   ├── /api/*   ──▶ api:3001(Node.js + Express)  … 商品・ログイン(JWT)・注文。わざと壊すスイッチ付き
   │                   └──▶ db:5432(PostgreSQL 17)
   ├── /admin/* ──▶ api:3001(Docker の内部ネットワークからだけ。ホストからは 403)
   └── それ以外  ──▶ web:4000(Angular 21 SSR)
                       └──▶ api:3001(サーバーで描画するときは直接)

観測(observability/compose.yml)
   Prometheus ──5 秒ごと──▶ api:3001/metrics, web:4000/metrics
       └─ ルールで SLI・バーンレートを計算 ─▶ Alertmanager ─▶ pager
   Alloy ──Docker のソケット──▶ 各コンテナのログ ─▶ Loki
   Grafana ──▶ Prometheus と Loki を表示
```

| サービス | イメージ(バージョン固定) | メモリ上限 |
| --- | --- | --- |
| db | postgres:17.11-alpine | 256MB |
| api | apps/api をビルド(node:24.21.0-alpine) | 256MB |
| web | apps/web をビルド(node:24.21.0-bookworm-slim) | 384MB |
| edge | owasp/modsecurity-crs:4.25.1-nginx-alpine-202609241109-lts | 128MB |
| prometheus | prom/prometheus:v3.15.0 | 256MB |
| alertmanager | prom/alertmanager:v0.34.1 | 64MB |
| pager | node:24.21.0-alpine(observability/pager/server.mjs) | 64MB |
| grafana | grafana/grafana:12.4.11 | 256MB |
| loki | grafana/loki:3.7.8 | 256MB |
| alloy | grafana/alloy:v1.20.0 | 128MB |

## わざと壊すスイッチ(カオス)

api には、障害や脆弱性をわざと起こすスイッチがあります。`/admin/chaos` は edge で「社内からだけ」に制限しているため、
**ホストのブラウザから http://localhost:18080/admin/chaos を開くと 403 になります(それが正しい動きです)**。
切り替えは `tools/chaos.sh` を使います(api コンテナの中から api に直接頼みます)。

```bash
tools/chaos.sh status                 # 今の状態
tools/chaos.sh set latencyMs=1500     # 全 API に 1.5 秒の遅延
tools/chaos.sh set errorRate=0.5      # 半分を 500 エラーに
tools/chaos.sh set leakMb=5           # リクエストのたびに 5MB ずつメモリをため込む(上限 256MB で落ちて再起動)
tools/chaos.sh set idorBug=true       # 他人の注文が見えてしまう(認可の事故)
tools/chaos.sh set sqliBug=true       # 検索に SQL インジェクションの穴(edge の WAF が止める様子を見る)
tools/chaos.sh reset                  # 全部元に戻す
```

手で打つ場合は次と同じです。

```bash
docker compose exec api curl -s -X POST -H 'Content-Type: application/json' \
  -d '{"errorRate":0.5}' http://localhost:3001/admin/chaos
```

- 起動時の値は `docker-compose.yml` の `CHAOS_*` でも決められます。
- api が落ちて再起動すると、スイッチは起動時の値に戻ります。

## 調整できるところ(つまみ)

| つまみ | 場所 | 既定 | 意味 |
| --- | --- | --- | --- |
| `EDGE_CACHE` | docker-compose.yml の edge | `on` | キャッシュの ON / OFF(ここ 1 か所) |
| `EDGE_GLOBAL_RATE` | 同上 | `20r/s` | IP ごとの全体のレート制限 |
| `EDGE_CSP` | 同上 | 下記 | Content-Security-Policy の中身 |
| `MODSEC_RULE_ENGINE` | 同上 | `On` | `On` = 遮断 / `DetectionOnly` = 記録だけ |
| `BLOCKING_PARANOIA` | 同上 | `1` | WAF の疑い深さ(1〜4)。上げるほど厳しく、誤遮断も増える |
| `ANOMALY_INBOUND` | 同上 | `5` | 怪しさの点数がこれ以上で遮断。上げるほど甘くなる |
| 例外ルール | edge/modsecurity/lab-exclusions-before.conf | Cookie を検査対象から外す 1 件 | 誤遮断を「狭く」直す書き方の見本 |
| `RENDER_MODE` | docker-compose.yml の web | `ssr` | `ssr` / `csr` の切り替え |
| `SSR_TIMEOUT_MS` | 同上 | `3000` | SSR をあきらめて空の HTML を返すまでの時間 |
| `SSR_WINDOW_BUG` | 同上 | `false` | `true` でサーバー側の描画が 500 になる |

変えたら `docker compose up -d edge`(または `web`)で反映します。

- CSP の `script-src` は、自分のサイトの JS と、Angular が HTML に埋め込む小さなスクリプト(sha256 の指紋で指定)だけを許しています。Angular を更新すると指紋が変わることがあるので、ブラウザの開発者ツールに `Refused to execute inline script` と出たら、表示された `sha256-...` を `EDGE_CSP` に足してください。
- ブラウザは `localhost` の Cookie を、ポート番号が違う別のアプリとも共有します。そのため、ラボの画面を開いたときに別アプリの Cookie が一緒に送られて WAF に止められる(403)ことがありました。サンプルストアは Cookie を使わないので、例外ルールで Cookie だけを検査対象から外しています。
- 同じ理由で、ブラウザに別アプリの Cookie があると edge のキャッシュは `BYPASS` になります(ログイン中の人の画面をためない仕組みが働くため)。キャッシュの HIT / MISS を見るときは `curl -I` を使うと分かりやすいです。

## 道具(tools/)

| スクリプト | 何をするか |
| --- | --- |
| `tools/chaos.sh` | わざと壊すスイッチの切り替え(上記) |
| `tools/k6.sh browse.js` | 普通の利用者のまね(一覧 → 詳細)で負荷をかける。`-e VUS=10 -e DURATION=5m` で調整 |
| `tools/k6.sh ramp.js` | 段階的に負荷を上げる試験。edge 経由だとレート制限の 429 も見える。`BASE_URL=http://api:3001 tools/k6.sh ramp.js` で api に直接 |
| `tools/backup.sh` | DB のバックアップを `backups/` に取る(`pg_dump`) |
| `tools/restore.sh [ファイル]` | バックアップから DB を戻す(`psql`)。省略すると最新のファイル |
| `tools/e2e.sh` | E2E テスト(一覧 → 詳細 → ログイン → 注文履歴、他人の注文が見えないこと)と画面比較を Playwright で流す(Docker で動くので PC に入れる物はなし)。基準画像の撮り直しは `tools/e2e.sh --update-snapshots` |
| `tools/attack-samples.sh` | SQL インジェクション・XSS の典型的な文字列を送り、WAF が 403 で止めるか確かめる |

> **`tools/attack-samples.sh` は、このラボ(http://localhost:18080)にだけ使ってください。**
> 実在するサイトや他人のサーバーに送ってはいけません。許可なく送ると法律に触れるおそれがあります。

k6 は Docker のイメージ(`grafana/k6:1.8.1`)で動くので、PC に入れる必要はありません。

## アラートの見本を鳴らす

```bash
tools/chaos.sh set errorRate=0.5
tools/k6.sh browse.js -e DURATION=3m -e PAGES=0
```

1〜2 分で pager(http://localhost:19094)に `ErrorBudgetBurnDemo`(デモ用の短い窓のアラート)と `ErrorBudgetBurnPage`(緊急)が届きます。
片付けは `tools/chaos.sh reset` です。ルールと計算式は `observability/prometheus/rules/` のコメントにあります。

## 演習

演習ページ(1 演習 1 ページ。FE・BE・インフラ・ネットワーク・SRE・QA・性能・障害対応・DR・セキュリティ)は `docs/` にあります。
(準備中)

## フォルダの中身

```
apps/api/        api(Node.js + Express + PostgreSQL)
apps/web/        web(Angular 21 SSR)
edge/            edge の nginx 設定と WAF の例外ルール
observability/   Prometheus・Alertmanager・Grafana・Loki・Alloy・pager
tools/           k6・バックアップ・カオス・攻撃の見本
docs/            演習ページ
k8s/             本格版(kind)
```

## 注意

- これは学習用です。パスワードや署名鍵などは、わざと分かりやすい見本の値にしています。本番で同じことはしません。
- ラボ内のデータはすべて架空です。
