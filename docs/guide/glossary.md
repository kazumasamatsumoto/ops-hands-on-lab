# 用語集

::: tip 3 行まとめ
- 演習と設計書に出てくる言葉を、分野ごとに集めました(全 146 語)。第 2 版で、CCv2 + ヘッドレスの形に合わせた言葉(エンドポイント、aspect、OCC、OAuth、トレースなど)を足しました。
- どの言葉も「一言でいうと」「たとえ」「ラボで見られる場所」の 3 つで説明しています。
- 言葉ごとに英数字の目印(アンカー)を付けています。例: `/guide/glossary#burn-rate`(バーンレート)、`#ssr`、`#endpoint`、`#aspect`。演習ページや設計書から、ここに飛んでこられます。
:::

言葉の並びは「土台 → 画面 → API → 入口 → 見張り → 試験 → 性能 → 障害 → 復旧 → 守り」の順です。ページ内の検索(Ctrl + F / ⌘ + F)も使ってください。

## 1. 土台(インフラ)

### コンテナ {#container}
- **一言でいうと**: アプリと、それが動くのに必要な物をまとめて箱に入れ、どこでも同じように動かす仕組み。
- **たとえ**: 引っ越し用の段ボール。中身ごと運べば、新しい家でもすぐ使える。
- **ラボで見られる場所**: `docker compose ps` で並ぶ db・api・backoffice・worker・storefront・ingress・cdn-waf など。

### イメージ {#image}
- **一言でいうと**: コンテナの「元の型」。ここから何個でも同じコンテナを作れる。
- **たとえ**: たい焼きの型。
- **ラボで見られる場所**: [api の Dockerfile](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/apps/api/Dockerfile) から作る `lab/api:local`(api・backoffice・worker の 3 役がこの 1 つのイメージを使う)と、storefront の `lab/web:local`。

### マルチステージビルド {#multi-stage-build}
- **一言でいうと**: イメージを 2 段階で作り、2 段目には動かすのに必要な物だけを入れる作り方。
- **たとえ**: 台所で料理して、お皿に盛った料理だけを食卓に出す。
- **ラボで見られる場所**: api(apps/api)と storefront(apps/web)の Dockerfile。

### docker compose {#docker-compose}
- **一言でいうと**: 複数のコンテナの起動をまとめて 1 つのファイルに書き、1 コマンドで動かす道具。
- **たとえ**: 料理のレシピと段取り表を 1 枚にまとめたもの。
- **ラボで見られる場所**: [docker-compose.yml](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/docker-compose.yml)(軽量版)。

### Kubernetes {#kubernetes}
- **一言でいうと**: たくさんのコンテナを、決めた台数で動かし続け、壊れたら作り直してくれる仕組み。
- **たとえ**: 決まった人数を必ず配置してくれる、人手の管理係。
- **ラボで見られる場所**: 本格版(k8s/)。

### kind {#kind}
- **一言でいうと**: Docker の中に小さな Kubernetes を作る道具。練習用。
- **たとえ**: 本物の厨房を小さくした、練習用のおままごとキッチン。
- **ラボで見られる場所**: 本格版の起動([準備と起動](/guide/setup))。

### Pod {#pod}
- **一言でいうと**: Kubernetes が動かす最小の単位。中に 1 つ(以上)のコンテナが入る。
- **たとえ**: 店に配置される店員 1 人。
- **ラボで見られる場所**: 本格版の `kubectl get pods`。

### レプリカ {#replica}
- **一言でいうと**: 同じ Pod を何個動かすかの数。
- **たとえ**: レジを何台開けるか。
- **ラボで見られる場所**: [台数を増やして耐える](/exercises/13-perf-scale-out)。

### マニフェスト {#manifest}
- **一言でいうと**: Kubernetes に「こういう状態にして」と伝える設定ファイル(YAML)。
- **たとえ**: 店長に渡す「今日の配置表」。
- **ラボで見られる場所**: 本格版の [k8s/generated/](https://github.com/kazumasamatsumoto/ops-hands-on-lab/tree/main/k8s/generated)(Deployment・Service・Ingress。[manifest.json](#manifest-json) から作る)。

### IaC {#iac}
- **一言でいうと**: Infrastructure as Code。環境の作り方を手順書ではなく、そのまま実行できるファイルで持つこと。
- **たとえ**: 口伝えのレシピを、分量まで書いたレシピカードにする。
- **ラボで見られる場所**: docker-compose.yml、manifest.json、k8s/generated/ のマニフェスト。

### 環境変数 {#env-var}
- **一言でいうと**: アプリの外から渡す設定値。コードを変えずに動きを変えられる。
- **たとえ**: 同じ炊飯器で、水の量のつまみだけ変える。
- **ラボで見られる場所**: `ASPECT`、`RENDER_MODE`、`SSR_TIMEOUT_MS`、`EDGE_CACHE`、`CORS_ALLOWED_ORIGINS`、`BACKOFFICE_IP_ALLOWLIST` など。

### ConfigMap {#configmap}
- **一言でいうと**: Kubernetes で、秘密でない設定値をまとめて置く場所。
- **たとえ**: 掲示板に貼った連絡事項。
- **ラボで見られる場所**: 本格版の `lab-environment`(環境ごとの `LAB_ENV`・`EDGE_CACHE`・`SEARCH_PROVIDER`)。[設定値とシークレット](/exercises/06-infra-config-and-secrets)。

### Secret(シークレット) {#secret}
- **一言でいうと**: パスワードや署名鍵など、秘密の設定値を置く場所。
- **たとえ**: 鍵のかかる引き出し。
- **ラボで見られる場所**: 軽量版では docker-compose.yml の `PGPASSWORD`・`BACKOFFICE_PASSWORD`(見本の値)。本格版では Secret `lab-secrets`(manifest.json には名前と鍵の名前だけを書く)。

### ヘルスチェック {#health-check}
- **一言でいうと**: 「元気か?」を機械が定期的に聞く仕組み。
- **たとえ**: 見回りの人が「大丈夫?」と声をかける。
- **ラボで見られる場所**: api の `/healthz` と `/readyz`、docker-compose.yml の `healthcheck`。

### liveness プローブ {#liveness-probe}
- **一言でいうと**: 生きているか(固まっていないか)の確認。だめなら作り直す。
- **たとえ**: 呼びかけに返事があるか。
- **ラボで見られる場所**: api の `/healthz`(DB を見ない)。

### readiness プローブ {#readiness-probe}
- **一言でいうと**: 仕事を受けられる準備ができているかの確認。だめなら客を送らない(作り直さない)。
- **たとえ**: 開店準備ができた店員だけをレジに立たせる。
- **ラボで見られる場所**: api の `/readyz`(DB に届かなければ 503)。

### ローリング更新 {#rolling-update}
- **一言でいうと**: 動かしたまま、1 台ずつ新しい版に入れ替えること。
- **たとえ**: 営業しながら、レジを 1 台ずつ新しい機械に替える。
- **ラボで見られる場所**: [止めずに版を上げる](/exercises/05-infra-rolling-update)。

### ロールバック {#rollback}
- **一言でいうと**: 新しい版に問題があったとき、前の版に戻すこと。
- **たとえ**: 新メニューが不評なら、昨日のメニューに戻す。
- **ラボで見られる場所**: [止めずに版を上げる](/exercises/05-infra-rolling-update)。

### 穏やかな停止(グレースフルシャットダウン) {#graceful-shutdown}
- **一言でいうと**: 止める合図を受けたら、新しい客は断り、受付中の処理を終えてから止まること。
- **たとえ**: 閉店時刻に、店内のお客さんの会計を済ませてからシャッターを下ろす。
- **ラボで見られる場所**: api・backoffice・worker に共通の [http-common.js](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/apps/api/src/http-common.js) の `SIGTERM` の処理(最大 10 秒待つ)。

### メモリ上限 {#memory-limit}
- **一言でいうと**: 1 つのコンテナが使ってよいメモリの上限。超えると強制終了される。
- **たとえ**: 1 人あたりの机の広さ。はみ出したら退場。
- **ラボで見られる場所**: docker-compose.yml の `mem_limit`(api は 256MB)。

### OOMKilled {#oomkilled}
- **一言でいうと**: メモリの上限を超えて、強制終了されたこと(Out Of Memory)。
- **たとえ**: 荷物を積みすぎて、エレベーターから降ろされる。
- **ラボで見られる場所**: [メモリ不足で再起動を繰り返す](/exercises/15-incident-crashloop)。

### CrashLoopBackOff {#crashloopbackoff}
- **一言でいうと**: 起動してはすぐ落ちる、を繰り返し、Kubernetes が再起動の間隔をだんだん空けている状態。
- **たとえ**: 何度起こしてもすぐ寝てしまうので、起こす間隔を空けていく。
- **ラボで見られる場所**: 本格版の [再起動を繰り返す](/exercises/15-incident-crashloop)。

### HPA {#hpa}
- **一言でいうと**: 混み具合に合わせて、Pod の数を自動で増やしたり減らしたりする仕組み。
- **たとえ**: 行列が伸びたら、自動でレジを開ける。
- **ラボで見られる場所**: ラボには入れていません(CPU の使用量を集める metrics-server が別に要るため。台数は manifest と手の操作で変えます)。[台数を増やして耐える](/exercises/13-perf-scale-out)。

### aspect {#aspect}
- **一言でいうと**: 同じアプリ(同じイメージ)を、役割ごとに分けて動かすときの「役」の名前。ラボでは api・backoffice・backgroundProcessing の 3 つ(CCv2 にはほかに、ヘッドレスでは使わない従来型の画面用の accstorefront や、初期化・更新の作業用の admin もあります)。
- **たとえ**: 同じ店員(イメージ)に、レジ係・事務係・倉庫係の名札(役)を付けて配置する。
- **ラボで見られる場所**: 環境変数 `ASPECT=api|backoffice|backgroundProcessing`([main.js](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/apps/api/src/main.js))。CCv2 の aspect に当たる。

### backgroundProcessing {#background-processing}
- **一言でいうと**: お客さん向けの画面や API を受け持たず、裏の仕事(定期ジョブ)を受け持つ aspect。ラボの worker は定期ジョブだけですが、CCv2 では既定の設定で、ここ(と backoffice の aspect)で管理用の画面(hAC)も動きます。
- **たとえ**: お店の奥の倉庫係。お客さんには会わないが、在庫の数を毎日合わせている。
- **ラボで見られる場所**: worker(`ASPECT=backgroundProcessing`)。入口(エンドポイント)を持たず外には出しません。Prometheus が中から `/metrics` を集めるだけです。

### CronJob(定期ジョブ) {#cronjob}
- **一言でいうと**: 決まった間隔・時刻に自動で動く仕事。
- **たとえ**: 毎朝 9 時に届く新聞。止まっても、しばらく誰も気づかない。
- **ラボで見られる場所**: worker の `stockImportJob`・`searchIndexJob`(`CRON_INTERVAL_SECONDS`、既定 60 秒)。止まりはアラート `CronJobStale` で見張る。

### manifest(manifest.json) {#manifest-json}
- **一言でいうと**: アプリ・aspect・台数・環境変数・エンドポイント・IP フィルタ・環境の違いを 1 か所にまとめた「構成の設計図」。
- **たとえ**: 家の間取り図。これを大工さん(ビルドとデプロイ)に渡すと、家(Kubernetes のリソース)が建つ。
- **ラボで見られる場所**: [manifest.json](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/manifest.json)(このラボ独自の簡単な形)と、そこから k8s/generated/ を作る [render.mjs](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/tools/manifest/render.mjs)。CCv2 の manifest.json の考え方をまねている。

### d1・s1・p1(環境) {#environments}
- **一言でいうと**: 開発(d1)・ステージング(s1)・本番(p1)の 3 つの環境の名前。同じイメージを、台数や IP フィルタなどの設定だけ変えて動かす。
- **たとえ**: 同じ料理を、試食用(d1)・リハーサル(s1)・本番の宴会(p1)で出す。レシピは同じで、量と客だけが違う。
- **ラボで見られる場所**: [manifest.json](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/manifest.json) の `environments`。d1・s1 は www・api も社内だけ、p1 はお店を誰でも。本格版は `LAB_ENV=d1|s1|p1 k8s/up.sh`(既定 p1。切り替えるだけなら `LAB_SKIP_BUILD=1` も付ける)。

### kustomize {#kustomize}
- **一言でいうと**: 共通の YAML(base)に、環境ごとの差分だけを重ねて、最終的な YAML を組み立てる道具。kubectl に入っている。
- **たとえ**: 基本の制服に、店舗ごとの名札とワッペンだけを付け足す。
- **ラボで見られる場所**: `kubectl kustomize k8s/generated/envs/p1`(クラスタが無くても、組み立てた結果が見られる)。

### オーバーレイ {#overlay}
- **一言でいうと**: kustomize で、base の上に重ねる「環境ごとの差分」の置き場所。
- **たとえ**: 透明なシートに差分だけ書いて、元の図面に重ねる。
- **ラボで見られる場所**: [k8s/generated/envs/](https://github.com/kazumasamatsumoto/ops-hands-on-lab/tree/main/k8s/generated/envs) の d1・s1・p1(台数・ConfigMap `lab-environment`・環境変数と IP フィルタのパッチ)。

## 2. 画面(FE)

### SSR {#ssr}
- **一言でいうと**: サーバー側で画面の HTML を作って返すこと(Server-Side Rendering)。
- **たとえ**: 料理を厨房で盛り付けてから出す。お客さんはすぐ食べられる。
- **ラボで見られる場所**: storefront(`RENDER_MODE=ssr`)。[SSR と CSR](/exercises/01-fe-ssr-vs-csr)。

### CSR {#csr}
- **一言でいうと**: 空の HTML を返し、ブラウザの JS が画面を作ること(Client-Side Rendering)。
- **たとえ**: 材料とレシピを渡して、お客さんの席で組み立ててもらう。
- **ラボで見られる場所**: `RENDER_MODE=csr`、応答ヘッダ `X-Render-Mode: csr`。

### SPA {#spa}
- **一言でいうと**: 最初に 1 回ページを読み込み、あとの画面の切り替えはブラウザの JS で行うアプリ。
- **たとえ**: 1 冊のノートのページをめくるだけで、別の本を取りに行かない。
- **ラボで見られる場所**: storefront(Angular)。

### ハイドレーション {#hydration}
- **一言でいうと**: サーバーが作った HTML をそのまま使い、ブラウザは「動き」だけを付け足すこと。
- **たとえ**: 盛り付け済みの料理に、席でソースだけかける。
- **ラボで見られる場所**: storefront の [app.config.ts](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/apps/web/src/app/app.config.ts)。

### TransferState {#transferstate}
- **一言でいうと**: サーバーで取った API の結果を HTML に添えて渡し、ブラウザが同じ API をもう一度呼ばずに済むようにする仕組み。
- **たとえ**: 前の担当者からの申し送りメモ。
- **ラボで見られる場所**: storefront の api.service.ts(CMS と商品は申し送る、注文は申し送らない)。

### フォールバック {#fallback}
- **一言でいうと**: 本来のやり方が間に合わないとき、代わりのやり方に逃げること。
- **たとえ**: 厨房が混んでいたら、材料を渡して席で組み立ててもらう。
- **ラボで見られる場所**: SSR が 3000ms で間に合わないと空の HTML を返す(`X-Render-Mode: fallback`)。

### 遅延読み込み {#lazy-loading}
- **一言でいうと**: 画面を開いたときに、その画面の部品だけを後から読み込むこと。
- **たとえ**: 使うときに倉庫から取ってくる。最初は店頭に置かない。
- **ラボで見られる場所**: 注文履歴 `/my-account/orders`([app.routes.ts](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/apps/web/src/app/app.routes.ts))。

### チャンク {#chunk}
- **一言でいうと**: ビルドで分けられた JS のファイルの 1 切れ。
- **たとえ**: 大きなケーキを切り分けた 1 切れ。
- **ラボで見られる場所**: [遅延読み込みと JS の予算](/exercises/03-fe-lazy-loading)。

### JS の予算(budgets) {#budgets}
- **一言でいうと**: 最初に読み込む JS・CSS の大きさの上限。超えるとビルドが失敗する。
- **たとえ**: 旅行の荷物の重さ制限。超えたら飛行機に乗れない。
- **ラボで見られる場所**: [angular.json](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/apps/web/angular.json)(400kB で警告、450kB で失敗)。

### SEO {#seo}
- **一言でいうと**: 検索エンジンに、ページの中身を正しく伝えるための工夫。
- **たとえ**: 図書館の目録に、本の内容を正しく載せてもらう。
- **ラボで見られる場所**: SSR と CSR の HTML の違い(`curl` で見る)。

### ヘッドレス {#headless}
- **一言でいうと**: 画面(storefront)と、商品や注文を扱う仕組み(api)を分け、API だけでつなぐ作り方。画面の側は自由に作り直せる。
- **たとえ**: 頭(画面)と体(お店の仕組み)を別々に作り、首(API)でつなぐ。頭だけ取り替えられる。
- **ラボで見られる場所**: storefront(Angular)と api(`/occ/v2/...`)。CCv2 で Composable Storefront を使う形に当たる。

### CMS 駆動の描画 {#cms-driven-rendering}
- **一言でいうと**: 「どの画面に、どの部品を、どの順で置くか」を CMS のデータ(JSON)で決め、storefront はそれを見て部品を並べるだけにする作り方。ヘッドレスの核心。
- **たとえ**: 料理人(storefront)は、毎日届く献立表(CMS の JSON)どおりに皿を並べる。献立を変えるのに料理人の教育(ビルド)は要らない。
- **ラボで見られる場所**: `GET /occ/v2/samplestore/cms/pages?pageType=ContentPage&pageLabelOrId=homepage` と [cms-page.ts](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/apps/web/src/app/cms/cms-page.ts)。[CMS の JSON が画面になるまで](/exercises/21-headless-cms)。

### スロット {#slot}
- **一言でいうと**: CMS のページの中の「部品の置き場所」。1 つのスロットに 0 個以上の部品が入る。
- **たとえ**: お弁当箱の仕切り。どの仕切りに何を詰めるかは献立で決まる。
- **ラボで見られる場所**: `contentSlots.contentSlot[]` の `position`(`Section1`〜`Section4`・`Summary`・`CrossSelling` など)。HTML では `<div class="cms-slot" data-slot="Section1">`。

### typeCode {#typecode}
- **一言でいうと**: CMS の部品の「種類」を表す名前。storefront はこれを見て、どの画面部品で描くかを決める。
- **たとえ**: 料理の札(「焼き魚」「サラダ」)。札を見て、どの皿に盛るかを決める。
- **ラボで見られる場所**: `SimpleBannerComponent`・`ProductCarouselComponent` など。対応表は [cms-mapping.ts](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/apps/web/src/app/cms/cms-mapping.ts) の 1 か所だけ。知らない typeCode は描かずにログ `cms_unknown_component` を出す。

### JS Storefront {#js-storefront}
- **一言でいうと**: ブラウザで動く JavaScript の画面を、サーバーでも描画(SSR)して配るお店の画面の部品。
- **たとえ**: お店のショーウィンドウ。飾り付け(HTML)を先に済ませてから見せる。
- **ラボで見られる場所**: storefront(`apps/web`、ポート 4000)。CCv2 の JS Storefront に当たる。

## 3. API(BE)

### API {#api}
- **一言でいうと**: 画面などの別のプログラムが、データを取ったり頼んだりするための窓口。
- **たとえ**: 役所の窓口。決まった書類を出すと、決まった答えが返る。
- **ラボで見られる場所**: `/occ/v2/samplestore/products/search`、`/occ/v2/samplestore/cms/pages`、`/occ/v2/samplestore/users/current/orders` など([OCC](#occ))。

### 認証 {#authentication}
- **一言でいうと**: 「あなたは誰か」を確かめること。
- **たとえ**: 入口で社員証を見せる。
- **ラボで見られる場所**: `POST /authorizationserver/oauth/token`([OAuth](#oauth) のパスワードグラント)。

### 認可 {#authorization}
- **一言でいうと**: 「あなたはそれをしてよいか」を確かめること。
- **たとえ**: 社員証があっても、他の部署の金庫は開けられない。
- **ラボで見られる場所**: 注文 1 件 `GET /occ/v2/samplestore/users/current/orders/{code}` で持ち主を確かめる処理(持ち主でなければ 404)。

### JWT {#jwt}
- **一言でいうと**: ログインした証拠を、改ざんできない形で書いた文字列。
- **たとえ**: 割り印つきの入館証。有効期限が書いてある。
- **ラボで見られる場所**: 第 2 版のラボでは使っていません。ラボのトークンは中身の無いランダムな文字列です([アクセストークン](#access-token))。JWT は持ち主や期限を自分の中に書いていて、DB を引かずに署名だけで確かめられる代わりに、期限前に取り消しにくい・大きい、という違いがあります(署名だけの JWT は、中身を誰でも読めます)。

### IDOR {#idor}
- **一言でいうと**: 番号を変えるだけで他人のデータが見えてしまう、認可の抜け。
- **たとえ**: ロッカーの番号札を書き換えたら、他人のロッカーが開いた。
- **ラボで見られる場所**: `idorBug` スイッチ。[API と認可の事故](/exercises/04-be-api-and-authz)。

### SQL インジェクション {#sql-injection}
- **一言でいうと**: 入力欄に SQL の一部を混ぜて、データベースへの命令を書き換える攻撃。
- **たとえ**: 注文票の空欄に「ついでに金庫も開けて」と書き足す。
- **ラボで見られる場所**: `sqliBug` スイッチ。[WAF が攻撃を止める](/exercises/17-sec-waf)。

### プレースホルダ {#placeholder}
- **一言でいうと**: SQL の中に値の「置き場所」だけ書き、値は別に渡すこと。値が命令として読まれない。
- **たとえ**: 決まった枠にしか書けない注文票。枠の外には何も書けない。
- **ラボで見られる場所**: api の検索([occ/search.js](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/apps/api/src/occ/search.js) の `ILIKE $1`)。

### パスワードのハッシュ {#password-hash}
- **一言でいうと**: パスワードをそのまま保存せず、元に戻せない形に変えて保存すること。
- **たとえ**: 合言葉を覚える代わりに、合言葉から作った指紋だけを控えておく。
- **ラボで見られる場所**: api の db.js(scrypt)。

### コネクションプール {#connection-pool}
- **一言でいうと**: データベースへの接続を何本か作っておき、使い回す仕組み。
- **たとえ**: 貸し出し用の傘立て。本数に限りがある。
- **ラボで見られる場所**: api の db.js(最大 10 本、接続待ちは 3 秒まで)。

### OCC {#occ}
- **一言でいうと**: お店の商品・カート・注文などを扱う REST API の形。URL が `/occ/v2/<サイト ID>/...` で始まる。
- **たとえ**: 決まった書式の注文用紙。書式が決まっているので、どの画面からでも同じように頼める。
- **ラボで見られる場所**: api の `/occ/v2/samplestore/products/search`・`/products/{code}`・`/cms/pages`・`/users/current/orders`。CCv2 の OCC の REST API に当たる(ラボは「OCC 風」の簡単な物)。

### baseSiteId {#base-site-id}
- **一言でいうと**: URL に入れる「どのお店(サイト)か」の ID。1 つの API で複数のお店を持てるようにするため。
- **たとえ**: 同じ本社に届く郵便の宛名に書く「〇〇支店」。
- **ラボで見られる場所**: `samplestore`(`/occ/v2/samplestore/...`)。

### fields {#fields}
- **一言でいうと**: API に「どれくらいの項目を返してほしいか」を伝えるパラメータ。
- **たとえ**: 定食の「ご飯少なめ・普通・大盛り」。
- **ラボで見られる場所**: `fields=BASIC`・`DEFAULT`(既定)・`FULL`。検索 20 件で BASIC は約 3KB、FULL は約 25KB。

### OAuth {#oauth}
- **一言でいうと**: 「どのアプリが、誰の代わりに、何をしてよいか」を、パスワードの代わりにトークンで伝える決まり。
- **たとえ**: 遊園地の入口で身分を見せて、腕に巻くリストバンドをもらう。中のアトラクションはバンドだけ見る。
- **ラボで見られる場所**: `POST /authorizationserver/oauth/token`([oauth.js](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/apps/api/src/occ/oauth.js))。CCv2 の OAuth の認可サーバーに当たる。

### パスワードグラント {#password-grant}
- **一言でいうと**: 利用者の名前とパスワードを送って、アクセストークンをもらう OAuth のもらい方。
- **たとえ**: 受付で名前と合言葉を言うと、その場でリストバンドがもらえる。
- **ラボで見られる場所**: `grant_type=password&client_id=storefront&username=alice&password=password`。
- **注意**: 仕組みが分かりやすいのでラボで使っていますが、今の OAuth の安全の指針(RFC 9700)では使わないことになっており、OAuth 2.1 の案からも外されています。SAP Commerce Cloud でも、公開クライアント(Composable Storefront など)は「認可コード + PKCE」でトークンをもらう形が今の標準です。新しく作るときはそちらを選びます。

### 公開クライアント {#public-client}
- **一言でいうと**: 秘密の鍵(client_secret)を持たない OAuth のクライアント。ブラウザで動くアプリは中身を誰でも見られるので、秘密を持てない。
- **たとえ**: 誰でも読める掲示板に貼った申込書。合言葉は書けない。
- **ラボで見られる場所**: `client_id=storefront`(ほかのクライアントは 401 `invalid_client`)。ラボは公開クライアントでパスワードグラントを受けていますが、実際の SAP Commerce Cloud の新しい認可サーバー(JDK 21 の版)では、公開クライアントが最初にトークンをもらう方法は「認可コード + PKCE」だけで(そのあとの取り直しに更新トークンは使えます)、パスワードグラントは使えません([パスワードグラント](#password-grant)の注意)。

### アクセストークン {#access-token}
- **一言でいうと**: API を呼ぶときに見せる「入ってよい」の印。期限がある。`Authorization: Bearer <トークン>` の形で付ける。
- **たとえ**: リストバンド。期限が来たら使えない。
- **ラボで見られる場所**: 有効 900 秒(15 分)。中身の無いランダムな文字列で、DB には SHA-256 の値と期限だけを置く。storefront はメモリと sessionStorage に持つ。

### Solr {#solr}
- **一言でいうと**: 商品検索のための専用の検索ソフト。あらかじめ作った索引を引くので、DB で探すより速く、日本語の言葉の切り方も工夫できる。
- **たとえ**: 図書館の索引カード。本棚を全部見て回らなくても、カードで場所が分かる。
- **ラボで見られる場所**: 本格版の search(`SEARCH_PROVIDER=solr`、コア `products`、設定は [apps/api/solr/products/conf/](https://github.com/kazumasamatsumoto/ops-hands-on-lab/tree/main/apps/api/solr/products/conf)。Deployment・Service `search:8983`、イメージ `solr:9.10.1-slim`)。軽量版は DB の検索で代用。

### 索引(インデックス) {#search-index}
- **一言でいうと**: 検索しやすい形に並べ直した、データの写し。元のデータ(DB)が変わったら作り直す必要がある。
- **たとえ**: 本の巻末の索引。本文を直したら、索引も直さないとずれる。
- **ラボで見られる場所**: worker の `searchIndexJob` が 60 秒ごとに DB の全商品で作り直す。だから価格を変えても、検索結果に出るまで最大 60 秒遅れる。

### CJK バイグラム {#cjk-bigram}
- **一言でいうと**: 日本語・中国語・韓国語の文を、2 文字ずつ重ねて切って索引にするやり方。単語の区切りが無い言葉でも探せる。
- **たとえ**: 「ノートパソコン」を「ノー・ート・トパ・パソ・ソコ・コン」の札に分けて並べる。
- **ラボで見られる場所**: Solr の [schema.xml](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/apps/api/solr/products/conf/schema.xml) の `text_cjk`(全角・半角の違いも吸収する)。

## 4. 入口(ネットワーク)

### オリジン {#origin}
- **一言でいうと**: 「http と住所とポート番号」の組。ブラウザはこれが同じかどうかで安全の判断をする。
- **たとえ**: 同じ建物の同じ部屋かどうか。
- **ラボで見られる場所**: 画面は `http://www.lab.localhost:18080`、API は `http://api.lab.localhost:18080`。ホスト名が違うので**別のオリジン**です([CORS](#cors) が効く)。

### リバースプロキシ {#reverse-proxy}
- **一言でいうと**: アプリの前に立ち、リクエストを受けて奥のアプリへ振り分ける係。
- **たとえ**: ビルの受付。用件を聞いて担当の部署へ案内する。
- **ラボで見られる場所**: cdn-waf と ingress(どちらも nginx)。

### CDN {#cdn}
- **一言でいうと**: 利用者の近くに置いたサーバーで、ページや画像を代わりに返す仕組み。
- **たとえ**: 本店の商品を、駅前の支店にも並べておく。
- **ラボで見られる場所**: cdn-waf のキャッシュが CDN の代わり(CCv2 の案件では別に契約する CDN に当たる)。

### キャッシュ {#cache}
- **一言でいうと**: 一度作った答えを取っておき、同じ質問にはそれを返すこと。
- **たとえ**: よく出る料理を作り置きしておく。
- **ラボで見られる場所**: cdn-waf が画面(`/`・`/p/…`・`/search`)と api の商品・CMS を 30 秒、画像 `/medias/` を 1 日ためる。[前段のキャッシュ](/exercises/07-nw-cache)。

### TTL {#ttl}
- **一言でいうと**: 取っておいた答えを使ってよい時間(Time To Live)。
- **たとえ**: 作り置きの賞味期限。
- **ラボで見られる場所**: cdn-waf の `proxy_cache_valid 200 30s`(画像は `1d`)。

### X-Cache-Status {#x-cache-status}
- **一言でいうと**: cdn-waf がキャッシュを使ったかどうかを示す応答ヘッダ。HIT(使った)・MISS(無かった)・BYPASS(使わない決まり)など。
- **たとえ**: 料理に付いた「作り置き」「作りたて」の札。
- **ラボで見られる場所**: `curl -sI http://www.lab.localhost:18080/p/100001 | grep -i x-cache`。

### CORS {#cors}
- **一言でいうと**: 別のオリジンの画面から API を呼んでよいかを、API 側が決める仕組み。
- **たとえ**: 「この建物の人からの電話だけ取り次ぎます」という受付の決まり。
- **ラボで見られる場所**: api の `CORS_ALLOWED_ORIGINS`(既定 `http://www.lab.localhost:18080`)。[CORS と IP 制限](/exercises/08-nw-cors-and-ip)。

### IP 制限 {#ip-restriction}
- **一言でいうと**: 送り元の住所(IP アドレス)で、通すか断るかを決めること。
- **たとえ**: 社員用の通用口は、社員証がある人だけ通す。
- **ラボで見られる場所**: ingress の backoffice の [IP フィルタ](#ip-filter)と、`/admin/`・`/metrics`・`/readyz` の遮断(外からは 403)。

### タイムアウト {#timeout}
- **一言でいうと**: 待つ時間の上限。超えたらあきらめる。
- **たとえ**: 電話の呼び出しは 10 回で切る。
- **ラボで見られる場所**: SSR 3000ms、cdn-waf・ingress の接続 3 秒・読み取り 30 秒、DB 接続 3 秒、Solr 2 秒。

### Ingress {#ingress}
- **一言でいうと**: Kubernetes で「このホスト名・パスのリクエストを、どの Service に渡すか」を書く設定。実際に振り分けるのは Ingress コントローラー(ラボは ingress-nginx)。
- **たとえ**: ビルの案内板。「3 階はレジ、4 階は事務所」と書いてあり、受付係がそのとおりに案内する。
- **ラボで見られる場所**: 本格版の [k8s/generated/base/ingress.yaml](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/k8s/generated/base/ingress.yaml)。軽量版は同じ振り分けを ingress コンテナ(nginx)で手書き。

### エンドポイント {#endpoint}
- **一言でいうと**: 外から入ってくる入口 1 つ 1 つ。ホスト名と、その先の行き先(どの aspect か)の組。
- **たとえ**: お店の出入口。お客さん用の正面玄関、業者用の搬入口、社員用の通用口。
- **ラボで見られる場所**: www.lab.localhost → storefront、api.lab.localhost → api、backoffice.lab.localhost → backoffice([manifest.json](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/manifest.json) の `endpoints`)。CCv2 の Cloud Portal の「エンドポイント」に当たる。

### IP フィルタ {#ip-filter}
- **一言でいうと**: エンドポイントごとに「この IP アドレスの範囲からだけ通す」と決める設定。範囲の外からは 403。
- **たとえ**: 社員用の通用口に立つ警備員。社員名簿(許す範囲)に無い人は通さない。
- **ラボで見られる場所**: backoffice の `BACKOFFICE_IP_ALLOWLIST`(既定 `127.0.0.1/32 172.30.89.0/24 172.30.91.0/24`)と manifest.json の `ipFilters.office`。社外の代わりのネットワーク(軽量版 172.30.90.0/24・本格版 172.30.92.0/24)から開くと 403。本格版では `docker run --rm --network lab-kind-outside curlimages/curl:8.16.0 -H 'Host: backoffice.lab.localhost' http://lab-cdn-waf:18080/backoffice/login` で確かめられる。CCv2 のエンドポイントの「IP フィルタ」に当たる。

### X-Forwarded-For {#x-forwarded-for}
- **一言でいうと**: 前段(CDN やプロキシ)が「本当の利用者の IP」を書いて奥に伝えるヘッダ。誰でも偽れるので、信じる相手を決めておく。
- **たとえ**: 受付が書く「ご来客: 〇〇様」のメモ。受付以外が書いたメモは信じない。
- **ラボで見られる場所**: cdn-waf が上書きし、ingress は cdn-waf(172.30.89.10)から来たときだけ信じる(`set_real_ip_from`)。

### プリフライト {#preflight}
- **一言でいうと**: ブラウザが別オリジンに `Authorization` 付きなどで送る前に、`OPTIONS` で「送ってよいか」を先に聞くこと。
- **たとえ**: 訪問の前に「伺ってもよろしいですか」と電話で確かめる。
- **ラボで見られる場所**: 注文(`/users/current/...`)を呼ぶ前の `OPTIONS`。許可していないオリジンなら api が 403。

## 5. 見張り(SRE)

### SRE {#sre}
- **一言でいうと**: サービスを動かし続ける仕事を、ソフトウェアの作り方で進める考え方と役割(Site Reliability Engineering)。
- **たとえ**: 設備の保守を、勘ではなく計器と記録で行う保守係。
- **ラボで見られる場所**: [SRE 方式](/design/architecture/05-sre)。

### 指標(メトリクス) {#metrics}
- **一言でいうと**: あとで数えたり比べたりするための数字。リクエスト数、応答時間、メモリなど。
- **たとえ**: 体温計や体重計の数字。
- **ラボで見られる場所**: storefront・api・backoffice・worker の `/metrics`(外からは閉じていて、Prometheus が中から集める)。

### Prometheus {#prometheus}
- **一言でいうと**: 指標を定期的に集めて保存し、計算やアラートの判定をする道具。
- **たとえ**: 定期的に計器を見て回り、帳簿に書く係。
- **ラボで見られる場所**: http://localhost:19090(5 秒ごとに収集)。

### 記録ルール {#recording-rule}
- **一言でいうと**: よく使う計算を先にしておき、名前を付けて保存しておく決まり。
- **たとえ**: 毎回そろばんを弾かずに済むよう、合計を帳簿の欄に書き写しておく。
- **ラボで見られる場所**: [slo-recording.yml](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/observability/prometheus/rules/slo-recording.yml)。

### アラートルール {#alerting-rule}
- **一言でいうと**: 「この条件になったら知らせる」という決まり。
- **たとえ**: 「水位がここを超えたらサイレン」。
- **ラボで見られる場所**: [slo-alerts.yml](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/observability/prometheus/rules/slo-alerts.yml)。

### SLI {#sli}
- **一言でいうと**: サービスの調子を表す数字(Service Level Indicator)。例: 成功率、p95 応答時間。
- **たとえ**: 健康診断の血圧の値。
- **ラボで見られる場所**: `job:sli_success:ratio_rate5m`(成功率)。

### SLO {#slo}
- **一言でいうと**: SLI の目標(Service Level Objective)。例: 1 か月の成功率 99.9%。
- **たとえ**: 「血圧は 130 未満を保つ」という目標。
- **ラボで見られる場所**: Grafana の「サンプルストア SLO」。

### SLA {#sla}
- **一言でいうと**: お客さまとの約束(契約)としての目標。守れないと返金などがある。SLO はふつう SLA より厳しめに置く。
- **たとえ**: 「遅れたら料金を返します」という宅配の約束。
- **ラボで見られる場所**: ラボには無い(SLO だけ)。

### エラーバジェット {#error-budget}
- **一言でいうと**: SLO の範囲で「失敗してよい量」。99.9% なら 0.1%。
- **たとえ**: 1 か月のお小遣い。使い切ったら遊び(新機能)は控える。
- **ラボで見られる場所**: Grafana の「エラーバジェットの残り(30 日)」。

### バーンレート {#burn-rate}
- **一言でいうと**: エラーバジェットを使う速さ。1 なら月末にちょうど使い切る速さ。
- **たとえ**: お小遣いを使うペース。14.4 倍なら約 2 日で使い切る。
- **ラボで見られる場所**: `job:slo_burn_rate:5m` など。[エラーバジェットとアラート](/exercises/10-sre-burn-rate-alert)。

### 窓(ウィンドウ) {#window}
- **一言でいうと**: 計算するときにまとめて見る時間の長さ。5 分窓、1 時間窓など。
- **たとえ**: 天気を「今の 5 分」で見るか「今日 1 日」で見るか。
- **ラボで見られる場所**: 記録ルールの `[5m]`、`[1h]` など。

### マルチウィンドウ {#multi-window}
- **一言でいうと**: 長い窓と短い窓の両方が条件を満たしたときだけ鳴らす方法。
- **たとえ**: 「今日ずっと雨」かつ「今も降っている」ときだけ傘を配る。
- **ラボで見られる場所**: `ErrorBudgetBurnPage`(5 分窓 かつ 1 時間窓)。

### p95(パーセンタイル) {#p95}
- **一言でいうと**: 100 件を速い順に並べたとき、95 件目の値(これより遅いのは 5 件だけ)。ほとんどの人が体験する「遅め」の速さ。
- **たとえ**: クラスで 95 番目に速い人のタイム。平均より実感に近い。
- **ラボで見られる場所**: `job:http_request_duration_seconds:p95_rate5m`。

### ヒストグラム {#histogram}
- **一言でいうと**: 値を区切り(0.1 秒以下、0.2 秒以下…)ごとに数える指標。ここから p95 を計算する。
- **たとえ**: 身長を 10cm ごとの箱に分けて人数を数える。
- **ラボで見られる場所**: `http_request_duration_seconds` のバケット。

### ラベル {#label}
- **一言でいうと**: 指標やログに付ける分類の付箋。route、status、job など。
- **たとえ**: 書類に貼る色付きの付箋。
- **ラボで見られる場所**: `http_requests_total{route,method,status}`。

### カーディナリティ {#cardinality}
- **一言でいうと**: ラベルの値の種類の数。多すぎると見張りの道具が重くなる。
- **たとえ**: 付箋の色が 100 万色あると、仕分けできない。
- **ラボで見られる場所**: storefront が `/p/100001` と `/p/100002` を `/p/:code` にまとめている。

### Alertmanager {#alertmanager}
- **一言でいうと**: アラートを受け取り、まとめたり重複を除いたりして、通知先に送る係。
- **たとえ**: 苦情をまとめて担当者に回す窓口。
- **ラボで見られる場所**: http://localhost:19093。

### pager {#pager}
- **一言でいうと**: 通知を受け取る先。現場では電話・チャット・呼び出しサービス。ラボでは画面に並べるだけ。
- **たとえ**: ポケベル。
- **ラボで見られる場所**: http://localhost:19094。

### page と ticket {#page-and-ticket}
- **一言でいうと**: 通知の重さの区別。page はすぐ人を呼ぶ緊急、ticket は営業時間内に対応する警告。
- **たとえ**: 火事の非常ベルと、翌日の業務連絡。
- **ラボで見られる場所**: アラートの `severity` ラベル。

### 抑止(inhibit) {#inhibit}
- **一言でいうと**: 緊急の通知が出ている間、同じ原因の軽い通知を黙らせること。
- **たとえ**: 火事のベルが鳴っている間は「換気してください」の放送を止める。
- **ラボで見られる場所**: [alertmanager.yml](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/observability/alertmanager/alertmanager.yml) の `inhibit_rules`。

### オンコール {#on-call}
- **一言でいうと**: 決まった期間、呼び出しに応じる当番。
- **たとえ**: 病院の夜間当直。
- **ラボで見られる場所**: ラボには無い(pager が受け口の代わり)。

### Grafana {#grafana}
- **一言でいうと**: 指標やログをグラフや表で見る画面の道具。
- **たとえ**: 計器を並べた操作盤。
- **ラボで見られる場所**: http://localhost:13000。

### ダッシュボード {#dashboard}
- **一言でいうと**: 大事なグラフを 1 枚に並べた画面。
- **たとえ**: 車の運転席のメーター類。
- **ラボで見られる場所**: 「サンプルストア SLO」。

### 構造化ログ {#structured-log}
- **一言でいうと**: ログを 1 行 1 つの JSON のように、項目名つきで出すこと。検索や集計がしやすい。
- **たとえ**: 手書きの日記ではなく、欄の決まった記録用紙。
- **ラボで見られる場所**: api・backoffice・worker(pino)・storefront・ingress・cdn-waf のログ。

### Loki {#loki}
- **一言でいうと**: ログを保管して検索できるようにする道具。
- **たとえ**: 記録用紙の保管庫。
- **ラボで見られる場所**: Grafana のログのパネル(7 日で消す)。

### Alloy {#alloy}
- **一言でいうと**: 各コンテナのログを読み取って、Loki へ運ぶ係。
- **たとえ**: 各部署から記録用紙を回収する係。
- **ラボで見られる場所**: [config.alloy](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/observability/alloy/config.alloy)。

### トレース {#trace}
- **一言でいうと**: 1 つのリクエストが、どの部品を通って、それぞれ何秒かかったかを 1 本の道筋として記録したもの。
- **たとえ**: 宅配便の追跡番号。どの営業所をいつ通ったかが全部分かる。
- **ラボで見られる場所**: 本格版の Grafana(Tempo)。`GET /p/:code` → `ssr.render` → api の `GET /occ/v2/...` → DB が 1 本につながる。ダッシュボード「サンプルストア 1 リクエストの道筋」で見る。

### スパン {#span}
- **一言でいうと**: トレースの中の 1 区間。「この部品のこの処理に何秒」を表す。親子でつながる。
- **たとえ**: 追跡記録の 1 行(「〇〇営業所 到着 10:02 → 出発 10:15」)。
- **ラボで見られる場所**: storefront の `ssr.render`、api の DB への問い合わせ、worker の `job stockImportJob` など。

### trace_id {#trace-id}
- **一言でいうと**: トレース 1 本ごとの番号。ログにも入れておくと、ログからトレースへ飛べる。
- **たとえ**: 追跡番号そのもの。
- **ラボで見られる場所**: storefront・api のログの `trace_id`(トレースを送っているときだけ入る)。本格版は Grafana でログからトレースに飛べる(Loki のデータソースの derived field。ログの行の「Tempo で道筋を見る」)。

### traceparent {#traceparent}
- **一言でいうと**: トレースの番号と親の区間を、次の部品に渡す HTTP ヘッダ。これで部品をまたいで道筋がつながる。
- **たとえ**: 荷物に貼り直す追跡ラベル。
- **ラボで見られる場所**: storefront が SSR 中に api を呼ぶときに付ける。api は受け取ってその続きとして記録する。CORS の許可ヘッダにも入っている。

### OpenTelemetry {#opentelemetry}
- **一言でいうと**: トレース(と指標・ログ)を、決まった形で集めて送るための共通の道具と決まり。
- **たとえ**: どの運送会社でも使える、共通の追跡ラベルの規格。
- **ラボで見られる場所**: api の [otel.js](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/apps/api/src/otel.js) と storefront の [otel.ts](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/apps/web/src/server/otel.ts)。`OTEL_EXPORTER_OTLP_ENDPOINT` があるときだけ送る。本格版は OpenTelemetry Collector(`http://otel-collector:4318`)が受けて Tempo に渡す。

### Tempo {#tempo}
- **一言でいうと**: トレースをためておき、Grafana で見られるようにする保管庫。
- **たとえ**: 追跡記録の保管庫。
- **ラボで見られる場所**: 本格版だけ。Grafana のデータソース `Tempo`(Deployment `tempo`、`grafana/tempo:2.10.8`。24 時間で消す)。CCv2 の案件では Dynatrace(APM)がこの役も持つ。

## 6. 試験(QA)

### E2E テスト {#e2e-test}
- **一言でいうと**: 利用者と同じ操作(一覧 → 詳細 → ログイン → 注文履歴)を、端から端まで自動でなぞる試験。
- **たとえ**: 覆面調査員が、実際に店で買い物をしてみる。
- **ラボで見られる場所**: [E2E テストと画面比較](/exercises/11-qa-e2e-regression)。

### Playwright {#playwright}
- **一言でいうと**: ブラウザを自動で操作して E2E テストをする道具。
- **たとえ**: 決まった手順で何度でも操作してくれるロボット。
- **ラボで見られる場所**: [E2E テストと画面比較](/exercises/11-qa-e2e-regression)。

### 画面比較(ビジュアルリグレッション) {#visual-regression}
- **一言でいうと**: 前回の画面の画像と今回の画像を比べ、違いを見つける試験。
- **たとえ**: 間違い探し。
- **ラボで見られる場所**: [E2E テストと画面比較](/exercises/11-qa-e2e-regression)。

### 回帰テスト {#regression-test}
- **一言でいうと**: 直したつもりで別の所を壊していないか、前に通った試験をもう一度流すこと。
- **たとえ**: 家具を動かしたあとで、ドアがちゃんと開くか確かめる。
- **ラボで見られる場所**: E2E テスト、攻撃の見本の再実行。

## 7. 性能

### 負荷試験 {#load-test}
- **一言でいうと**: たくさんの利用者のまねをしてアクセスを送り、どこまで耐えるかを確かめる試験。
- **たとえ**: 開店前に、社員全員で客のふりをしてレジに並ぶ。
- **ラボで見られる場所**: [負荷試験で限界を見る](/exercises/12-perf-load-test)。

### k6 {#k6}
- **一言でいうと**: 負荷試験の道具。シナリオを JavaScript で書く。
- **たとえ**: 客のふりをする人を、指定の人数だけ呼んでくれる派遣会社。
- **ラボで見られる場所**: [tools/k6/](https://github.com/kazumasamatsumoto/ops-hands-on-lab/tree/main/tools/k6)。

### VU(仮想利用者) {#vu}
- **一言でいうと**: k6 が動かす「客のふりをする人」1 人ぶん。
- **たとえ**: 客役の社員 1 人。
- **ラボで見られる場所**: browse.js の既定は 5 人、ramp.js は 50 人まで。

### ステップ負荷 {#step-load}
- **一言でいうと**: 人数を段階的に増やしていき、どこで苦しくなるかを見る負荷のかけ方。
- **たとえ**: 重りを 1 枚ずつ足していく。
- **ラボで見られる場所**: ramp.js(5 → 20 → 50 人)。

### スループット {#throughput}
- **一言でいうと**: 1 秒あたりにさばけた件数。
- **たとえ**: 1 分間に会計できたお客さんの数。
- **ラボで見られる場所**: Grafana の「リクエスト数(1 秒あたり、サービスとルート別)」。

### レイテンシ(応答時間) {#latency}
- **一言でいうと**: 頼んでから返事が来るまでの時間。
- **たとえ**: 注文してから料理が出るまでの時間。
- **ラボで見られる場所**: Grafana の「p95 応答時間」。

### 閾値(しきい値) {#threshold}
- **一言でいうと**: 合格・不合格や、鳴らす・鳴らさないを分ける境目の値。
- **たとえ**: 合格点 60 点。
- **ラボで見られる場所**: k6 の `thresholds`(browse.js は p95 が 500ms 未満、失敗 1% 未満)。

### スケールアウト {#scale-out}
- **一言でいうと**: 同じものの台数を増やして、さばける量を増やすこと。
- **たとえ**: レジを 1 台から 3 台に増やす。
- **ラボで見られる場所**: [台数を増やして耐える](/exercises/13-perf-scale-out)。

### 容量計画 {#capacity-planning}
- **一言でいうと**: 先の混み具合を見積もり、必要な台数や大きさを前もって決めること。
- **たとえ**: 年末の繁忙期に向けて、アルバイトを何人雇うか決める。
- **ラボで見られる場所**: ラボには無い([必要なこと一覧](/guide/checklist) 54)。

## 8. 障害対応

### カオス(障害の注入) {#chaos}
- **一言でいうと**: わざと遅くしたり壊したりして、全体がどう見えるか・見張りが気づくかを試すこと。
- **たとえ**: 避難訓練。本当の火事の前に、非常ベルと避難経路を試す。
- **ラボで見られる場所**: [tools/chaos.sh](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/tools/chaos.sh)(latencyMs・errorRate・leakMb・idorBug・sqliBug)。

### 一次対応 {#first-response}
- **一言でいうと**: 障害に気づいた人が、最初の数分から数十分で行う対応。原因を直すより、まず影響を止める。
- **たとえ**: 水漏れに気づいたら、まず元栓を閉める。
- **ラボで見られる場所**: [API が遅い → SSR が逃げる](/exercises/14-incident-slow-api)。

### ランブック {#runbook}
- **一言でいうと**: 「この通知が来たら、これを見て、これをする」を書いた手順書。
- **たとえ**: 家電の「困ったときは」のページ。
- **ラボで見られる場所**: [D-INC-03 API の応答遅延](/design/detail/D-INC-03-slow-api)の一次対応。

### ポストモーテム {#postmortem}
- **一言でいうと**: 障害のあとの振り返り。誰が悪いかではなく、仕組みのどこを変えるかを決める。
- **たとえ**: 試合のあとの反省会。
- **ラボで見られる場所**: ラボには無い([障害対応方式 4.6](/design/architecture/08-incident-response#s4-6))。

## 9. 復旧(DR)

### DR {#dr}
- **一言でいうと**: 災害や大きな故障のあとで、サービスとデータを元に戻すこと(Disaster Recovery)。
- **たとえ**: 火事のあと、別の建物で営業を再開する計画。
- **ラボで見られる場所**: [DR 方式](/design/architecture/09-disaster-recovery)。

### バックアップ {#backup}
- **一言でいうと**: データの写しを取っておくこと。
- **たとえ**: 大事な書類のコピーを別の場所に保管する。
- **ラボで見られる場所**: [tools/backup.sh](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/tools/backup.sh)(`pg_dump`)。

### リストア(復元) {#restore}
- **一言でいうと**: バックアップからデータを戻すこと。
- **たとえ**: コピーから書類を作り直す。
- **ラボで見られる場所**: [tools/restore.sh](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/tools/restore.sh)。

### RTO {#rto}
- **一言でいうと**: 止まってから戻るまでに、かかってよい時間の目標(Recovery Time Objective)。
- **たとえ**: 停電から何分で電気を戻すか。
- **ラボで見られる場所**: [バックアップから戻す](/exercises/16-dr-backup-restore)で、戻すのにかかった時間を測る。

### RPO {#rpo}
- **一言でいうと**: どれだけ前の時点まで戻ってよいか = 失ってよいデータの量の目標(Recovery Point Objective)。
- **たとえ**: ゲームのセーブ。最後にセーブした所からやり直しになる。
- **ラボで見られる場所**: 最後にバックアップを取った時刻から、壊した時刻までの差。

## 10. 守り(セキュリティ)

### WAF {#waf}
- **一言でいうと**: 入口で、攻撃らしい入力をふるい落とす仕組み(Web Application Firewall)。
- **たとえ**: 空港の手荷物検査。
- **ラボで見られる場所**: cdn-waf の ModSecurity。[WAF が攻撃を止める](/exercises/17-sec-waf)。

### ModSecurity {#modsecurity}
- **一言でいうと**: nginx などに組み込んで使う WAF の本体。
- **たとえ**: 検査の機械そのもの。
- **ラボで見られる場所**: cdn-waf のイメージ `owasp/modsecurity-crs`。

### OWASP CRS {#owasp-crs}
- **一言でいうと**: よくある攻撃の見分け方を集めた、WAF の共通ルール集。
- **たとえ**: 検査機械に入れる「危険物の一覧表」。
- **ラボで見られる場所**: cdn-waf のログの `ruleId`。

### 異常スコア {#anomaly-score}
- **一言でいうと**: 入力の怪しさを点数で足し上げ、決めた点数以上なら遮断する方式。
- **たとえ**: 反則の累積。一定の点数で退場。
- **ラボで見られる場所**: `ANOMALY_INBOUND`(既定 5)。

### パラノイアレベル {#paranoia-level}
- **一言でいうと**: WAF の疑い深さ(1〜4)。上げるほど厳しく、誤遮断も増える。
- **たとえ**: 検査の厳しさの段階。
- **ラボで見られる場所**: `BLOCKING_PARANOIA`(既定 1)。

### 誤遮断 {#false-positive}
- **一言でいうと**: 普通の入力を、攻撃だと判定して止めてしまうこと。
- **たとえ**: 手荷物検査で、ただの水筒を止められる。
- **ラボで見られる場所**: [lab-exclusions-before.conf](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/cdn-waf/modsecurity/lab-exclusions-before.conf)(狭く外す書き方の見本。第 1 版で Cookie による誤遮断を直した例も、使わなくなった理由と一緒に残している)。

### DetectionOnly {#detectiononly}
- **一言でいうと**: WAF を「記録だけ・止めない」で動かすモード。
- **たとえ**: 検査はするが、止めずにメモだけ取る。
- **ラボで見られる場所**: `MODSEC_RULE_ENGINE`(ラボの既定は `On` = 遮断)。

### レート制限 {#rate-limit}
- **一言でいうと**: 同じ相手から一定時間に来るリクエストの数に上限を付けること。
- **たとえ**: 「お 1 人さま 1 日 3 個まで」。
- **ラボで見られる場所**: ingress(トークンの発行は IP ごとに 1 秒 1 回)と cdn-waf(全体は IP ごとに 1 秒 20 回)。

### バースト {#burst}
- **一言でいうと**: レート制限の中で、短い時間なら少しまとめて受け付ける余裕。
- **たとえ**: 「普段は 1 秒に 1 人ずつ。ただし急に来ても、あと 5 人までは待たせずに入れる」。ラボの `burst=5` なら、続けて送ると 6 回目までは通り、7 回目から 429 です。
- **ラボで見られる場所**: トークンの発行の `burst=5`(ingress)、全体の `burst=80`(cdn-waf)。

### 429 {#http-429}
- **一言でいうと**: 「回数が多すぎます」を表す HTTP の状態コード(Too Many Requests)。
- **たとえ**: 「ただいま混み合っています。少し待って」。
- **ラボで見られる場所**: [ログインの連打を止める](/exercises/18-sec-rate-limit-login)。

### XSS {#xss}
- **一言でいうと**: 画面にスクリプトを差し込み、見た人のブラウザで勝手に動かす攻撃(クロスサイトスクリプティング)。
- **たとえ**: 掲示板の貼り紙に、読んだ人を操る呪文を書いておく。
- **ラボで見られる場所**: [tools/attack-samples.sh](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/tools/attack-samples.sh) の XSS の見本。

### CSP {#csp}
- **一言でいうと**: 「このページが読み込んでよい物」の一覧をブラウザに渡し、それ以外を動かさない仕組み(Content Security Policy)。
- **たとえ**: 招待客の名簿。名簿にない人は会場に入れない。
- **ラボで見られる場所**: docker-compose.yml の `WWW_CSP`(www 用。api と backoffice はそれぞれ別の CSP)。[CSP で外部スクリプトを止める](/exercises/19-sec-csp)。

### セキュリティヘッダ {#security-headers}
- **一言でいうと**: ブラウザに安全な動きを頼む応答ヘッダ。CSP、X-Frame-Options(他のサイトに埋め込ませない)など。
- **たとえ**: 荷物に貼る「天地無用」「われもの注意」のシール。
- **ラボで見られる場所**: `curl -sI http://www.lab.localhost:18080/` の応答。

### 非 root {#non-root}
- **一言でいうと**: コンテナの中のアプリを、何でもできる管理者(root)ではなく一般ユーザーで動かすこと。
- **たとえ**: アルバイトに金庫の鍵は渡さない。
- **ラボで見られる場所**: Dockerfile の `USER node`。
