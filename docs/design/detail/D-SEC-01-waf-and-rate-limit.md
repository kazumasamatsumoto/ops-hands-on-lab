# D-SEC-01 WAF とレート制限

版: 2.0 / 親: [セキュリティ方式](/design/architecture/10-security) / 対象: cdn-waf の ModSecurity(OWASP CRS)・全体のレート制限・セキュリティヘッダ、ingress のログインの回数制限

::: tip 3 行まとめ(この文書で決めたこと)
- WAF は cdn-waf(クラスタの外の CDN・WAF の役)に置きます。遮断モード(`MODSEC_RULE_ENGINE=On`)、疑い深さ 1、怪しさの点数 5 以上で 403。誤遮断の例外は `lab-exclusions-before.conf` に「狭く」書きます(今は見本だけで、有効な例外は 0 件)。
- レート制限は IP ごとに 2 段です。cdn-waf で全体 1 秒 20 回・バースト 80(3 つのホスト名の合計)、ingress でトークンの発行(`/authorizationserver/oauth/token`)を 1 秒 1 回・バースト 5。超えたら 429。
- セキュリティヘッダはホスト名ごとに付けます(www は画面に合わせた CSP、api は何も読み込ませない CSP、backoffice はスクリプトなし)。確かめは `tools/attack-samples.sh`(送り先はラボに固定)。
:::

## 0. 親の方式設計書 {#s0}
| 項目 | 内容 |
| --- | --- |
| 親 | [セキュリティ方式](/design/architecture/10-security) |
| 引き継ぐ決定 | 4.1 WAF、4.2 誤遮断の直し方、4.3 レート制限、4.5 セキュリティヘッダと CSP、[4.8 OAuth](/design/architecture/10-security#s4-8) |
| またがる層 | [D-NW-01](/design/detail/D-NW-01-edge-route)(同じ cdn-waf・ingress の設定)、[QA 方式 4.4](/design/architecture/06-qa#s4-4) |

## 1. 目的と範囲 {#s1}
- **含む**: WAF の設定値と変え方、例外の書き方、レート制限の値と置き場所、ヘッダの値、確かめ方、ログの見方。
- **含まない**: アプリの中の守り(認可・SQL の書き方は [BE 方式](/design/architecture/02-backend))、backoffice の IP フィルタ([D-NW-01](/design/detail/D-NW-01-edge-route))。

## 2. 前提 {#s2}
| 前提 | 内容 |
| --- | --- |
| イメージ | `owasp/modsecurity-crs:4.25.1-nginx-alpine-202609241109-lts`。WAF の本体設定はイメージ側、値は環境変数で渡す |
| 例外の置き場所 | `/opt/owasp-crs/plugins/lab-exclusions-before.conf`(CRS の本体ルールより先に読まれる)。元のファイルは [cdn-waf/modsecurity/lab-exclusions-before.conf](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/cdn-waf/modsecurity/lab-exclusions-before.conf) |
| 利用者の IP | cdn-waf は、ホスト PC から来た通信を 127.0.0.1、ネットワークの中からの通信は送り元の IP として数える。ingress は cdn-waf(172.30.89.10)が書いた `X-Forwarded-For` の IP で数える |
| 攻撃の見本 | ラボ(`http://www.lab.localhost:18080`・`http://api.lab.localhost:18080`)にだけ送る。送り先は固定で、`curl --resolve` で名前を必ず 127.0.0.1 に向ける。実在のサイトに送ってはいけない(法律に触れるおそれがある) |

## 3. 全体像 {#s3}
```text
リクエスト → cdn-waf
               ModSecurity(CRS のルールで怪しさを点数にする)
                 点数 ≥ ANOMALY_INBOUND(5)→ 403
               全体のレート制限(IP ごと。www・api・backoffice の合計)
                 20r/s + burst 80 を超える → 429
               応答にホスト名ごとの CSP・nosniff・Referrer-Policy・X-Frame-Options を付ける
           → ingress
               api.lab.localhost の /authorizationserver/oauth/token
                 1r/s + burst 5 を超える → 429
               (振り分け・IP フィルタ・閉じる口は D-NW-01)
```

## 4. 仕様 {#s4}
### 4.1 WAF の設定値 {#s4-1}
| 環境変数 | 値 | 意味 | 変えると |
| --- | --- | --- | --- |
| `MODSEC_RULE_ENGINE` | `On` | 遮断する | `DetectionOnly` で記録だけ(攻撃も通る) |
| `BLOCKING_PARANOIA` | `1` | 疑い深さ(1〜4) | 上げるほど厳しく、誤遮断も増える |
| `ANOMALY_INBOUND` | `5` | 入ってくる物の怪しさの点数の閾値 | 上げるほど甘くなる |
| `ANOMALY_OUTBOUND` | `4` | 返す物の怪しさの閾値 | — |
| `MODSEC_AUDIT_LOG_FORMAT` / `MODSEC_AUDIT_LOG` | `JSON` / `/dev/stdout` | 遮断の記録を JSON で標準出力へ(Loki に `service="cdn-waf"` で集まる) | — |

`BLOCKING_PARANOIA` と `ANOMALY_INBOUND` は、`BLOCKING_PARANOIA=2 docker compose up -d cdn-waf` のように一時的に変えられます。
実物: [docker-compose.yml の cdn-waf](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/docker-compose.yml)

### 4.2 例外の書き方 {#s4-2}
| 決まり | 内容 |
| --- | --- |
| 範囲 | 「どの URL の・どの項目の・どのルール」まで狭くする。WAF 全体や閾値で直さない |
| ルール ID の調べ方 | `docker compose logs cdn-waf` の `ruleId` |
| 自分のルールの ID | 1〜99999(CRS 本体とぶつからない) |
| 反映 | `docker compose restart cdn-waf` |
| 今有効な例外 | **なし** |
| 見本 1(無効) | ID 1000: api の `/occ/v2/samplestore/products/search` の `query` だけ、SQL インジェクションのルール 942100 を外す(書き方の見本。先頭の `#` を外すと有効) |
| 見本 2(無効。外した例外) | ID 1001: Cookie を検査の対象から外す。第 1 版は `http://localhost:18080` で開いていたため、同じ PC の別のアプリの Cookie が送られて誤遮断が起きた。第 2 版は専用のホスト名(`*.lab.localhost`)なので要らなくなり、外した。**例外は要らなくなったら外す**(外さないと検査の穴として残る) |

### 4.3 レート制限 {#s4-3}
| 置き場所 | 帳簿 | 対象 | 速さ | バースト | 超えたら |
| --- | --- | --- | --- | --- | --- |
| cdn-waf | `per_ip` | 3 つのホスト名のすべて(IP ごとの合計) | `EDGE_GLOBAL_RATE`(既定 `20r/s`) | `EDGE_GLOBAL_BURST`(既定 80、nodelay) | 429 |
| ingress | `login` | `api.lab.localhost` の `= /authorizationserver/oauth/token`(IP ごと) | 1r/s | 5(nodelay) | 429 |

- 帳簿の大きさはそれぞれ 10MB。超えたときは warn でログに残します(`limit_req_log_level warn`)。
- `nodelay` = バーストの分は待たせずにすぐ通し、それを超えた分はすぐ 429 にします。
- 全体の制限のバーストを 80 にしているのは、画面 1 枚で JS・CSS・画像・api をまとめて取りに来るためです。
- api はわざと「何度失敗してもロックしない」ので、ingress の制限がログインの総当たりの唯一の歯止めです。
- 本格版では、同じ回数制限を Ingress `api-ratelimit-1` の注釈(`limit-rps: "1"`・`limit-burst-multiplier: "5"`)で書きます。

実物: [cdn-waf/default.conf.template](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/cdn-waf/default.conf.template)・[ingress/default.conf.template](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/ingress/default.conf.template)・[k8s/generated/base/ingress.yaml](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/k8s/generated/base/ingress.yaml)

### 4.4 セキュリティヘッダ {#s4-4}
3 つのホスト名に共通のヘッダ:

| ヘッダ | 値 | 意味 |
| --- | --- | --- |
| `X-Content-Type-Options` | `nosniff` | ファイルの種類を勝手に推測させない |
| `Referrer-Policy` | www・api: `strict-origin-when-cross-origin` / backoffice: `same-origin` | 他のサイトへは URL の細部を渡さない |
| `X-Frame-Options` | `DENY` | 他のサイトに埋め込ませない |

ホスト名ごとの `Content-Security-Policy`:

| ホスト名 | CSP の要点 |
| --- | --- |
| www(`WWW_CSP`) | `default-src 'self'`、`script-src 'self' 'unsafe-hashes'` + sha256 の指紋 4 つ(Angular が HTML に埋め込むスクリプト)、`style-src 'self' 'unsafe-inline'`、`img-src 'self' data: http://api.lab.localhost:18080`、`font-src 'self' data:`、`connect-src 'self' http://api.lab.localhost:18080`、`object-src 'none'`、`base-uri 'self'`、`form-action 'self'`、`frame-ancestors 'none'` |
| api | `default-src 'none'; frame-ancestors 'none'`(HTML を返さないので何も読み込ませない) |
| backoffice | `default-src 'self'; script-src 'none'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; form-action 'self'; base-uri 'self'; frame-ancestors 'none'`(サーバーで作る HTML、スクリプトなし) |

- backoffice の応答には、上の cdn-waf の CSP とは別に、アプリ(backoffice)自身も `default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'` という CSP を付けています([backoffice.js](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/apps/api/src/aspects/backoffice.js))。CSP が 2 つあると、ブラウザは **両方を守る**(どちらにも許されたものだけ通す)ので、実際には厳しいアプリ側が効きます。たとえば cdn-waf が許している `img-src 'self' data:` の画像も、アプリ側に `img-src` が無いので表示されません(今の管理画面は画像を使っていないので困りません)。CSP をどこで付けるかは 1 か所に決めておくと、「設定したのに効かない」を防げます。
- www の `connect-src` と `img-src` に api の住所があるのは、ブラウザが別オリジンの api から JSON と商品画像を取るためです。
- Angular を更新して埋め込みスクリプトが変わると、ブラウザに `Refused to execute inline script` と出ます。表示された `sha256-...` を docker-compose.yml の `WWW_CSP` に足し、`docker compose up -d cdn-waf` で反映します。

## 5. 目標と確認方法 {#s5}
| 項目 | 目標 | 確かめ方 |
| --- | --- | --- |
| 攻撃の見本 | api の検索(SQL インジェクション 3 本・XSS 1 本・パスの巡回 1 本)と画面の検索(SQL インジェクション 1 本・XSS 1 本)がすべて 403 | `tools/attack-samples.sh` |
| 普通の検索 | 200 | 同上の「普通の検索(通るべき)」2 本 |
| ログインの連打 | 最初の数回が通り、そのあと 429 | 1 秒に 10 回 `POST http://api.lab.localhost:18080/authorizationserver/oauth/token` |
| 全体の制限 | 入口経由の負荷で 429 が出る | `tools/k6.sh ramp.js`(20 人の段から) |
| ヘッダ | 各ホスト名に CSP など 4 つ | `curl -sI http://www.lab.localhost:18080/`、`curl -sI http://api.lab.localhost:18080/occ/v2/samplestore/products/100001` |
| 遮断の理由 | ログで分かる | `docker compose logs cdn-waf` の `ruleId` |

## 6. 関連する文書 {#s6}
- [D-NW-01 cdn-waf と ingress の経路とキャッシュ](/design/detail/D-NW-01-edge-route)
- [D-BE 注文 API と認可](/design/detail/D-BE-orders-api)(トークンの発行)
- [D-PERF-05 負荷試験](/design/detail/D-PERF-05-load-test)(全体のレート制限が負荷試験にも効く)
- 仕組みの説明: [cdn-waf](/how-it-works/01-cdn-waf)

## 7. 未決事項 {#s7}
| # | 内容 |
| --- | --- |
| 1 | 本番のように利用者が多い場合、IP ごとの制限は同じ会社や同じ携帯回線の人をまとめて止めてしまう。会員ごとの制限を足すか |
| 2 | CSP の `style-src 'unsafe-inline'` と `'unsafe-hashes'` を外せるか |
| 3 | 遮断・429 の件数を指標にしてアラートにするか(攻撃が急に増えたとき) |

## 8. レビュー観点 {#s8}
- [ ] WAF が遮断モードになっているか
- [ ] 例外が狭く書かれ、理由がコメントにあるか。要らなくなった例外が残っていないか
- [ ] 例外を足したあとで、攻撃の見本がまだ 403 になるか
- [ ] ログインに、全体より厳しい制限があるか。数える IP が本当の利用者の IP か(`X-Forwarded-For` を信じる相手が絞られているか)
- [ ] CSP のスクリプトに `'unsafe-inline'` が無いか。ホスト名ごとに必要な物だけを許しているか
- [ ] 攻撃の見本の送り先が固定されているか

## この設計を体験する演習 {#exercises}
- [セキュリティ-1 WAF が攻撃を止める](/exercises/17-sec-waf)
- [セキュリティ-2 ログインの連打を止める](/exercises/18-sec-rate-limit-login)
- [セキュリティ-3 CSP で外部スクリプトを止める](/exercises/19-sec-csp)
