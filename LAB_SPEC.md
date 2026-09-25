# 体験ラボ 仕様(作る人向け。全員この仕様に従う)

## 目的
SIer 出身で、性能・セキュリティ・SRE・インフラを意識せずに仕事をしてきたエンジニアが、
方式設計書・詳細設計書を読んでも「なぜこの文書が必要か」「何をやっているか」「単語の意味」が分からない、という壁を越えるための体験アプリ。
**実物を自分の手で動かし、壊し、測る → そのあとで言葉と設計書の節を結びつける**。

- 公開リポジトリ。SAP の資料の引用・社内情報・認証情報・個人のメールアドレスは入れない。題材は架空のネットストア「サンプルストア」(サンプル株式会社)。
- 日本語。です・ます。新卒でも読める平易さ。専門用語は初出で一言説明し、たとえを添える。
- 2 つの版: **軽量版(docker compose だけ)** と **本格版(kind = Docker の中の Kubernetes)**。同じアプリのイメージを使う。

## 構成(軽量版 docker compose)
```
ブラウザ / k6 / Playwright
   ↓ http://localhost:18080
edge: nginx + ModSecurity(OWASP CRS)   … CDN と WAF の代わり。キャッシュ、レート制限、攻撃の遮断、管理画面の IP 制限、セキュリティヘッダ・CSP
   ↓
web: Angular 21 の SSR アプリ(Node の Express で動く)   … 商品一覧・商品詳細・ログイン・注文履歴
   ↓
api: Node.js(Express)+ PostgreSQL   … 商品・ログイン(JWT)・注文。わざと壊せるスイッチ(カオス)付き
   +
obs: Prometheus(指標)・Alertmanager(通知)・Grafana(ダッシュボード)・Loki + Grafana Alloy(ログ)
```
- ポート(ホスト側): edge 18080、Grafana 13000、Prometheus 19090、Alertmanager 19093、pager 19094(8080・3000 は他のアプリとよく衝突するため 1 万番台にする)。web と api は edge 経由で見る(直接見る必要がある演習のみ web 4000 / api 3001 を開けてよい)。ほかのポートと衝突しないこと。
- 画像は Docker Hub などの公開イメージだけを使う。バージョンは固定する(`latest` 禁止)。
- 1 コマンドで起動: `docker compose up -d --build`。止める: `docker compose down`(データも消すなら `-v`)。
- メモリ合計の目安 2GB 以内(Docker Desktop 8GB で余裕を持って動くこと)。

## アプリの仕様
### api(apps/api)
- Node.js 24 LTS、Express 5、pg、prom-client、pino(JSON ログを標準出力)。TypeScript でも JS でもよいが、ビルドが単純なこと。
- DB: PostgreSQL 17。起動時にテーブル作成と見本データ投入(商品 30 件、会員 3 人 `alice`/`bob`/`carol` パスワード `password`、注文 各 2〜3 件)。
- エンドポイント:
  - `GET /api/products`(一覧、`?q=` 検索)、`GET /api/products/:id`
  - `POST /api/login` → JWT(有効 15 分)。失敗が続いたときのロックは**しない**(レート制限は edge で見せるため)
  - `GET /api/orders/:orderId`(注文詳細)、`GET /api/me/orders`(自分の注文一覧。JWT 必須)
  - `GET /healthz`(生きているか)、`GET /readyz`(DB に届くか。準備できているか)
  - `GET /metrics`(prom-client: `http_requests_total{route,method,status}`、`http_request_duration_seconds` ヒストグラム)
- **わざと壊すスイッチ**(環境変数と、管理用 `POST /admin/chaos` の両方で切り替え。`/admin/*` は edge で社内 IP 以外を遮断する):
  - `latencyMs`(全 API に遅延を足す)、`errorRate`(0〜1 の割合で 500 を返す)、`leakMb`(リクエストのたびにメモリを溜めて最後は落ちる)、
  - `idorBug`(true だと `GET /api/orders/:orderId` が持ち主を確かめない = 他人の注文が見える。認可の事故の体験用)、
  - `sqliBug`(true だと検索の `q` を文字列連結で SQL に入れる = SQL インジェクションの体験用。WAF が止めるのを見る)
- 状態は `GET /admin/chaos` で見られる。

### web(apps/web)
- Angular 21(スタンドアロン、`@angular/ssr`)、SSR を有効にしたアプリ。Express サーバーで配信。
- 画面: `/`(トップ)、`/products`(一覧)、`/products/:id`(詳細)、`/login`、`/me/orders`(注文履歴。**遅延読み込みのルート**)。
- **SSR と CSR の切り替え**: 環境変数 `RENDER_MODE=ssr|csr`(csr のときはサーバーで描画せず空の HTML を返す)。演習で比較するため。
- **SSR を壊すスイッチ**: 環境変数 `SSR_WINDOW_BUG=true` で、サーバー側で `window` を触るコードが動き、SSR が 500 になる(ブラウザでは動く)。FE の規約の体験用。
- SSR のタイムアウト: API が遅いときに一定時間(既定 3000ms、`SSR_TIMEOUT_MS`)で諦め、CSR の空 HTML を返す(フォールバック)。ログに `ssr_fallback` を出す。
- `GET /metrics`(prom-client: `ssr_render_duration_seconds` ヒストグラム、`ssr_fallback_total`、`ssr_errors_total`)。
- 初期 JS の予算を angular.json の budgets で設定(演習で超えるとビルドが落ちるのを見る)。
- API は SSR 時はサーバーから `http://api:3001`、ブラウザからは同じオリジンの `/api`(edge が振り分け)。

### edge(edge/)
- `owasp/modsecurity-crs` の nginx 版イメージ(固定タグ)。
- 振り分け: `/api/` → api、それ以外 → web。
- キャッシュ: 商品一覧・商品詳細の HTML と `GET /api/products*` を 30 秒キャッシュ(`X-Cache-Status` ヘッダで HIT/MISS が見える)。ログイン中(Authorization / Cookie あり)はキャッシュしない。キャッシュの ON/OFF を環境変数か設定ファイルの切替 1 か所で変えられること。
- レート制限: `/api/login` は IP あたり 1 秒 1 回(バースト 5)、全体は IP あたり 1 秒 20 回。超えたら 429。
- `/admin/` は 127.0.0.1 と Docker の内部ネットワーク以外を 403(社内 IP 制限の代わり)。
- セキュリティヘッダ: `Content-Security-Policy`、`X-Content-Type-Options`、`Referrer-Policy`、`X-Frame-Options`。
- ModSecurity: 既定は DetectionOnly(記録だけ)にしない。**遮断モード**で、SQL インジェクション・XSS の典型的な入力を 403 にする。誤遮断の体験のため、演習で閾値を変えられるようにする。

### obs(observability/)
- Prometheus: api・web を 5 秒ごとに収集。**記録ルール**で SLI を作る: 成功率(5xx 以外 ÷ 全体)、p95 応答時間。**アラートルール**: エラーバジェットの消費速度(バーンレート)の緊急(5 分窓と 1 時間窓)・警告、SSR フォールバック率。SLO は「月 99.9%」、計算式をルールのコメントに書く。
- Alertmanager: 通知先は、ラボ内の小さな受け口(webhook を受けて画面に一覧表示する最小のサービス `pager`、または Alertmanager の画面)。外部サービスに送らない。
- Grafana: 匿名で閲覧可(ラボなので)。データソースとダッシュボードを provisioning で自動登録。ダッシュボード「サンプルストア SLO」: リクエスト数、成功率、p95、エラーバジェット残り、バーンレート、SSR 描画時間とフォールバック率、ログ(Loki)のパネル。
- Loki + Grafana Alloy: コンテナのログを集める(Docker のソケットを読む)。

### tools(tools/)
- k6 のシナリオ(Docker イメージ `grafana/k6` で実行): 一覧・詳細を見る普通の利用者、段階的に負荷を上げる試験。
- Playwright の E2E(Docker イメージ `mcr.microsoft.com/playwright` で実行): 主要な導線(一覧 → 詳細 → ログイン → 注文履歴)と画面比較。
- DB のバックアップと復元のスクリプト(`pg_dump` / `psql`)。
- 攻撃の見本(防御の確認用。SQL インジェクション・XSS の典型文字列を curl で送るだけ。実在のサイトには使わないと明記)。

## 本格版(k8s/)
- kind のクラスタ定義、同じイメージを使う Kubernetes のマニフェスト(Namespace、Deployment(readiness/liveness プローブ、resources の requests/limits)、Service、ConfigMap、Secret、HPA は任意)。edge は NodePort で localhost:18080 に出す。
- 本格版で見せたいこと: Pod とレプリカ、ヘルスチェックで Not Ready になる様子、ローリング更新、メモリ上限で OOMKilled → CrashLoopBackOff、レプリカを増やす。
- 観測(Prometheus・Grafana・Loki)は本格版でも動くこと(マニフェストで最小構成。Helm は使わない)。

## 演習ページ(docs/、VitePress)
- 1 演習 = 1 ページ。10 層(FE・BE・インフラ・ネットワーク・SRE・QA・性能・障害対応・DR・セキュリティ)に最低 1 本ずつ。
- どのページも同じ形:
  1. **この設計書はなぜ必要か**(無いと何が起きるか。事故の例を 1 つ)
  2. **何をやっているのか**(1 段落 + たとえ)
  3. **まず触ってみる**(手順。軽量版と本格版の違いがあれば両方)
  4. **何が見えたら成功か**(画面・数値・ログ)
  5. **ここで覚える言葉**(用語カード: 一言 / たとえ / この演習で見たもの)
  6. **設計書ではここに書く**(方式設計書・詳細設計書のどの節に、何を書くか。例: 「SRE 方式設計書 4.1 サービス目標」)
  7. **レビューで聞く質問**(3〜6 個。初めてレビューする人がそのまま使える文)
  8. **片付け**(スイッチを戻す手順)
- 用語集ページ(全演習の言葉を集めたもの)と、「SIer の言葉との対応表」(基本設計・詳細設計・結合試験・負荷試験・障害対応手順書 などとの対応)。
