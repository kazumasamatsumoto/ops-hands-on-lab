# api(サンプルストアのサーバー側)

Node.js 24 + Express 5 + PostgreSQL。**1 つのイメージ**を、環境変数 `ASPECT` で 3 つの役に切り替えて動かします。
CCv2 の aspect(そのうちヘッドレスで主に使う api・backoffice・backgroundProcessing)と同じ考え方です。
**わざと壊すスイッチ(カオス)** が付いていて、遅延・エラー・メモリ不足・認可の穴・SQL インジェクションの穴・定期ジョブの失敗を、演習の中で起こせます。

| `ASPECT` | 役割 | CCv2 で当たるもの | 外に出すもの |
|---|---|---|---|
| `api`(既定) | OCC 風の REST API・OAuth の認可サーバー・商品画像 | api aspect | `api.lab.localhost` |
| `backoffice` | 社内向けの管理画面(価格・在庫・トップのバナー) | backoffice aspect | `backoffice.lab.localhost`(社内 IP だけ) |
| `backgroundProcessing` | 定期ジョブ(在庫の取り込み・検索の索引) | backgroundProcessing aspect | なし(`/healthz`・`/metrics` だけ) |

表の作成と見本データの投入は `ASPECT=api` だけが行います。ほかの 2 つは、表ができるまで待ってから動き始めます。

## エンドポイント(ASPECT=api)

すべて `/occ/v2/samplestore/...`(`samplestore` はお店の ID。CCv2 の baseSiteId に当たります)。失敗は `{"errors":[{"type","message"}]}` の形で返します。

| メソッドとパス | 中身 | ログイン |
|---|---|---|
| `GET /occ/v2/samplestore/products/search?query=&currentPage=0&pageSize=20&sort=&fields=` | 商品検索。`sort` は `relevance`・`price-asc`・`price-desc`・`name-asc`。応答ヘッダ `X-Search-Provider` で検索の実体(db / solr)が分かる | 不要 |
| `GET /occ/v2/samplestore/products/{code}?fields=` | 商品 1 件(例: `100001`)。無ければ 404 `UnknownIdentifierError` | 不要 |
| `GET /occ/v2/samplestore/cms/pages?pageType=ContentPage&pageLabelOrId=homepage` | トップページの部品の並び(下の「CMS」) | 不要 |
| `GET /occ/v2/samplestore/cms/pages?pageType=ProductPage&code=100001` | 商品詳細ページの部品の並び | 不要 |
| `GET /occ/v2/samplestore/cms/pages?pageType=CategoryPage&code=kitchen` | 分類ページの部品の並び(分類は `stationery`・`kitchen`・`living`・`digital`) | 不要 |
| `GET /occ/v2/samplestore/users/current` | ログイン中の本人 `{uid,name}` | 必要 |
| `GET /occ/v2/samplestore/users/current/orders` | 自分の注文の一覧 | 必要 |
| `GET /occ/v2/samplestore/users/current/orders/{code}` | 注文 1 件(例: `00001001`)。自分の注文でなければ 404 | 必要 |
| `POST /authorizationserver/oauth/token` | トークンの発行(下の「OAuth」) | — |
| `POST /authorizationserver/oauth/revoke` | トークンの取り消し(`token=...`。ログアウト用) | — |
| `GET /medias/{code}.svg` | 商品画像(`100001.svg`)とバナー(`banner-homepage.svg`・`banner-kitchen.svg` など)。`Cache-Control: public, max-age=86400` | 不要 |
| `GET /healthz` / `GET /readyz` / `GET /metrics` | 生きているか / 準備できているか(DB に届き、起動の準備が終わったか)/ Prometheus の指標 | 不要(外には出さない) |
| `GET /admin/chaos` / `POST /admin/chaos` | カオススイッチを見る / 変える | 不要(ingress で外から遮断) |

「ログイン: 必要」は `Authorization: Bearer <トークン>` を付けます。無い・期限切れは 401。
見本の会員は `alice` / `bob` / `carol`(パスワードはどれも `password`)。商品 30 件(コード `100001`〜`100030`)、注文は 8 件(`00001001`〜`00001008`。alice 3・bob 2・carol 3)。

### fields(返す量)

| 値 | 返す項目 |
|---|---|
| `BASIC` | `code`・`name`・`url`・`price` |
| `DEFAULT`(既定) | BASIC + `summary`・`images`・`stock` |
| `FULL` | DEFAULT + `description`・`categories`・`classifications`・`purchasable` |

検索 20 件で、BASIC はおよそ 3KB、FULL はおよそ 25KB です(性能の演習で比べます)。
`price` は `{currencyIso:"JPY", value, formattedValue:"￥1,650"}`、`stock` は `{stockLevelStatus: inStock|lowStock|outOfStock, stockLevel}`、
`images` は `[{url:"/medias/100001.svg", altText, format: product|thumbnail}]` です。画像の `url` はホスト名なしなので、storefront が api のアドレスを前に付けます。

### CMS(画面の部品の並び)

ヘッドレスでは、画面の「どこに・何を置くか」を api が JSON で返し、storefront はそれを見て部品を並べるだけです。
ページの中にスロット(置き場所。`position` は `SearchBox`・`NavigationBar`・`Section1`〜`Section4`・`Summary`・`CrossSelling`・`ProductList`・`Footer`)があり、スロットの中に部品(component)が入ります。

| 部品の型(`typeCode`) | 属性 | 置いてある所 |
|---|---|---|
| `SearchBoxComponent` | `placeholder` | すべてのページの `SearchBox` |
| `NavigationComponent` | `links: [{name, url, categoryCode?}]` | すべてのページの `NavigationBar` |
| `SimpleBannerComponent` | `headline`・`content`・`media:{url,altText}`・`urlLink` | トップ `Section1`(管理画面で文言を変えられる)、分類ページ `Section1` |
| `CMSParagraphComponent` | `content`(HTML の断片を書ける。見本の値はただの文字。storefront は HTML として描き、危ない物は Angular のサニタイズで取り除く = `apps/web/src/app/cms/components/paragraph.ts`) | トップ `Section2`、すべての `Footer` |
| `ProductCarouselComponent` | `title`・`productCodes`(**空白区切りの文字列**。例 `"100021 100013"`。OCC と同じ形) | トップ `Section3`・`Section4`、商品ページ `CrossSelling`(同じ分類の商品)、分類ページ `ProductList` |
| `ProductDetailsComponent` | なし(商品の中身は `products/{code}` で取る) | 商品ページ `Summary` |

各部品には `uid`・`typeCode`・`name`・`modifiedTime` も付きます。存在しないページは 404(`CMSItemNotFoundError` / `UnknownIdentifierError`)。

### OAuth(トークン)

```
curl -X POST http://api.lab.localhost:18080/authorizationserver/oauth/token \
  -d 'grant_type=password&client_id=storefront&username=alice&password=password'
→ {"access_token":"…","token_type":"bearer","expires_in":900,"scope":"basic"}
```

- 受け付けるクライアントは `storefront` だけ(秘密の鍵を持たない公開クライアント)。ほかは 401 `invalid_client`。
- パスワードグラントは仕組みを見やすくするための学習用の選択です。今の OAuth の安全の指針(RFC 9700)では使わないことになっており、SAP Commerce Cloud でも公開クライアントは「認可コード + PKCE」でトークンをもらうのが今の標準です。
- 名前かパスワードが違えば 400 `invalid_grant`。何度失敗してもロックしません。ログインの回数制限は ingress が受け持ちます(軽量版は `ingress/default.conf.template` の `limit_req zone=login`、本格版は Ingress `api-ratelimit-1` の注釈 `limit-rps`。IP ごとに 1 秒 1 回。`burst=5` の余裕があるので、続けて送ると 6 回目までは通り、7 回目から 429)。
- トークンは中身の無いランダムな文字列です(JWT ではありません)。DB には SHA-256 の値と期限(15 分)だけを置くので、api を何台にしても同じトークンが通ります。

### CORS

`Origin` ヘッダが `CORS_ALLOWED_ORIGINS` のどれかと一致したときだけ `Access-Control-Allow-Origin` を返します(`Vary: Origin` は常に付ける)。
許可していないオリジンからの下見(OPTIONS)は 403。CORS はブラウザを守るしくみで、curl からの呼び出しは止めません。

## ASPECT=backoffice(管理画面)

`http://backoffice.lab.localhost:18080/backoffice/` を開き、`admin` / `admin` でログインします。
サーバーで作る HTML の画面で、商品の価格・在庫と、トップのバナーの見出し・本文を変えられます。変更は api と同じ DB に入ります。

- 変えた値がお店の画面に出るのは、cdn-waf のキャッシュが切れてからです。検索が Solr のときは、検索結果の価格・在庫は worker が索引を作り直すまで(最大 `CRON_INTERVAL_SECONDS`)古いままです。
- ログイン状態はクッキー `bo_session`(HttpOnly・SameSite=Strict)で持ち、中身は DB に置きます。フォームには CSRF トークンを埋め込み、合わなければ 403 にします。
- `/healthz`・`/readyz`・`/metrics`・`/admin/chaos` もあります。

## ASPECT=backgroundProcessing(worker・定期ジョブ)

エンドポイント(入口)を持たないので、外からは何も呼べません。`/healthz`・`/readyz`・`/metrics`・`/admin/chaos` は、Prometheus や `tools/chaos.sh` が中から使います。

| ジョブ | 間隔 | 何をするか |
|---|---|---|
| `stockImportJob` | `CRON_INTERVAL_SECONDS`(既定 60 秒) | ランダムな 5 商品の在庫を -3〜+5 動かす(基幹システムからの在庫の取り込みの代わり) |
| `searchIndexJob` | 同上 | `SEARCH_PROVIDER=solr` なら DB の全商品で Solr の索引を作り直す。`db` なら何もせず成功を記録 |

指標: `cronjob_runs_total{job,result="success|failure"}`、`cronjob_last_success_timestamp_seconds{job}`(起動した時刻から始まる)、`cronjob_duration_seconds{job}`。
「`time() - cronjob_last_success_timestamp_seconds > 300`」でジョブの止まり・失敗の続きを見張れます。
注意: ラベル名 `job` は Prometheus が自分で付ける `job` と同じ名前なので、収集の設定で `honor_labels: true` にしないと `exported_job` に名前が変わります。

## 検索(SEARCH_PROVIDER)

| 値 | しくみ | 使う版 |
|---|---|---|
| `db`(既定) | PostgreSQL の `ILIKE`(部分一致)。名前・短い説明・分類名を探す。言葉が複数なら全部を含むもの | 軽量版 |
| `solr` | Solr の索引を HTTP(`SOLR_URL/select`)で引く。日本語は 2 文字ずつ重ねて切る(CJK バイグラム)。全角・半角の違いも吸収する | 本格版 |

Solr に届かないときは、検索だけ 503 `SearchUnavailableError` を返し、エラーのログを出します(商品詳細や CMS は DB から読むので動き続けます)。
Solr の設定(configset)は [`solr/products/conf/`](solr/products/conf/)にあります。公開イメージ `solr:9.10.1-slim` に
`/opt/solr/server/solr/configsets/products` として読み取り専用でつなぎ、コマンドを `solr-precreate products /opt/solr/server/solr/configsets/products` にすると、コア `products` ができます。

## カオススイッチ(わざと壊す)

`POST /admin/chaos` に `{"latencyMs":1000}` のように変えたいものだけ送ります。`{"reset":true}` で全部戻ります。再起動すると環境変数の値に戻ります。

| スイッチ | 環境変数 | 効く aspect | 何が起きるか |
|---|---|---|---|
| `latencyMs` | `CHAOS_LATENCY_MS` | api | OCC の API と token に遅延を足す |
| `errorRate` | `CHAOS_ERROR_RATE` | api | 0〜1 の割合で 500 を返す |
| `leakMb` | `CHAOS_LEAK_MB` | api | リクエストのたびにメモリを溜め、最後は落ちる |
| `idorBug` | `CHAOS_IDOR_BUG` | api | 注文 1 件の取得で持ち主を確かめない(他人の注文が見える) |
| `sqliBug` | `CHAOS_SQLI_BUG` | api | 検索の `query` を文字列連結で SQL に入れる。`solr` のときも DB の危ない検索に切り替わる |
| `cronFail` | `CHAOS_CRON_FAIL` | backgroundProcessing | 定期ジョブがすべて失敗する |

## 環境変数

| 環境変数 | 既定 | 中身 |
|---|---|---|
| `ASPECT` | `api` | 役割(`api`・`backoffice`・`backgroundProcessing`) |
| `PORT` | 3001 | 待ち受けるポート(3 役とも同じ) |
| `PGHOST` / `PGPORT` / `PGDATABASE` / `PGUSER` / `PGPASSWORD` | `db` / 5432 / `store` / `store` / `store` | PostgreSQL の接続先 |
| `PG_POOL_MAX` | 10 | DB への接続の数の上限 |
| `SEARCH_PROVIDER` | `db` | 検索の実体(`db` / `solr`)。api と worker で同じ値にする |
| `SOLR_URL` | `http://search:8983/solr/products` | Solr のコアの URL |
| `SOLR_TIMEOUT_MS` | 2000 | Solr の返事を待つ時間 |
| `CORS_ALLOWED_ORIGINS` | `http://www.lab.localhost:18080` | 許可するオリジン(カンマか空白で区切って複数) |
| `BACKOFFICE_PASSWORD` | `admin` | 管理画面のパスワード(ラボ用。**本番では必ずシークレットの置き場所から渡す**) |
| `CRON_INTERVAL_SECONDS` | 60 | 定期ジョブの間隔(演習で短くする) |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | なし | トレースの送り先(例 `http://otel-collector:4318`)。無ければトレースは動かない |
| `OTEL_SERVICE_NAME` | `samplestore-<ASPECT>` | トレースに出す名前 |
| `LOG_LEVEL` | `info` | ログの細かさ |
| `CHAOS_*` | 壊さない | 上の表 |

## 見守り(指標・ログ・トレース)

- 指標(`/metrics`): `http_requests_total{route,method,status}`、`http_request_duration_seconds`、`search_requests_total{provider,result}`、`lab_chaos_setting{name}`、`lab_leaked_megabytes`、worker は上の `cronjob_*`。
- ログ: JSON で 1 行ずつ標準出力へ。`service`(`samplestore-api` など)と `aspect` が付きます。トレースが動いているときは `trace_id`・`span_id` も付き、Grafana でログから同じリクエストの道筋に飛べます。
- トレース: `OTEL_EXPORTER_OTLP_ENDPOINT` があるときだけ、OTLP/HTTP で送ります。http・express・pg と、Solr への問い合わせ(fetch)を自動で計測し、worker はジョブ 1 回を 1 本の道筋にします。受け取った `traceparent` ヘッダを引き継ぐので、storefront からの道筋とつながります。

## ファイル

- `src/main.js` … 入口。`ASPECT` を見て役割を選ぶ
- `src/otel.js` … トレースの準備(`node --require` でアプリより先に読み込む)
- `src/aspects/api.js`・`backoffice.js`・`worker.js` … 3 つの役
- `src/occ/` … OCC 風の API(`search.js` 検索、`cms.js` 画面の部品、`oauth.js` トークン、`orders.js` 注文、`medias.js` 画像、`cors.js`、`format.js` 返す形と fields)
- `src/solr.js` … Solr と HTTP で話す(検索と索引の作り直し)
- `src/db.js`・`src/seed-data.js` … DB の接続・表・見本データ(DB が止まってもプロセスが落ちないよう、接続の `error` を拾っています)
- `src/chaos.js`・`src/metrics.js`・`src/log.js`・`src/http-common.js` … カオス・指標・ログ・3 役共通の土台(見守り用の入口、エラーの受け皿、穏やかな停止)
- `solr/products/conf/` … Solr の設定(configset)
