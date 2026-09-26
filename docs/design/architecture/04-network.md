# ネットワーク方式設計書(ラボ)

版: 2.0 / 親: [全体方式](/design/architecture/00-overall) / 対象: cdn-waf(キャッシュ)と ingress(エンドポイント・IP フィルタ)、CORS

::: tip 3 行まとめ(この文書で決めたこと)
- 入口は 2 段。**cdn-waf**(クラスタの外の CDN・WAF。キャッシュと守り)→ **ingress**(クラスタの入口。ホスト名で www・api・backoffice の 3 つのエンドポイントに振り分け、IP フィルタを掛ける)。
- 誰が見ても同じ物だけを 30 秒ためる(トップ・商品詳細・検索の HTML、商品と CMS の API)。画像は 1 日。**ログインの印(Authorization か Cookie)を持つ人の応答はためない**。
- 画面(www)と API(api)は別オリジンなので、api は許可したオリジン(`http://www.lab.localhost:18080`)にだけ CORS で読ませる。backoffice は社内 IP だけ、`/admin/`・`/metrics`・`/readyz` は外から閉じる。
:::

## 0. 位置づけ {#s0}
全体方式の「利用者の通り道は cdn-waf の 1 か所」「CCv2 + ヘッドレスの形に寄せる」を具体化します。守りの部分(WAF・レート制限・ヘッダ)は [セキュリティ方式](/design/architecture/10-security) が決めます。
配下: [D-NW-01 cdn-waf と ingress の経路とキャッシュ](/design/detail/D-NW-01-edge-route)。

## 1. 目的と範囲 {#s1}
- **含む**: 入口の 2 段の役割分担、ホスト名での振り分け(エンドポイント)、キャッシュ(ためる物・ためない物・時間)、IP フィルタと環境の差、CORS、タイムアウト、見守り用の口の隠し方、利用者の IP の受け渡し。
- **含まない**: DNS、HTTPS の証明書、キャッシュの手動消去(現場では要る。[必要なこと一覧](/guide/checklist))。

## 2. 前提 {#s2}
| 前提 | 内容 |
| --- | --- |
| 入口 | ホストの `127.0.0.1:18080`(と `[::1]:18080`)→ cdn-waf の 8081(ホスト PC 用の入口)。同じ LAN の別の PC からは届かない |
| ホスト名 | `www.lab.localhost`・`api.lab.localhost`・`backoffice.lab.localhost`。知らないホスト名(例: `http://localhost:18080`)は cdn-waf が 404 で正しい入口を案内する |
| 内部のネットワーク | Docker のネットワーク `lab_default` を `172.30.89.0/24` に固定。cdn-waf の IP は `172.30.89.10` に固定 |
| 社外の代わり | ネットワーク `lab_outside`(`172.30.90.0/24`)。cdn-waf だけがつながる。ここから来た通信は「社外」 |
| 名前の解決 | cdn-waf・ingress とも Docker の DNS(`127.0.0.11`)で行き先をリクエストのたびに調べる。行き先が未起動でも入口は起動でき、その間は 502 |

## 3. 全体像 {#s3}
| ホスト名(エンドポイント) | 行き先 | cdn-waf のキャッシュ | ingress の扱い |
| --- | --- | --- | --- |
| `www.lab.localhost` | storefront:4000 | `/`・`/p/{code}`・`/search` を **30 秒** | `/metrics` は 403 |
| `api.lab.localhost` | api:3001 | `products/search`・`products/{code}`・`cms/pages` を **30 秒**、`/medias/` を **1 日** | `/admin/`・`/metrics`・`/readyz` は 403。`/authorizationserver/oauth/token` は IP ごと 1 秒 1 回(バースト 5) |
| `backoffice.lab.localhost` | backoffice:3001 | しない | **IP フィルタ**(`BACKOFFICE_IP_ALLOWLIST`、既定 `127.0.0.1/32 172.30.89.0/24 172.30.91.0/24`)。`/admin/`・`/metrics`・`/readyz` は 403 |
| (無し) | worker:3001 | — | エンドポイントを作らない(外に出さない) |

## 4. 決定事項 {#s4}
### 4.1 振り分け {#s4-1}
| 項目 | 内容 |
| --- | --- |
| 決定 | 振り分けは ingress だけが行い、URL の先頭ではなく**ホスト名**で 3 つの行き先を決める(上の表)。cdn-waf はホスト名を付けたまま全部を ingress に渡す。cdn-waf はリクエストごとに `X-Request-Id` を付け、ingress はそれを奥へ渡す。本格版では manifest.json の `endpoints[]` から、エンドポイントごとの Ingress リソース(`www`・`api`・`backoffice`)を作る |
| 理由 | CCv2 の「エンドポイント」と同じく、画面・API・管理画面を別のホスト名にして、守り方(IP フィルタ・回数制限)をエンドポイントごとに変えられるようにする。`X-Request-Id` で cdn-waf・ingress・アプリのログをつなげる |
| 却下した案 | 1 つのホスト名の下で `/api/` などのパスで分ける(第 1 版の形): 分かりやすいが、エンドポイントごとの IP フィルタや CORS といった実案件の形が体験できない |
| 実物 | [ingress/default.conf.template](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/ingress/default.conf.template)・[k8s/generated/base/ingress.yaml](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/k8s/generated/base/ingress.yaml)・[manifest.json](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/manifest.json)(`endpoints`) |

### 4.2 キャッシュ {#s4-2}
| 項目 | 内容 |
| --- | --- |
| 決定 | キャッシュは cdn-waf だけが持つ。状態 200 の応答を、画面(`/`・`/p/{code}`・`/search`)と API(`products/search`・`products/{code}`・`cms/pages`)は 30 秒、画像(`/medias/`)は 1 日ためる(api も `Cache-Control: public, max-age=86400` を付ける)。対象は GET と HEAD、鍵は「メソッド + ホスト名 + URL」。ためる場所は 100MB まで、1 日使われなければ捨てる。同じ物を同時に頼まれたら奥に取りに行くのは 1 回だけ(`proxy_cache_lock on`)。ON / OFF は環境変数 `EDGE_CACHE` の 1 か所(本格版では環境の `cdnCache`。d1 は OFF) |
| 理由 | 商品の情報や CMS の並びは数十秒古くても困らない。30 秒でも、1 秒に 100 回見られる画面なら奥へ行くのは 30 秒に 1 回になる。画像は変わらないので長くてよい |
| 却下した案 | 長くためる(10 分など): 価格の訂正や backoffice で変えたバナーがなかなか反映されない。ためない: セールの開始と同時にアプリが落ちる |
| 実物 | [cdn-waf/default.conf.template](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/cdn-waf/default.conf.template)・[apps/api/src/occ/medias.js](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/apps/api/src/occ/medias.js) |

### 4.3 ためてはいけない物 {#s4-3}
| 項目 | 内容 |
| --- | --- |
| 決定 | `Authorization` か `Cookie` のヘッダがあるリクエストは、キャッシュを使わず(`BYPASS`)、応答もためない。アプリが `Cache-Control: no-store` を付けた応答(SSR をあきらめた空の HTML、トークン、注文、`users/current`)もためない。ログイン・注文履歴の画面と backoffice は、そもそもキャッシュの場所に入れない。api は `Vary: Origin` を付け、オリジンごとに別々にためさせる |
| 理由 | ログイン中の人専用の応答をためると、次に来た人にその人の画面を見せてしまう。空の HTML をためると、api が直ったあとも 30 秒間 空の画面が配られる。CORS のヘッダを別のオリジンの人に使い回すと、許可の判断が崩れる |
| 却下した案 | URL だけで判断する: 同じ URL でも人によって中身が違う応答がある |
| 実物 | [cdn-waf/default.conf.template](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/cdn-waf/default.conf.template)(`$has_credentials`)・[apps/api/src/occ/cors.js](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/apps/api/src/occ/cors.js) |

### 4.4 backoffice エンドポイントの IP フィルタ {#s4-4}
| 項目 | 内容 |
| --- | --- |
| 決定 | backoffice のエンドポイントは、許す範囲(`allow`)を並べて最後に `deny all` にする。範囲は `BACKOFFICE_IP_ALLOWLIST`(既定 `127.0.0.1/32 172.30.89.0/24 172.30.91.0/24`。3 つ目は本格版の kind のネットワーク)から、ingress の起動時に `40-ip-filter.sh` が作る。一覧が空なら誰も通さない。ホスト PC から来た通信は cdn-waf が「127.0.0.1 から来た」として伝えるので社内扱い、`lab_outside`(`172.30.90.0/24`)から来ると 403。ingress は `X-Forwarded-For` を **cdn-waf(`172.30.89.10`)から来たときだけ**信じ、cdn-waf は利用者が付けた `X-Forwarded-For` を上書きする |
| 理由 | 管理の入口を外から見えなくする(CCv2 のエンドポイントの IP フィルタと同じ考え方)。`X-Forwarded-For` は誰でも偽れるので、信じる相手を 1 つに絞らないと、偽のヘッダで IP フィルタをすり抜けられる |
| 却下した案 | パスワードだけで守る: 入口が見えていれば総当たりされる。IP 制限を cdn-waf で掛ける: CDN・WAF を替えたときに一緒に消える。エンドポイントの持ち物にしておく |
| 実物 | [ingress/40-ip-filter.sh](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/ingress/40-ip-filter.sh)・[ingress/default.conf.template](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/ingress/default.conf.template)(`set_real_ip_from`)・[docker-compose.yml](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/docker-compose.yml)(`networks`) |

### 4.5 CORS {#s4-5}
| 項目 | 内容 |
| --- | --- |
| 決定 | 画面(`http://www.lab.localhost:18080`)と API(`http://api.lab.localhost:18080`)は**別オリジン**。api は `Origin` が `CORS_ALLOWED_ORIGINS`(既定 `http://www.lab.localhost:18080`)に一致したときだけ `Access-Control-Allow-Origin` を返す。下見(OPTIONS)は許可したオリジンにだけ 204(`Access-Control-Allow-Headers: Authorization, Content-Type, traceparent, tracestate, X-Request-Id`、`Max-Age: 600`)、それ以外は 403。`*` は使わない |
| 理由 | ヘッドレスでは画面と API のホスト名が分かれるのがふつう(CCv2 でも storefront と api は別のエンドポイント)。許可の一覧を持つことで、偽サイトのページから会員の API をブラウザ経由で使わせない。CORS はブラウザを守る仕組みで、curl は止めない(認可の代わりにはならない) |
| 却下した案 | `Access-Control-Allow-Origin: *`: どのサイトからでも読める。画面と API を同じオリジンにまとめる: CORS は要らないが、実案件の形と違う |
| 実物 | [apps/api/src/occ/cors.js](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/apps/api/src/occ/cors.js)・[manifest.json](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/manifest.json)(`CORS_ALLOWED_ORIGINS`) |

### 4.6 タイムアウトと見守り用の口 {#s4-6}
| 項目 | 内容 |
| --- | --- |
| 決定 | cdn-waf・ingress とも、奥への接続は 3 秒、応答の読み取りは 30 秒まで待つ。`/metrics`(全エンドポイント)と、api・backoffice の `/admin/`・`/readyz` は ingress で外から 403 にする(本格版は `<名前>-blocked` の Ingress で、許す範囲を `127.0.0.1/32` だけにして 403 にする)。Prometheus は各サービスを中から直接見る |
| 理由 | 奥が固まったときに入口の手まで全部ふさがらないようにする。指標やカオスの切り替えは内部の情報・機能なので外に見せない |
| 実物 | [ingress/default.conf.template](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/ingress/default.conf.template)・[k8s/generated/base/ingress.yaml](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/k8s/generated/base/ingress.yaml) |

### 4.7 入口を 2 段に分ける(cdn-waf と ingress) {#s4-7}
| 項目 | 内容 |
| --- | --- |
| 決定 | cdn-waf(クラスタの外): キャッシュ・WAF・全体のレート制限・セキュリティヘッダ。ingress(クラスタの入口): ホスト名での振り分け・IP フィルタ・ログインの回数制限・中の人だけの口を閉じる。cdn-waf は振り分けない、ingress はためない・WAF をしない、と役割を重ねない。本格版でも cdn-waf はクラスタの外のコンテナ(軽量版と同じイメージ・同じ設定ファイル)として置き、行き先 `INGRESS_UPSTREAM` だけを kind のノードの 80 番(ingress-nginx)に変える(`k8s/up.sh` が `INGRESS_UPSTREAM=lab-control-plane:80` で起動する。コンテナ名 `lab-cdn-waf`、ネットワーク `lab-kind` 172.30.91.0/24 の 172.30.91.10) |
| 理由 | 役割と持ち主が違う。CCv2 では CDN・WAF はお客さんが別に契約する外の盾、エンドポイントと IP フィルタは Cloud Portal の設定。たとえると、ショッピングモールの警備員(cdn-waf)と、お店の受付係(ingress) |
| 却下した案 | 1 段にまとめる(第 1 版の edge): 部品は減るが、「CDN を替えたら IP 制限も消えた」のような、持ち主の違いから来る事故が体験できない |
| 実物 | [cdn-waf/default.conf.template](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/cdn-waf/default.conf.template)(先頭の説明)・[ingress/default.conf.template](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/ingress/default.conf.template) |

### 4.8 エンドポイントごとの IP フィルタと環境の差 {#s4-8}
| 項目 | 内容 |
| --- | --- |
| 決定 | IP フィルタは名前付きの範囲(manifest.json の `ipFilters.office` = `127.0.0.1/32`・`172.30.89.0/24`(軽量版の Docker ネットワーク)・`172.30.91.0/24`(本格版の kind のネットワーク `lab-kind`))をエンドポイントに付ける形で持つ。p1(本番): www・api は誰でも、backoffice は `office`。d1・s1: www・api にも `office` を足す(`ipFilterOverrides`)。本格版では Ingress の注釈 `nginx.ingress.kubernetes.io/allowlist-source-range` になり、d1・s1 は `patches/ip-filter-*.yaml` で上書きする。範囲の外からは 403 |
| 理由 | 開発・検証の環境は、作りかけの物や本番に似たデータが見えるので社内だけにする。範囲を名前で持つと、社内の IP が変わったときに 1 か所直せば全エンドポイントに効く |
| 却下した案 | エンドポイントごとに IP を直書き: 範囲が変わったときに直し漏れが出る。検証環境も公開: 公開前の商品や価格が漏れる |
| 実物 | [manifest.json](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/manifest.json)(`ipFilters`・`environments`)・[k8s/generated/envs/d1/patches/ip-filter-www.yaml](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/k8s/generated/envs/d1/patches/ip-filter-www.yaml) |

## 5. 目標 {#s5}
| 項目 | 目標 | 計算・根拠 |
| --- | --- | --- |
| キャッシュで奥へ行く回数 | 1 URL あたり 30 秒に 1 回 | 1 秒 100 回見られる画面なら 100 × 30 = 3,000 回 → 1 回(残りは HIT) |
| ログイン中の人の応答をためる件数 | 0 | `X-Cache-Status: BYPASS` で確かめる |
| 外から `/admin/` に届く件数 | 0(すべて 403) | `curl http://api.lab.localhost:18080/admin/chaos` |
| 社外から backoffice に届く件数 | 0(すべて 403) | `lab_outside` のコンテナから `backoffice.lab.localhost` を開く |
| 許可していないオリジンへの CORS 許可 | 0 | `Origin: http://evil.example` で `Access-Control-Allow-Origin` が付かない |

## 6. 配下の詳細設計書 {#s6}
- [D-NW-01 cdn-waf と ingress の経路とキャッシュ](/design/detail/D-NW-01-edge-route)

## 7. 未決事項 {#s7}
| # | 内容 |
| --- | --- |
| 1 | キャッシュを手で消す手順(価格の訂正時・backoffice で CMS を変えた直後)。ラボでは 30 秒待てば消える |
| 2 | 本格版で ingress-nginx が cdn-waf の `X-Forwarded-For` を信じる設定(信じる相手の絞り方)が、軽量版の `set_real_ip_from` と同じ強さになっているか。今は ingress-nginx の ConfigMap で `use-forwarded-headers: "true"`・`proxy-real-ip-cidr: "172.30.91.0/24"`(lab-kind 全体)。軽量版の `set_real_ip_from`(cdn-waf の 1 台だけ)より広いので、`172.30.91.10/32` に絞るかを決める |
| 3 | JS・CSS(storefront が 1 年キャッシュしてよいと返す物)も cdn-waf でためるか。今は通すだけ |

## 8. レビュー観点 {#s8}
- [ ] 「ためてはいけない物」(ログイン中・本人だけの応答・エラーや空の画面)が列挙されているか
- [ ] キャッシュの時間に理由があるか(価格の訂正や CMS の変更がどれだけ遅れてよいか)
- [ ] エンドポイントごとに、誰が入れるか(IP フィルタ)が決まっているか。環境ごとの違いが一覧になっているか
- [ ] `X-Forwarded-For` を信じる相手が 1 つに絞られているか
- [ ] CORS を `*` にしていないか。許可先が画面のオリジンだけか
- [ ] 奥への待ち時間に上限があるか。管理・指標の口が外から見えないか

## この設計を体験する演習 {#exercises}
- [ネットワーク-1 前段のキャッシュ](/exercises/07-nw-cache)
- [ネットワーク-2 CORS と IP 制限](/exercises/08-nw-cors-and-ip)
- [ネットワーク-3 Ingress とエンドポイント](/exercises/20-nw-ingress-endpoints)
