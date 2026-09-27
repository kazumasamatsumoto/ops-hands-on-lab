# D-NW-01 cdn-waf と ingress の経路とキャッシュ

版: 2.0 / 親: [ネットワーク方式](/design/architecture/04-network) / 対象: [cdn-waf/default.conf.template](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/cdn-waf/default.conf.template)・[ingress/default.conf.template](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/ingress/default.conf.template)・[ingress/40-ip-filter.sh](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/ingress/40-ip-filter.sh)・[k8s/generated/base/ingress.yaml](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/k8s/generated/base/ingress.yaml)

::: tip 3 行まとめ(この文書で決めたこと)
- 入口は 2 段です。**cdn-waf**(クラスタの外の CDN・WAF の役)がキャッシュ・WAF・全体のレート制限・ヘッダを受け持ち、**ingress**(クラスタの入口。CCv2 のエンドポイントと IP フィルタに当たる)がホスト名で `www`→storefront・`api`→api・`backoffice`→backoffice に振り分けます。
- キャッシュは cdn-waf だけで行います。画面は `/`・`/p/...`・`/search` を 30 秒、api は `products/search`・`products/{code}`・`cms/pages` を 30 秒、画像 `/medias/` は 1 日。`Authorization` か Cookie があれば使わず、ためもしません。
- ingress は cdn-waf(172.30.89.10)から来たときだけ `X-Forwarded-For` を信じ、その IP で backoffice の IP フィルタとログインの回数制限をかけます。`/admin/`・`/metrics`・`/readyz` は外から 403 です。
:::

## 0. 親の方式設計書 {#s0}
| 項目 | 内容 |
| --- | --- |
| 親 | [ネットワーク方式](/design/architecture/04-network) |
| 引き継ぐ決定 | 4.1 振り分け、4.2 キャッシュ、4.3 ためてはいけない物、4.4 管理画面の IP 制限、4.6 タイムアウト、[4.7 2 段の入口](/design/architecture/04-network#s4-7)、[4.8 IP フィルタと環境の差](/design/architecture/04-network#s4-8) |
| またがる層 | [セキュリティ方式](/design/architecture/10-security)(レート制限・ヘッダ・WAF。詳細は [D-SEC-01](/design/detail/D-SEC-01-waf-and-rate-limit))、[インフラ方式 4.7](/design/architecture/03-infrastructure#s4-7)(manifest から Ingress を作る) |

## 1. 目的と範囲 {#s1}
- **含む**: ホスト名ごとの行き先、cdn-waf の location とキャッシュの設定値、ingress の振り分けと閉じる口、奥へ渡すヘッダ、タイムアウト、ログの形、本格版の Ingress との対応。
- **含まない**: WAF のルールとレート制限・CSP の値(D-SEC-01)。

## 2. 前提 {#s2}
| 前提 | 内容 |
| --- | --- |
| 設定の読み込み | どちらも起動時に `envsubst` で `${...}` が環境変数に置き換わる(小文字の `$host` などは nginx の変数)。cdn-waf は `${EDGE_CACHE}`・`${EDGE_GLOBAL_RATE}`・`${EDGE_GLOBAL_BURST}`・`${WWW_CSP}`・`${INGRESS_UPSTREAM}`、ingress は `${CDN_WAF_IP}` |
| cdn-waf の待ち受け | 8081(ホスト PC 用。ホストの `127.0.0.1:18080` につなぐ。来た通信を「127.0.0.1 から来た」として扱う)と 18080(Docker のネットワークの中と `outside` 用。送り元の IP をそのまま使う) |
| ingress の待ち受け | 8080(外には出さない) |
| 名前の解決 | ingress は `resolver 127.0.0.11 valid=10s`。行き先を変数に入れ、リクエストのたびに調べる(行き先が未起動でも nginx は起動でき、その間は 502) |
| IP フィルタ | ingress の起動時に `40-ip-filter.sh` が `BACKOFFICE_IP_ALLOWLIST`(既定 `127.0.0.1/32 172.30.89.0/24 172.30.91.0/24`)から `/etc/nginx/ip-filters/backoffice.conf`(`allow ...; deny all;`)を作る。空なら誰も通さない |

## 3. 全体像 {#s3}
```text
ブラウザ ─ http://www.lab.localhost:18080 など ─▶ cdn-waf(クラスタの外。CDN + WAF)
  → WAF(ModSecurity + OWASP CRS)
  → 全体のレート制限(IP ごと 20r/s、burst 80。3 つのホスト名の合計)
  → ホスト名ごとの server と location でキャッシュ(下の 4.1)
  → すべて ingress:8080 へ(Host はそのまま、X-Forwarded-For は利用者の IP で上書き)
       ▼
ingress(クラスタの入口。エンドポイント)
  → set_real_ip_from 172.30.89.10(cdn-waf からだけ X-Forwarded-For を信じる)
  ├ www.lab.localhost        → storefront:4000   /metrics は 403
  ├ api.lab.localhost        → api:3001          /admin/・/metrics・/readyz は 403、token は 1r/s burst 5
  ├ backoffice.lab.localhost → backoffice:3001   IP フィルタ(社内だけ)、/admin/・/metrics・/readyz は 403
  └ それ以外のホスト名        → 404「エンドポイントがありません」
```

## 4. 仕様 {#s4}
### 4.1 location の一覧(cdn-waf) {#s4-1}
| ホスト名 | location | キャッシュ | 制限 |
| --- | --- | --- | --- |
| (知らない名前) | `= /cdn-healthz` | — | 200 `ok`。ログを出さない |
| (知らない名前) | `/` | — | 404「このホスト名は使っていません」 |
| `www.lab.localhost` | `= /`(トップ) | 30 秒 | 全体 |
| 同上 | `~ ^/p/[^/]+/?$`(商品詳細) | 30 秒 | 全体 |
| 同上 | `= /search`(検索結果) | 30 秒 | 全体 |
| 同上 | `/`(ログイン・注文履歴・JS・CSS など) | — | 全体 |
| `api.lab.localhost` | `= /occ/v2/samplestore/products/search` | 30 秒 | 全体 |
| 同上 | `~ ^/occ/v2/samplestore/products/[^/]+$` | 30 秒 | 全体 |
| 同上 | `= /occ/v2/samplestore/cms/pages` | 30 秒 | 全体 |
| 同上 | `/medias/` | 1 日(api も `Cache-Control: public, max-age=86400`) | 全体 |
| 同上 | `/`(トークン・注文など) | — | 全体(トークンの回数制限は ingress) |
| `backoffice.lab.localhost` | `/` | —(管理画面はためない) | 全体(IP フィルタは ingress) |

行き先はどれも `http://${INGRESS_UPSTREAM}`(軽量版 `ingress:8080`)です。振り分けは ingress の仕事なので、cdn-waf はホスト名を付けたまま全部 ingress に渡します。

### 4.2 キャッシュの設定値 {#s4-2}
| 設定 | 値 | 意味 |
| --- | --- | --- |
| `proxy_cache_path` | `/tmp/nginx-cache`、`keys_zone=store_cache:10m`、`max_size=100m`、`inactive=1d` | ためる場所。鍵の帳簿 10MB、中身は 100MB まで、1 日使われなければ捨てる |
| `proxy_cache_key` | `$request_method$host$request_uri` | 同じメソッド・ホスト名・URL(`?query=` も含む)なら同じ物。ホスト名が入るので www と api は混ざらない |
| `proxy_cache_valid` | `200 30s`(`/medias/` は `200 1d`) | 状態 200 だけをためる |
| `proxy_cache_methods` | `GET HEAD` | 読み取りだけ |
| `proxy_cache_bypass` / `proxy_no_cache` | `$cache_disabled $has_credentials` | OFF のとき・`Authorization` か Cookie があるときは使わず、ためない |
| `proxy_cache_lock` | `on` | まだためていない物を同時に頼まれたら、奥へは 1 回だけ(期限切れの取り直しには効かない) |
| `EDGE_CACHE` | `on`(既定) | `on` 以外なら全部 OFF。`EDGE_CACHE=off docker compose up -d cdn-waf` で切り替え。本格版は環境ごと(d1 は `off`、s1・p1 は `on`) |

- 返事に `Cache-Control: no-store`・`private`・`no-cache` が付いていればためません(nginx の既定の動き)。例: SSR をあきらめた空の HTML、注文・トークンの返事。
- api は返事に `Vary: Origin` を付けるので、nginx は `Origin` ヘッダの値ごとに別々にためます(www から来た返事の `Access-Control-Allow-Origin` を、別のオリジンの人に使い回さないため)。
- backoffice で価格やバナーを変えても、ためた物が切れるまで(最大 30 秒)古い値が出ます。

### 4.3 X-Cache-Status の読み方 {#s4-3}
| 値 | 意味 | よく見る場面 |
| --- | --- | --- |
| `MISS` | ためた物が無く、奥へ取りに行った(ためてよい返事なら、今回の結果をためた。`no-store` などが付いた返事はためない) | 最初の 1 回 |
| `HIT` | ためた物を返した(奥へ行っていない) | 30 秒以内の 2 回目以降 |
| `EXPIRED` | 期限を過ぎていたので取り直した | 31 秒後 |
| `BYPASS` | ログインの印があるか、キャッシュが OFF なので使わなかった | `Authorization` 付き、`EDGE_CACHE=off` |
| (付かない) | キャッシュを使わない場所 | トークン、`/login`、backoffice など |

### 4.4 奥へ渡すヘッダとタイムアウト {#s4-4}
| 設定 | cdn-waf → ingress | ingress → 各サービス |
| --- | --- | --- |
| `Host` | 元のまま(`$host`)。ingress はこれで振り分ける | 元のまま |
| `X-Forwarded-For`・`X-Real-IP` | 利用者の IP で**上書き**(利用者が付けてきた偽の値を信じない) | 置き換え後の利用者の IP |
| `X-Forwarded-Proto` | `$scheme` | 受け取った値 |
| `X-Request-Id` | cdn-waf が付ける番号(`$request_id`) | 受け取った値(ingress のログの `request_id`、storefront・api のログの `reqId` に入る) |
| `proxy_connect_timeout` / `proxy_read_timeout` | 3 秒 / 30 秒 | 3 秒 / 30 秒 |

### 4.5 アクセスログ {#s4-5}
どちらも 1 行 1 JSON で標準出力へ。Alloy が集め、Loki のラベル `service="cdn-waf"`・`service="ingress"` で絞れます。

| 部品 | 項目 |
| --- | --- |
| cdn-waf | `time`・`service`・`host`・`remote_addr`・`client_ip`・`request_id`(自分で作った番号。`X-Request-Id` で奥へ渡す)・`method`・`uri`・`status`・`bytes`・`request_time`・`upstream_status`・`upstream_time`・`cache`・`user_agent` |
| ingress | `time`・`service`・`host`・`remote_addr`(置き換え後の利用者の IP)・`request_id`(cdn-waf から受け取った `X-Request-Id`)・`via`(直接つないできた cdn-waf)・`method`・`uri`・`status`・`request_time`・`upstream`・`upstream_status` |

### 4.6 ingress の振り分けと閉じる口(エンドポイント) {#s4-6}
| エンドポイント | ホスト名 | 行き先 | IP フィルタ | 外から 403 にする口 | 回数制限 |
| --- | --- | --- | --- | --- | --- |
| www | `www.lab.localhost` | `storefront:4000` | なし(誰でも) | `= /metrics` | — |
| api | `api.lab.localhost` | `api:3001` | なし(誰でも) | `/admin/`・`= /metrics`・`= /readyz` | `= /authorizationserver/oauth/token` は IP ごと 1r/s、burst 5(nodelay)。超えたら 429 |
| backoffice | `backoffice.lab.localhost` | `backoffice:3001` | `BACKOFFICE_IP_ALLOWLIST` の範囲だけ(それ以外 403) | `/admin/`・`= /metrics`・`= /readyz` | — |

- 閉じた口を使うときは、クラスタの中から直接呼びます(Prometheus は `api:3001/metrics` を直接、`tools/chaos.sh` は api コンテナの中から `/admin/chaos`)。
- 社外から来た様子は、社外の代わりのネットワーク `lab_outside` に置いたコンテナから `http://cdn-waf:18080/backoffice/login`(`Host: backoffice.lab.localhost`)を開くと 403 で見られます。

### 4.7 本格版の Ingress との対応 {#s4-7}
本格版では同じ振り分けを ingress-nginx(`k8s/vendor/ingress-nginx/`。版を固定した写し)が Ingress リソースで行います。Ingress は `manifest.json` の `endpoints` から `tools/manifest/render.mjs` が作ります。

| 軽量版(ingress の nginx) | 本格版(Ingress。`ingressClassName: nginx`) |
| --- | --- |
| `server_name www.lab.localhost` + `proxy_pass storefront:4000` | Ingress `www`(`host: www.lab.localhost`、`path: /` → Service `storefront:4000`) |
| `set_real_ip_from ${CDN_WAF_IP}` + `real_ip_header X-Forwarded-For` | ingress-nginx の設定 `use-forwarded-headers: "true"`・`proxy-real-ip-cidr: "172.30.91.0/24"`(本格版の Docker のネットワーク `lab-kind`) |
| `include .../backoffice.conf`(allow / deny) | Ingress `backoffice` の注釈 `nginx.ingress.kubernetes.io/allowlist-source-range: "127.0.0.1/32,172.30.89.0/24,172.30.91.0/24"` |
| `location /admin/ { deny all; }` など | Ingress `api-blocked`・`backoffice-blocked`・`www-blocked`(注釈 `nginx.ingress.kubernetes.io/denylist-source-range: "0.0.0.0/0"` で、どこから来ても 403) |
| `limit_req zone=login burst=5` | Ingress `api-ratelimit-1` の注釈 `limit-rps: "1"`・`limit-burst-multiplier: "5"` |
| 環境の違い | d1・s1 は `patches/ip-filter-www.yaml`・`ip-filter-api.yaml`・`ip-filter-api-ratelimit-1.yaml` で www・api も社内だけ。p1 は上書きなし |

cdn-waf は本格版でもクラスタの外の Docker のコンテナ(`lab-cdn-waf`、`k8s/up.sh` が起動)として置き、同じ設定ファイルのまま行き先だけを kind のノードの 80 番(ingress-nginx)に変えて渡します。キャッシュの ON/OFF は環境の ConfigMap `lab-environment` の `EDGE_CACHE` から決まります。

## 5. 目標と確認方法 {#s5}
| 項目 | 目標 | 確かめ方 |
| --- | --- | --- |
| キャッシュが効く | 2 回目が `HIT` | `curl -sI http://api.lab.localhost:18080/occ/v2/samplestore/products/100001 \| grep -i x-cache` を 2 回 |
| ログイン中はためない | `BYPASS` | `curl -sI -H 'Authorization: Bearer x' http://api.lab.localhost:18080/occ/v2/samplestore/products/100001 \| grep -i x-cache` |
| 30 秒で切れる | 31 秒後に `EXPIRED` | 30 秒待ってもう一度 |
| 閉じた口 | 外から 403 | `curl -s -o /dev/null -w '%{http_code}\n' http://api.lab.localhost:18080/admin/chaos` |
| IP フィルタ | 社外から 403、社内から 200 | `docker run --rm --network lab_outside curlimages/curl:8.16.0 -s -o /dev/null -w '%{http_code}\n' -H 'Host: backoffice.lab.localhost' http://cdn-waf:18080/backoffice/login` |
| 知らないホスト名 | 404 | `curl -s http://localhost:18080/` |
| manifest との一致 | 食い違いなし | `node tools/manifest/render.mjs --check` |

## 6. 関連する文書 {#s6}
- [D-SEC-01 WAF とレート制限](/design/detail/D-SEC-01-waf-and-rate-limit)
- [D-FE-04 商品詳細画面](/design/detail/D-FE-04-product-detail)(ためられる画面)
- [D-INF-01 起動構成](/design/detail/D-INF-01-compose-and-k8s)(ネットワークの番号、manifest からできる Ingress)
- 仕組みの説明: [cdn-waf](/how-it-works/01-cdn-waf)・[ingress(エンドポイントと IP フィルタ)](/how-it-works/02-ingress-and-endpoints)

## 7. 未決事項 {#s7}
| # | 内容 |
| --- | --- |
| 1 | キャッシュを手で消す口(価格の訂正時)を作るか。今は 30 秒で自然に切れるのを待つ |
| 2 | backoffice の変更をすぐ出したいとき、変えたページだけキャッシュを消す仕組み(タグで消すなど)を入れるか |
| 3 | `ipFilters.office` に軽量版と本格版の両方の範囲(172.30.89.0/24・172.30.91.0/24)が入っている。環境ごとに分けるか |

## 8. レビュー観点 {#s8}
- [ ] キャッシュの鍵に `?` 以降とホスト名が入っているか(検索結果・ホストが混ざらないか)
- [ ] ログインの印があるときに、使わない・ためないの両方になっているか
- [ ] エラーの応答(5xx)をためていないか(`proxy_cache_valid` が 200 だけか)
- [ ] `X-Forwarded-For` を信じる相手が cdn-waf だけに絞られているか
- [ ] 管理・見守りの口が外から閉じているか。backoffice に IP フィルタがあるか
- [ ] 軽量版の nginx と本格版の Ingress が同じ振り分けになっているか
- [ ] ログに `cache` と `upstream_time` があり、遅いのが入口か奥かを分けられるか

## この設計を体験する演習 {#exercises}
- [ネットワーク-1 前段のキャッシュ](/exercises/07-nw-cache)
- [ネットワーク-2 CORS と IP 制限](/exercises/08-nw-cors-and-ip)
- [ネットワーク-3 Ingress とエンドポイント](/exercises/20-nw-ingress-endpoints)
