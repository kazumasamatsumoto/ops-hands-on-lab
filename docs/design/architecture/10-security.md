# セキュリティ方式設計書(ラボ)

版: 2.0 / 親: [全体方式](/design/architecture/00-overall) / 対象: 入口の守り(cdn-waf の WAF・レート制限・ヘッダ、ingress の IP フィルタ・回数制限)とアプリの守り(OAuth・認可・CORS)

::: tip 3 行まとめ(この文書で決めたこと)
- cdn-waf の WAF は**遮断モード**で動かす(記録だけにしない)。疑い深さ 1、怪しさの点数 5 以上で 403。誤遮断は「どこの・どの項目だけ」の狭い例外で直す。
- 回数制限は 2 段: cdn-waf で全体を IP ごとに 1 秒 20 回(バースト 80)、ingress でトークンの発行(ログイン)を IP ごとに 1 秒 1 回(バースト 5)。超えたら 429。
- CSP はホスト名ごと、管理画面(backoffice)は社内 IP だけ、トークンは公開クライアント `storefront` にだけ 15 分で出す。入口の守りは網で、本命はアプリの書き方(認可・プレースホルダ)。
:::

## 0. 位置づけ {#s0}
全体方式の「利用者の通り道は cdn-waf の 1 か所」「入口を 2 段に分ける」を、守りの観点で決めます。アプリの中の守り(認証・認可・SQL)の作り方は [BE 方式](/design/architecture/02-backend) が決めます。
配下: [D-SEC-01 WAF とレート制限](/design/detail/D-SEC-01-waf-and-rate-limit)。

## 1. 目的と範囲 {#s1}
- **含む**: WAF、誤遮断の直し方、レート制限、管理の入口、セキュリティヘッダと CSP、秘密情報とパスワード、コンテナの権限、OAuth のクライアントとトークン。
- **含まない**: 依存の脆弱性スキャン、権限の棚卸し、監査ログ、外部の診断(現場では要る。[必要なこと一覧](/guide/checklist))。

## 2. 前提 {#s2}
| 前提 | 内容 |
| --- | --- |
| WAF | ModSecurity + OWASP CRS(イメージ `owasp/modsecurity-crs:4.25.1-nginx-alpine-202609241109-lts`)。cdn-waf の中で動く |
| 攻撃の見本 | [tools/attack-samples.sh](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/tools/attack-samples.sh) は送り先を `www.lab.localhost`・`api.lab.localhost` に固定し、`--resolve` で必ず 127.0.0.1 に向ける。実在のサイトには使わない |
| ログインの印 | お店は OAuth の `access_token` を `Authorization: Bearer` で送る(Cookie を使わない)。backoffice だけは Cookie `bo_session`(HttpOnly・SameSite=Strict)と CSRF トークンを使う |
| 画面と API | 別オリジン(`www.lab.localhost` と `api.lab.localhost`)。CORS の許可先は画面のオリジンだけ([ネットワーク方式 4.5](/design/architecture/04-network#s4-5)) |

## 3. 全体像 {#s3}
| 脅威 | 入口の守り(cdn-waf / ingress) | アプリの守り |
| --- | --- | --- |
| SQL インジェクション | cdn-waf の WAF が典型的な入力を 403 | プレースホルダ([BE 方式 4.4](/design/architecture/02-backend#s4-4)) |
| XSS | WAF が典型的な入力を 403。CSP で差し込まれたスクリプトを動かさない | Angular が表示のときに文字を無害化する(CMS の段落の HTML もサニタイズ) |
| パスワードの総当たり | ingress でトークンの発行を IP ごとに 1 秒 1 回 | scrypt でハッシュにして保存 |
| 大量のリクエスト | cdn-waf で IP ごとに 1 秒 20 回 | — |
| 他人のデータを見る(IDOR) | 入口では防げない | 持ち主の確かめ([BE 方式 4.3](/design/architecture/02-backend#s4-3)) |
| 管理の入口を狙う | ingress の IP フィルタ(backoffice)と、`/admin/`・`/metrics`・`/readyz` を外から 403 | backoffice のログインと CSRF トークン |
| 偽サイトから API を使わせる | — | CORS の許可先を画面のオリジンだけにする |
| トークンの盗用 | トークンの応答をためない(`Cache-Control: no-store`) | 寿命 15 分、DB にはハッシュだけ、取り消しできる |
| 他のサイトへの埋め込み | `X-Frame-Options: DENY`・`frame-ancestors 'none'` | — |

## 4. 決定事項 {#s4}
### 4.1 WAF {#s4-1}
| 項目 | 内容 |
| --- | --- |
| 決定 | `MODSEC_RULE_ENGINE=On`(遮断)。`BLOCKING_PARANOIA=1`(疑い深さ 1〜4 のうち 1)、`ANOMALY_INBOUND=5`(怪しさの点数がこれ以上で遮断)、`ANOMALY_OUTBOUND=4`。記録は JSON で標準出力へ。WAF は 3 つのホスト名すべてに掛ける(cdn-waf の持ち物。ingress では掛けない) |
| 理由 | 記録だけ(DetectionOnly)では止まらない。疑い深さ 1 は誤遮断が少なく、典型的な攻撃は止まる。WAF はクラスタに届く前(外の盾)で止めるのが役目 |
| 却下した案 | 疑い深さを上げる: 普通の入力の誤遮断が増える。止めずに記録だけ: 攻撃が素通りする |
| 実物 | [docker-compose.yml の cdn-waf](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/docker-compose.yml) |

### 4.2 誤遮断の直し方 {#s4-2}
| 項目 | 内容 |
| --- | --- |
| 決定 | 誤遮断は、WAF を切らずに「どの URL の、どの項目だけ、どのルールを外すか」を狭く書いて直す(例: `/occ/v2/samplestore/products/search` の `query` だけ、ルール 942100 を外す)。ルール ID は cdn-waf のログの `ruleId` で調べる。自分で作るルールの ID は 1〜99999。今、有効な例外は 0 件(書き方の見本だけ)。第 1 版で有効にしていた「Cookie を検査から外す」例外は、専用のホスト名にして他のアプリの Cookie が来なくなったので外した |
| 理由 | 例外は検査の穴になるので、狭く書き、要らなくなったら外す |
| 却下した案 | WAF ごと切る・閾値を大きく上げる: 全部の守りが外れる |
| 実物 | [cdn-waf/modsecurity/lab-exclusions-before.conf](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/cdn-waf/modsecurity/lab-exclusions-before.conf) |

### 4.3 レート制限 {#s4-3}
| 項目 | 内容 |
| --- | --- |
| 決定 | 2 段で持つ。**cdn-waf(全体)**: IP ごとに 1 秒 20 回(`EDGE_GLOBAL_RATE`)、バースト 80(`EDGE_GLOBAL_BURST`。画面 1 枚で JS・CSS・画像・api をまとめて取りに来るため)。3 つのホスト名で同じ帳簿を使う。**ingress(ログイン)**: `api.lab.localhost` の `/authorizationserver/oauth/token` を IP ごとに 1 秒 1 回、バースト 5(最初の 5 回は待たせずに通す)。本格版は Ingress `api-ratelimit-1` の注釈 `limit-rps: "1"`・`limit-burst-multiplier: "5"`。超えたら 429。api 側ではログインをロックしない。ingress は `X-Forwarded-For` を cdn-waf から来たときだけ信じるので、制限は利用者の IP で効く |
| 理由 | 全体の制限は 1 人の送りすぎから全員を守る(外の盾の仕事)。ログインの制限はパスワードの総当たりを遅くする(エンドポイントの持ち物)。1 秒 1 回なら 1 日で最大 86,400 回に抑えられる |
| 却下した案 | アカウントのロック: 他人の会員名で失敗を重ねて本人を締め出す嫌がらせに使われる。ログインの制限も cdn-waf に置く: CDN を替えたときに消える |
| 実物 | [cdn-waf/default.conf.template](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/cdn-waf/default.conf.template)(`limit_req_zone ... per_ip`)・[ingress/default.conf.template](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/ingress/default.conf.template)(`zone=login`)・[k8s/generated/base/ingress.yaml](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/k8s/generated/base/ingress.yaml) |

### 4.4 管理の入口 {#s4-4}
| 項目 | 内容 |
| --- | --- |
| 決定 | 管理画面は別のエンドポイント(`backoffice.lab.localhost`)にし、ingress の IP フィルタで社内の範囲(`127.0.0.1/32`・`172.30.89.0/24`・`172.30.91.0/24`)だけを通す。社外(`lab_outside` = `172.30.90.0/24`)からは 403。さらに、壊すスイッチ(`/admin/`)・指標(`/metrics`)・準備の確認(`/readyz`)は、どのエンドポイントでも ingress で外から 403 にする。backoffice のログインは `admin` / `BACKOFFICE_PASSWORD`、セッションは Cookie `bo_session`(HttpOnly・SameSite=Strict)、フォームは CSRF トークンで守る |
| 理由 | 壊すスイッチや管理画面は管理の機能そのもの。外から触れたら誰でもサイトを壊せる・価格を変えられる。入口を見えなくする(IP)と、入っても本人か確かめる(パスワード・CSRF)の 2 重にする |
| 却下した案 | 管理画面をお店と同じホスト名の `/backoffice/` に置く: IP フィルタをパスごとに書くことになり、抜けやすい。パスワードだけで守る: 入口が見えていれば総当たりされる |
| 実物 | [ingress/default.conf.template](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/ingress/default.conf.template)・[ingress/40-ip-filter.sh](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/ingress/40-ip-filter.sh)・[apps/api/src/aspects/backoffice.js](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/apps/api/src/aspects/backoffice.js) |

### 4.5 セキュリティヘッダと CSP {#s4-5}
| 項目 | 内容 |
| --- | --- |
| 決定 | cdn-waf がホスト名ごとに付ける。共通: `X-Content-Type-Options: nosniff`、`X-Frame-Options: DENY`。**www**: `Content-Security-Policy`(`WWW_CSP`)の `script-src` は自分のサイトの JS と、Angular が HTML に埋め込む小さなスクリプト 4 つ(sha256 の指紋。属性の中の 1 つのために `'unsafe-hashes'`)だけ。`connect-src` と `img-src` に api のオリジン `http://api.lab.localhost:18080`(ブラウザが別オリジンの api から JSON と画像を取るため)。`object-src 'none'`、`frame-ancestors 'none'`、`form-action 'self'`。`Referrer-Policy: strict-origin-when-cross-origin`。**api**: HTML を返さないので `default-src 'none'; frame-ancestors 'none'`。**backoffice**: サーバーで作る HTML に合わせ `script-src 'none'`、`Referrer-Policy: same-origin` |
| 理由 | 攻撃者が差し込んだ `<script>` は指紋が合わないので動かない(XSS の被害を小さくする最後の防壁)。ホスト名ごとに「読み込む物」が違うので、それぞれいちばん狭くする |
| 却下した案 | `'unsafe-inline'` でスクリプトを全部許す: CSP を付けていないのと同じになる。3 つのホスト名で同じ CSP: www に合わせると api と backoffice が必要以上に緩くなる |
| 実物 | [cdn-waf/default.conf.template](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/cdn-waf/default.conf.template)・[docker-compose.yml の WWW_CSP](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/docker-compose.yml) |

### 4.6 秘密情報とパスワード {#s4-6}
| 項目 | 内容 |
| --- | --- |
| 決定 | 秘密の値(`PGPASSWORD`・`BACKOFFICE_PASSWORD`)は manifest.json には名前だけを書く。リポジトリに置く値は見本の値だけ(compose の DB のパスワード `store`、管理画面 `admin`。本格版の Secret `lab-secrets` も見本の値)で、見本と分かるコメントを付ける。会員のパスワードは scrypt(わざと計算に時間がかかるハッシュ)で保存し、比べるときは時間の差が出ない比べ方をする |
| 理由 | 公開リポジトリに本物の秘密を置けば、その瞬間に漏れる。パスワードをそのまま保存すると、DB が漏れたときに全員のパスワードが漏れる |
| 実物 | [manifest.json](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/manifest.json)(`secrets`)・[k8s/platform/secret.yaml](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/k8s/platform/secret.yaml)・[db.js](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/apps/api/src/db.js) |

### 4.7 コンテナの権限 {#s4-7}
| 項目 | 内容 |
| --- | --- |
| 決定 | storefront・api(3 役とも)は一般ユーザー `node` で動かす。Alloy に渡す Docker のソケットは読むだけ(`:ro`)。18080 はホストの 127.0.0.1 にだけ開ける |
| 理由 | 乗っ取られたときにできることを減らす。攻撃の見本を同じ LAN に向けられないようにする |
| 実物 | [apps/api/Dockerfile](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/apps/api/Dockerfile)・[apps/web/Dockerfile](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/apps/web/Dockerfile)・[observability/compose.yml](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/observability/compose.yml) |

### 4.8 OAuth のクライアントとトークン {#s4-8}
| 項目 | 内容 |
| --- | --- |
| 決定 | トークンを出すのは、登録したクライアント `storefront` だけ(それ以外は 401 `invalid_client`)。`storefront` はブラウザで動く**公開クライアント**なので秘密の鍵(client_secret)を持たせない。受ける種類はパスワードグラントだけ(ほかは 400 `unsupported_grant_type`。学習用の選択で、本番の新規構築では使わない。未決事項 3)。トークンは推測できない 32 バイトの乱数、寿命 900 秒、DB には SHA-256 の値だけを置く。応答には `Cache-Control: no-store` を付けて途中でためさせない。ログアウトは `/authorizationserver/oauth/revoke` で取り消す。ブラウザではメモリと sessionStorage にだけ持つ([FE 方式 4.5](/design/architecture/01-frontend#s4-5)) |
| 理由 | ブラウザに置いた秘密の鍵は誰でも読めるので、持たせても守りにならない。そのぶん、寿命を短くし、受ける相手と種類を絞り、DB が漏れても使えない形で保存する |
| 却下した案 | client_secret を storefront の JS に埋め込む: 公開した瞬間に漏れる。寿命の長いトークン: 盗まれたときの被害が長く続く |
| 実物 | [apps/api/src/occ/oauth.js](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/apps/api/src/occ/oauth.js)・[apps/web/src/app/core/auth.service.ts](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/apps/web/src/app/core/auth.service.ts) |

## 5. 目標 {#s5}
| 項目 | 目標 | 確かめ方 |
| --- | --- | --- |
| 攻撃の見本 | 7 本すべて 403 | `tools/attack-samples.sh` |
| 普通の検索 | 2 本とも 200(誤遮断 0) | 同上 |
| ログインの試行 | IP ごとに 1 秒 1 回まで。6 回目以降の連打は 429 | 1 秒に 10 回送ると、最初の 6 回(1 回 + バースト 5)が通り、残りが 429 |
| 外から `/admin/` | すべて 403 | `curl -i http://api.lab.localhost:18080/admin/chaos` |
| 社外から backoffice | すべて 403 | `lab_outside` のコンテナから開く |
| トークンの寿命 | 900 秒 | トークンの応答の `expires_in` |

## 6. 配下の詳細設計書 {#s6}
- [D-SEC-01 WAF とレート制限](/design/detail/D-SEC-01-waf-and-rate-limit)

## 7. 未決事項 {#s7}
| # | 内容 |
| --- | --- |
| 1 | www の CSP の `style-src` に `'unsafe-inline'` が残っている。Angular の埋め込みスタイルを指紋か nonce にできるか |
| 2 | CSP の違反をどこかに報告させるか(`report-to`) |
| 3 | パスワードグラントをやめ、ログイン画面を認可サーバー側に置く形(認可コード + PKCE)にするか。今は仕組みを短く見せるためにパスワードグラントを使っているが、OAuth 2.0 の現行の指針(RFC 9700)では使ってはいけないとされ、OAuth 2.1 の案にも無い。Composable Storefront も新しい SAP Commerce Cloud では認可コードの流れが既定で、パスワードの流れは古い版向けの互換として残っているだけ。本番の新規構築では認可コード + PKCE を選ぶ |
| 4 | 依存パッケージとイメージの脆弱性スキャンをラボに入れるか |

## 8. レビュー観点 {#s8}
- [ ] WAF が「記録だけ」になっていないか
- [ ] 誤遮断の例外が「どの URL の・どの項目の・どのルール」まで狭く書かれているか。要らなくなった例外が残っていないか
- [ ] ログインなど狙われやすい入口に、個別のレート制限があるか。制限が利用者の本当の IP で効いているか
- [ ] CSP のスクリプトに `'unsafe-inline'` や `*` が入っていないか。ホスト名ごとに最小になっているか
- [ ] 管理の入口が別のエンドポイントになっていて、IP フィルタが掛かっているか
- [ ] 公開クライアントに秘密の鍵を持たせていないか。トークンの寿命と保存の形が決まっているか
- [ ] 秘密の値がリポジトリに入っていないか
- [ ] 入口の守りだけに頼らず、アプリの書き方(認可・プレースホルダ)でも守っているか

## この設計を体験する演習 {#exercises}
- [セキュリティ-1 WAF が攻撃を止める](/exercises/17-sec-waf)
- [セキュリティ-2 ログインの連打を止める](/exercises/18-sec-rate-limit-login)
- [セキュリティ-3 CSP で外部スクリプトを止める](/exercises/19-sec-csp)
- [ネットワーク-2 CORS と IP 制限](/exercises/08-nw-cors-and-ip)
- [ネットワーク-3 Ingress とエンドポイント](/exercises/20-nw-ingress-endpoints)
