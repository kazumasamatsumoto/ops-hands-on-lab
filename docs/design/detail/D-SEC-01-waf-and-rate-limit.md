# D-SEC-01 WAF とレート制限

版: 1.0 / 親: [セキュリティ方式](/design/architecture/10-security) / 対象: edge の ModSecurity(OWASP CRS)・レート制限・セキュリティヘッダ

::: tip 3 行まとめ(この文書で決めたこと)
- WAF は遮断モード、疑い深さ 1、怪しさの点数 5 以上で 403。誤遮断の例外は `lab-exclusions-before.conf` に「狭く」書く(今は Cookie だけを外す 1 件)。
- レート制限は IP ごと。`/api/login` は 1 秒 1 回・バースト 5、全体は 1 秒 20 回・バースト 40。超えたら 429。
- すべての応答に CSP など 4 つのセキュリティヘッダを付ける。確かめは `tools/attack-samples.sh`(送り先はラボに固定)。
:::

## 0. 親の方式設計書 {#s0}
| 項目 | 内容 |
| --- | --- |
| 親 | [セキュリティ方式](/design/architecture/10-security) |
| 引き継ぐ決定 | 4.1 WAF、4.2 誤遮断の直し方、4.3 レート制限、4.5 セキュリティヘッダと CSP |
| またがる層 | [D-NW-01](/design/detail/D-NW-01-edge-route)(同じ edge の設定)、[QA 方式 4.4](/design/architecture/06-qa#s4-4) |

## 1. 目的と範囲 {#s1}
- **含む**: WAF の設定値と変え方、例外の書き方、レート制限の値、ヘッダの値、確かめ方、ログの見方。
- **含まない**: アプリの中の守り(認可・SQL の書き方は [BE 方式](/design/architecture/02-backend))。

## 2. 前提 {#s2}
| 前提 | 内容 |
| --- | --- |
| イメージ | `owasp/modsecurity-crs:4.25.1-nginx-alpine-202609241109-lts`。WAF の本体設定はイメージ側、値は環境変数で渡す |
| 例外の置き場所 | `/opt/owasp-crs/plugins/lab-exclusions-before.conf`(CRS の本体ルールより先に読まれる) |
| 攻撃の見本 | ラボ(`http://localhost:18080`)にだけ送る。実在のサイトに送ってはいけない(法律に触れるおそれがある) |

## 3. 全体像 {#s3}
```text
リクエスト → ModSecurity(CRS のルールで怪しさを点数にする)
               点数 ≥ ANOMALY_INBOUND(5)→ 403
           → レート制限(IP ごと)
               /api/login: 1r/s + burst 5 を超える → 429
               全体: 20r/s + burst 40 を超える → 429
           → 振り分け(D-NW-01)
応答 ← CSP・nosniff・Referrer-Policy・X-Frame-Options を付ける
```

## 4. 仕様 {#s4}
### 4.1 WAF の設定値 {#s4-1}
| 環境変数 | 値 | 意味 | 変えると |
| --- | --- | --- | --- |
| `MODSEC_RULE_ENGINE` | `On` | 遮断する | `DetectionOnly` で記録だけ(攻撃も通る) |
| `BLOCKING_PARANOIA` | `1` | 疑い深さ(1〜4) | 上げるほど厳しく、誤遮断も増える |
| `ANOMALY_INBOUND` | `5` | 入ってくる物の怪しさの点数の閾値 | 上げるほど甘くなる |
| `ANOMALY_OUTBOUND` | `4` | 返す物の怪しさの閾値 | — |
| `MODSEC_AUDIT_LOG_FORMAT` / `MODSEC_AUDIT_LOG` | `JSON` / `/dev/stdout` | 遮断の記録を JSON で標準出力へ(Loki に集まる) | — |

`BLOCKING_PARANOIA` と `ANOMALY_INBOUND` は、`BLOCKING_PARANOIA=2 docker compose up -d edge` のように一時的に変えられる。
実物: [docker-compose.yml の edge](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/docker-compose.yml)

### 4.2 例外の書き方 {#s4-2}
| 決まり | 内容 |
| --- | --- |
| 範囲 | 「どの URL の・どの項目の・どのルール」まで狭くする。WAF 全体や閾値で直さない |
| ルール ID の調べ方 | `docker compose logs edge` の `ruleId` |
| 自分のルールの ID | 1〜99999(CRS 本体とぶつからない) |
| 反映 | `docker compose restart edge` |
| 今有効な例外 | ID 1001: すべての CRS ルールの検査対象から `REQUEST_COOKIES` と `REQUEST_COOKIES_NAMES` を外す。理由: ブラウザが `localhost` の別アプリの Cookie を送ってきて 403 になった(サンプルストアは Cookie を使わない) |
| 見本(無効) | ID 1000: `/api/products` の `q` だけ、SQL インジェクションのルール 942100 を外す(書き方の見本。先頭の `#` を外すと有効) |

実物: [lab-exclusions-before.conf](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/edge/modsecurity/lab-exclusions-before.conf)

### 4.3 レート制限 {#s4-3}
| 帳簿 | 対象 | 速さ | バースト | 超えたら | 行 |
| --- | --- | --- | --- | --- | --- |
| `per_ip` | すべて(IP ごと) | `EDGE_GLOBAL_RATE`(既定 20r/s) | 40(nodelay) | 429 | [L42](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/edge/default.conf.template#L42)・[L60](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/edge/default.conf.template#L60) |
| `login` | `/api/login`(IP ごと) | 1r/s | 5(nodelay) | 429 | [L43](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/edge/default.conf.template#L43)・[L118-L123](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/edge/default.conf.template#L118-L123) |

帳簿の大きさはそれぞれ 10MB。超えたときは warn でログに残す(`limit_req_log_level warn`)。
`nodelay` = バーストの分は待たせずにすぐ通し、それを超えた分はすぐ 429 にする。

### 4.4 セキュリティヘッダ {#s4-4}
| ヘッダ | 値 | 意味 |
| --- | --- | --- |
| `Content-Security-Policy` | `EDGE_CSP`(下の表) | 読み込んでよい物の一覧 |
| `X-Content-Type-Options` | `nosniff` | ファイルの種類を勝手に推測させない |
| `Referrer-Policy` | `strict-origin-when-cross-origin` | 他のサイトへは URL の細部を渡さない |
| `X-Frame-Options` | `DENY` | 他のサイトに埋め込ませない |

| CSP の項目 | 値 |
| --- | --- |
| `default-src` | `'self'` |
| `script-src` | `'self' 'unsafe-hashes'` + sha256 の指紋 4 つ(Angular が HTML に埋め込むスクリプト) |
| `style-src` | `'self' 'unsafe-inline'` |
| `img-src`・`font-src` | `'self' data:` |
| `connect-src` | `'self'` |
| `object-src` | `'none'` |
| `base-uri`・`form-action` | `'self'` |
| `frame-ancestors` | `'none'` |

Angular を更新して埋め込みスクリプトが変わると、ブラウザに `Refused to execute inline script` と出る。表示された `sha256-...` を `EDGE_CSP` に足す。
実物: [default.conf.template L62-L69](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/edge/default.conf.template#L62-L69)

## 5. 目標と確認方法 {#s5}
| 項目 | 目標 | 確かめ方 |
| --- | --- | --- |
| 攻撃の見本 | SQL インジェクション 3 本・XSS 2 本・パスの巡回 1 本がすべて 403 | `tools/attack-samples.sh` |
| 普通の検索 | 200 | 同上の 1 本目(「ノート」の検索) |
| ログインの連打 | 最初の数回が通り、そのあと 429 | 1 秒に 10 回 `POST /api/login` |
| ヘッダ | 4 つが付いている | `curl -sI http://localhost:18080/` |
| 遮断の理由 | ログで分かる | `docker compose logs edge` の `ruleId` |

## 6. 関連する文書 {#s6}
- [D-NW-01 edge の経路とキャッシュ](/design/detail/D-NW-01-edge-route)
- [D-BE 注文 API と認可](/design/detail/D-BE-orders-api)(ログイン)
- [D-PERF-05 負荷試験](/design/detail/D-PERF-05-load-test)(全体のレート制限が負荷試験にも効く)

## 7. 未決事項 {#s7}
| # | 内容 |
| --- | --- |
| 1 | 本番のように利用者が多い場合、IP ごとの制限は同じ会社や同じ携帯回線の人をまとめて止めてしまう。会員ごとの制限を足すか |
| 2 | CSP の `style-src 'unsafe-inline'` を外せるか |
| 3 | 遮断の件数を指標にしてアラートにするか(攻撃が急に増えたとき) |

## 8. レビュー観点 {#s8}
- [ ] WAF が遮断モードになっているか
- [ ] 例外が狭く書かれ、理由がコメントにあるか
- [ ] 例外を足したあとで、攻撃の見本がまだ 403 になるか
- [ ] ログインに、全体より厳しい制限があるか
- [ ] CSP のスクリプトに `'unsafe-inline'` が無いか
- [ ] 攻撃の見本の送り先が固定されているか

## この設計を体験する演習 {#exercises}
- [セキュリティ-1 WAF が攻撃を止める](/exercises/17-sec-waf)
- [セキュリティ-2 ログインの連打を止める](/exercises/18-sec-rate-limit-login)
- [セキュリティ-3 CSP で外部スクリプトを止める](/exercises/19-sec-csp)
