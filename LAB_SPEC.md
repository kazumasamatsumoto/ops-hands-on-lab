# 体験ラボ 仕様(作る人向け。全員この仕様に従う)

> **読み方の注意**: 今の構成は下の「第 2 版」です。すぐ下に続く第 1 版の節(`edge`・`/api/login`・JWT・同じオリジンの `/api` など)は、作り始めたときの記録として残しているだけで、今のリポジトリとは合いません。第 1 版と第 2 版が食い違うときは、いつも第 2 版に従います。

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

---

# 第 2 版: CCv2(SAP Commerce Cloud)+ ヘッドレスに寄せた構成(2026-09-26 〜。第 1 版より優先)

## 目的の追加
- 構成を、SAP Commerce Cloud(CCv2)でヘッドレス(Composable Storefront)を動かすときの形に寄せる。ラボで覚えたことが、実案件の構成図・Cloud Portal の画面・API の URL にそのまま重なるようにする。
- 読み手は「自分で調べて学ぶ」人たちではない。**各部品がどういう仕組みで動いているか**を、1 リクエストの流れ・設定の各行・確かめるコマンドまで、すべて説明する。
- 公開リポジトリなので、SAP の資料の文章は引用しない。構成・呼び方の対応(「CCv2 ではエンドポイントに当たる」など)は書いてよい。コードの識別子に SAP の製品名は使わない。

## 全体の構成(軽量版・本格版で同じ形)
```
ブラウザ
  ↓ http://www.lab.localhost:18080 など(*.localhost は Chrome・Edge・Firefox・curl では設定なしで 127.0.0.1 になる。Safari などは hosts に書く必要がある場合あり)
[cdn-waf]  … クラスタの外の CDN + WAF の役(nginx + ModSecurity)。キャッシュ・WAF・全体のレート制限・セキュリティヘッダ
  ↓
[ingress]  … 入口の振り分け。ホスト名で 3 つのエンドポイントに分ける。エンドポイントごとの IP 制限
             本格版: ingress-nginx(Ingress リソース)。軽量版: ingress 役の nginx コンテナ(同じ振り分けを nginx.conf で書く)
  ├─ www.lab.localhost        → storefront(Angular SSR。CCv2 の JS Storefront に当たる)
  ├─ api.lab.localhost        → api(OCC 風 REST・OAuth・メディア。CCv2 の api aspect に当たる)
  └─ backoffice.lab.localhost → backoffice(管理画面。CCv2 の backoffice aspect に当たる。社内 IP だけ)
     (外に出さない)          worker(定期ジョブ。CCv2 の backgroundProcessing aspect に当たる)
  ↓
[db] PostgreSQL   [search] 軽量版は DB の検索で代用 / 本格版は Solr   [媒体] 画像は api の /medias/ から
[observability] Prometheus・Alertmanager・pager・Grafana・Loki + Alloy / 本格版だけ OpenTelemetry Collector + Tempo(トレース)
```
- ホストのポート: 18080(cdn-waf の入口。3 つのホスト名すべて)、13000 Grafana、19090 Prometheus、19093 Alertmanager、19094 pager。
- api・backoffice・worker は **同じイメージ**を、環境変数 `ASPECT=api|backoffice|backgroundProcessing` で役割を変えて動かす(CCv2 の aspect と同じ考え方)。

## CCv2 との対応(仕組みページの軸。この表の言葉で説明する)
| ラボ | CCv2 / Composable Storefront で当たるもの |
|---|---|
| cdn-waf | 外部の CDN / WAF(例: CloudFront + AWS WAF) |
| ingress のホスト名ごとの振り分け | Cloud Portal の「エンドポイント」 |
| ingress の IP 制限 | エンドポイントの「IP フィルタ」 |
| storefront | JS Storefront(SSR) |
| api の `/occ/v2/...` | OCC の REST API |
| api の `/authorizationserver/oauth/token` | OAuth の認可サーバー |
| cms/pages の JSON から画面を組み立てる | CMS 駆動の描画(ヘッドレスの核心) |
| `ASPECT` | aspect(api・backoffice・backgroundProcessing) |
| `manifest.json` と `tools/manifest/render.mjs` | CCv2 の manifest.json とビルド |
| `k8s/generated/envs/d1|s1|p1`(render.mjs が作る kustomize の差分) | 環境 d1 / s1 / p1 |
| Prometheus・Grafana・Tempo | Dynatrace(APM) |
| Loki + Grafana | OpenSearch(ログ) |
| worker の定期ジョブ | CronJob(backgroundProcessing で動く) |

## api(apps/api)の約束(storefront・backoffice・worker・演習が使う)
- 共通: Node.js 24、Express 5、pg、prom-client、pino(JSON ログ。`trace_id` を含める)、OpenTelemetry(`OTEL_EXPORTER_OTLP_ENDPOINT` があるときだけ送る。http・express・pg を自動計測)。
- サイト ID(baseSiteId)は `samplestore`。すべて `/occ/v2/samplestore/...`。
- `fields` パラメータ: `BASIC`・`DEFAULT`(既定)・`FULL`。返す項目の量が変わる(性能の演習で使う)。
- エンドポイント(ASPECT=api のとき):
  - `GET /occ/v2/samplestore/products/search?query=&currentPage=0&pageSize=20&sort=&fields=` → `{ products:[{code,name,summary,price:{currencyIso,value,formattedValue},images:[{url,altText,format}],stock:{stockLevelStatus,stockLevel}}], pagination:{currentPage,pageSize,totalPages,totalResults}, sorts:[...], freeTextSearch }`。検索の実体は `SEARCH_PROVIDER=db|solr`。
  - `GET /occ/v2/samplestore/products/{code}?fields=` → 商品 1 件(FULL は description・categories・classifications も)。無ければ 404 `{errors:[{type:"UnknownIdentifierError",message}]}`。
  - `GET /occ/v2/samplestore/cms/pages?pageType=ContentPage&pageLabelOrId=homepage` / `?pageType=ProductPage&code=...` / `?pageType=CategoryPage&code=...` → `{uid,name,template,title,contentSlots:{contentSlot:[{slotId,position,components:{component:[{uid,typeCode,name,...属性}]}}]}}`。部品の型(typeCode): `SimpleBannerComponent`(headline,content,media.url,urlLink)、`CMSParagraphComponent`(content)、`ProductCarouselComponent`(title,productCodes)、`ProductDetailsComponent`(商品詳細の本体。属性なし)、`SearchBoxComponent`(placeholder)、`NavigationComponent`(links)。`CMSParagraphComponent` の content は HTML の断片として扱い、storefront は Angular のサニタイズを通して描く。
  - `GET /occ/v2/samplestore/users/current/orders` → `{orders:[{code,placed,status,total:{value,formattedValue},entries:[{product:{code,name},quantity,totalPrice:{formattedValue}}]}]}`(Bearer 必須)。`GET /occ/v2/samplestore/users/current/orders/{code}`(自分の注文でなければ 404。`idorBug` で確かめなくなる)。
  - `POST /authorizationserver/oauth/token`(`application/x-www-form-urlencoded`。`grant_type=password&client_id=storefront&username=&password=`)→ `{access_token,token_type:"bearer",expires_in:900}`。クライアント `storefront`(公開クライアント、ROLE_CLIENT 相当)だけ受ける。失敗はパスワード違いが 400 `{error:"invalid_grant"}`、知らないクライアントが 401 `{error:"invalid_client"}`。パスワードグラントは学習用の選択(今の OAuth の指針 RFC 9700 では使わない。SAP Commerce Cloud の公開クライアントは認可コード + PKCE が標準)であることを、ドキュメントに書き添える。
  - `GET /medias/{code}.svg`(商品画像。長くキャッシュしてよい `Cache-Control: public, max-age=86400`)。
  - CORS: `Origin` が `CORS_ALLOWED_ORIGINS`(既定 `http://www.lab.localhost:18080`)に一致するときだけ `Access-Control-Allow-Origin` を返す(CCv2 の corsfilter の設定と同じ考え方)。
  - `/healthz`・`/readyz`・`/metrics`、カオス `GET/POST /admin/chaos`(外には出さない。ingress で遮断)。カオスは第 1 版と同じ(latencyMs・errorRate・leakMb・idorBug・sqliBug。sqliBug は検索の `query` に効く)。
- ASPECT=backoffice: `GET /backoffice/` で管理画面(サーバーで描く HTML。ログイン `admin`/`admin`、商品の価格・在庫の変更、トップのバナーの文言の変更)。変更は同じ DB に入り、storefront に反映される(キャッシュが効いている間は反映が遅れる → キャッシュの演習)。
- ASPECT=backgroundProcessing(worker): 外には出さない(エンドポイントを持たない。`/metrics`・`/healthz` は Prometheus などが中から使う)。定期ジョブ 2 本: `stockImportJob`(60 秒ごと、在庫を少し変える = 基幹からの在庫連携の代わり)、`searchIndexJob`(60 秒ごと。solr のときは Solr に全件を入れ直す。db のときは何もしないで成功を記録)。指標 `cronjob_runs_total{job,result}`・`cronjob_last_success_timestamp_seconds{job}`。カオス `CHAOS_CRON_FAIL=true` でジョブを失敗させられる。
- DB の表は起動時に作る。作るのは ASPECT=api のときだけ(他は待つ)。

## storefront(apps/web)の約束
- Angular 21 SSR。第 1 版のスイッチ(RENDER_MODE・SSR_WINDOW_BUG・SSR_TIMEOUT_MS・/metrics・JSON ログ・X-Render-Mode)は残す。
- **CMS 駆動の描画**: 画面ごとに `cms/pages` を取り、スロットの部品の `typeCode` を見て Angular の部品を当てはめて並べる(対応表 `typeCode → コンポーネント` を 1 か所に持つ。知らない typeCode は描かずにログに出す)。これがヘッドレスの核心なので、コードのコメントで丁寧に説明する。
- ルート: `/`(homepage)、`/search?q=`、`/p/:code`(商品詳細。アクセラレーター由来で Composable Storefront も互換のために受け付ける URL の形に合わせる)、`/c/:code`(分類ページ。CategoryPage)、`/login`、`/my-account/orders`(遅延読み込み)。
- API: SSR 中は `API_INTERNAL_URL`(既定 `http://api:3001`)、ブラウザからは `API_PUBLIC_URL`(既定 `http://api.lab.localhost:18080`、**別オリジン**なので CORS が効く)。画像も `API_PUBLIC_URL/medias/...`。ログインは OAuth のトークン(パスワードグラント)をメモリと sessionStorage に持つ。
- OpenTelemetry: `OTEL_EXPORTER_OTLP_ENDPOINT` があるときだけ、SSR サーバーの受信と api 呼び出しをトレースに載せ、`traceparent` を api に渡す。

## manifest.json(リポジトリ直下)と環境
- CCv2 の manifest の考え方をまねた、このラボ独自の形(SAP の書式をそのまま写さない)。中身: アプリ(storefront の SSR 設定)、aspect(api・backoffice・backgroundProcessing と、それぞれの環境変数・台数)、エンドポイント(www・api・backoffice のホスト名・行き先・IP フィルタ)、環境(d1・s1・p1 の違い: 台数、IP フィルタ、キャッシュの有無など)。
- `tools/manifest/render.mjs` が manifest.json を読んで、本格版の Kubernetes の Deployment(aspect ごと)と Ingress と環境ごとの kustomize の差分(`k8s/generated/`)を作る。軽量版は compose を手で合わせる(render の出力と食い違わないことを確認する)。「manifest に 1 行書くと、裏でこういうリソースができる」を見せるのが目的。
- 本格版は `LAB_ENV=d1|s1|p1 k8s/up.sh`(既定 p1)。生成物は `k8s/generated/base/` と `k8s/generated/envs/d1|s1|p1/`。cdn-waf はクラスタの外のコンテナ `lab-cdn-waf` として `k8s/up.sh` が起動し、キャッシュの ON/OFF は ConfigMap `lab-environment` の `EDGE_CACHE` に従う。

## 観測(第 1 版に追加)
- 本格版: OpenTelemetry Collector → Tempo。Grafana に Tempo のデータソース。Loki のログの `trace_id` から Tempo に飛べる(derived field)。ダッシュボード「サンプルストア 1 リクエストの道筋」。
- 軽量版: トレースの代わりに、cdn-waf が作る `X-Request-Id` を cdn-waf・ingress のログ(`request_id`)と storefront・api のログ(`reqId`)に残し、1 リクエストを部品をまたいで追えるようにする。
- 両版: worker の定期ジョブの失敗・止まりを検知するアラート(`cronjob_last_success_timestamp_seconds` が 5 分以上古い)。

## ドキュメント(docs/)の追加
- `docs/how-it-works/`: 部品ごとの「仕組み」ページ(13 本): 全体の流れ(クリックから DB まで)、cdn-waf、ingress(エンドポイントと IP フィルタ)、Kubernetes の基本(Pod・Deployment・Service・プローブ)、storefront の SSR、ヘッドレスと CMS 駆動の描画、api(OCC・fields・CORS)、OAuth のトークン、aspect と worker(backgroundProcessing)、検索(Solr と索引)、DB とバックアップ、観測(指標・ログ・トレース)、manifest と環境(d1/s1/p1)。各ページ: 1 リクエストの流れ(図)/ 設定の各行の意味 / 確かめるコマンド / CCv2 ではどこに当たるか / よくある誤解。
- 既存の演習 19 本は新しい URL・ホスト名に直す。演習を 2 本足す: 「ネットワーク-3 Ingress とエンドポイント」「ヘッドレス-1 CMS の JSON が画面になるまで」。
