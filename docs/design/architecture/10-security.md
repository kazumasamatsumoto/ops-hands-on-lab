# セキュリティ方式設計書(ラボ)

版: 1.0 / 親: [全体方式](/design/architecture/00-overall) / 対象: 入口の守り(WAF・レート制限・ヘッダ)とアプリの守り

::: tip 3 行まとめ(この文書で決めたこと)
- 入口(edge)の WAF は**遮断モード**で動かす(記録だけにしない)。疑い深さ 1、怪しさの点数 5 以上で 403。誤遮断は「どこの・どの項目だけ」の狭い例外で直す。
- ログインは IP ごとに 1 秒 1 回(最初の 5 回はまとめて可)、全体は IP ごとに 1 秒 20 回。超えたら 429。
- 読み込んでよい物を CSP で縛り、管理の入口は内部からだけ。入口の守りは網で、本命はアプリの書き方(認可・プレースホルダ)。
:::

## 0. 位置づけ {#s0}
全体方式の「利用者の通り道は edge の 1 か所」を、守りの観点で決めます。アプリの中の守り(認証・認可・SQL)は [BE 方式](/design/architecture/02-backend) が決めます。
配下: [D-SEC-01 WAF とレート制限](/design/detail/D-SEC-01-waf-and-rate-limit)。

## 1. 目的と範囲 {#s1}
- **含む**: WAF、誤遮断の直し方、レート制限、管理の入口、セキュリティヘッダと CSP、秘密情報とパスワード、コンテナの権限。
- **含まない**: 依存の脆弱性スキャン、権限の棚卸し、監査ログ、外部の診断(現場では要る。[必要なこと一覧](/guide/checklist) 67〜70)。

## 2. 前提 {#s2}
| 前提 | 内容 |
| --- | --- |
| WAF | ModSecurity + OWASP CRS(イメージ `owasp/modsecurity-crs:4.25.1-nginx-alpine-202609241109-lts`) |
| 攻撃の見本 | [tools/attack-samples.sh](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/tools/attack-samples.sh) は送り先を `http://localhost:18080` に固定。実在のサイトには使わない |
| ログインの印 | JWT を `Authorization` ヘッダで送る。サンプルストアは Cookie を使わない |

## 3. 全体像 {#s3}
| 脅威 | 入口(edge)の守り | アプリの守り |
| --- | --- | --- |
| SQL インジェクション | WAF が典型的な入力を 403 | プレースホルダ([BE 方式 4.4](/design/architecture/02-backend#s4-4)) |
| XSS | WAF が典型的な入力を 403。CSP で差し込まれたスクリプトを動かさない | Angular が表示のときに文字を無害化する |
| パスワードの総当たり | ログインのレート制限 | scrypt でハッシュにして保存 |
| 他人のデータを見る(IDOR) | 入口では防げない | 持ち主の確かめ([BE 方式 4.3](/design/architecture/02-backend#s4-3)) |
| 管理の入口を狙う | 内部からだけ通す | — |
| 他のサイトへの埋め込み | `X-Frame-Options: DENY`・`frame-ancestors 'none'` | — |

## 4. 決定事項 {#s4}
### 4.1 WAF {#s4-1}
| 項目 | 内容 |
| --- | --- |
| 決定 | `MODSEC_RULE_ENGINE=On`(遮断)。`BLOCKING_PARANOIA=1`(疑い深さ 1〜4 のうち 1)、`ANOMALY_INBOUND=5`(怪しさの点数がこれ以上で遮断)、`ANOMALY_OUTBOUND=4`。記録は JSON で標準出力へ |
| 理由 | 記録だけ(DetectionOnly)では止まらない。疑い深さ 1 は誤遮断が少なく、典型的な攻撃は止まる |
| 却下した案 | 疑い深さを上げる: 普通の入力の誤遮断が増える。止めずに記録だけ: 攻撃が素通りする |
| 実物 | [docker-compose.yml の edge](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/docker-compose.yml) |

### 4.2 誤遮断の直し方 {#s4-2}
| 項目 | 内容 |
| --- | --- |
| 決定 | 誤遮断は、WAF を切らずに「どの URL の、どの項目だけ、どのルールを外すか」を狭く書いて直す。ルール ID は edge のログの `ruleId` で調べる。自分で作るルールの ID は 1〜99999。今有効なのは 1 件: Cookie とその名前だけを検査の対象から外す(URL やパラメータの検査は残す) |
| 理由 | ブラウザは `localhost` の Cookie を別のポートのアプリとも共有するため、他のアプリの長い Cookie でラボの画面が 403 になった(実際に起きた誤遮断)。サンプルストアは Cookie を使わないので外しても守りは弱まらない |
| 却下した案 | WAF ごと切る・閾値を大きく上げる: 全部の守りが外れる |
| 実物 | [lab-exclusions-before.conf](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/edge/modsecurity/lab-exclusions-before.conf#L15-L24) |

### 4.3 レート制限 {#s4-3}
| 項目 | 内容 |
| --- | --- |
| 決定 | `/api/login`: IP ごとに 1 秒 1 回、バースト 5(最初の 5 回は待たせずに通す)。全体: IP ごとに 1 秒 20 回(`EDGE_GLOBAL_RATE`)、バースト 40(画面 1 枚で JS・CSS をまとめて取りに来るため)。超えたら 429。api 側ではログインをロックしない |
| 理由 | パスワードの総当たりを遅くする。1 秒 1 回なら 1 日で最大 86,400 回に抑えられる(制限なしなら 1 秒に何百回も試せる) |
| 却下した案 | アカウントのロック: 他人の会員名で失敗を重ねて本人を締め出す嫌がらせに使われる |
| 実物 | [default.conf.template](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/edge/default.conf.template#L40-L60)・[同 L118-L123](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/edge/default.conf.template#L118-L123) |

### 4.4 管理の入口 {#s4-4}
| 項目 | 内容 |
| --- | --- |
| 決定 | `/admin/` は 127.0.0.1 と Docker の内部ネットワーク(`172.30.89.0/24`、ゲートウェイの `.1` を除く)だけ。web の `/metrics` も外に出さない |
| 理由 | 壊すスイッチは管理の機能そのもの。外から触れたら誰でもサイトを壊せる |
| 実物 | [default.conf.template](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/edge/default.conf.template#L99-L115) |

### 4.5 セキュリティヘッダと CSP {#s4-5}
| 項目 | 内容 |
| --- | --- |
| 決定 | 全応答に `Content-Security-Policy`(`EDGE_CSP`)、`X-Content-Type-Options: nosniff`、`Referrer-Policy: strict-origin-when-cross-origin`、`X-Frame-Options: DENY` を付ける。CSP の `script-src` は自分のサイトの JS と、Angular が HTML に埋め込む小さなスクリプト 4 つ(sha256 の指紋で指定)だけ。`object-src 'none'`、`frame-ancestors 'none'`、`form-action 'self'` |
| 理由 | 攻撃者が差し込んだ `<script>` は指紋が合わないので動かない(XSS の被害を小さくする最後の防壁) |
| 却下した案 | `'unsafe-inline'` でスクリプトを全部許す: CSP を付けていないのと同じになる |
| 実物 | [default.conf.template](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/edge/default.conf.template#L62-L69)・[docker-compose.yml の EDGE_CSP](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/docker-compose.yml) |

### 4.6 秘密情報とパスワード {#s4-6}
| 項目 | 内容 |
| --- | --- |
| 決定 | リポジトリに置く秘密の値は見本の値だけ(`JWT_SECRET: lab-only-not-a-real-secret`、DB のパスワード `store`)で、見本と分かる名前・印を付ける。会員のパスワードは scrypt(わざと計算に時間がかかるハッシュ)で保存し、比べるときは時間の差が出ない比べ方をする |
| 理由 | 公開リポジトリに本物の秘密を置けば、その瞬間に漏れる。パスワードをそのまま保存すると、DB が漏れたときに全員のパスワードが漏れる |
| 実物 | [secret.yaml](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/k8s/manifests/secret.yaml)・[db.js](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/apps/api/src/db.js#L24-L36) |

### 4.7 コンテナの権限 {#s4-7}
| 項目 | 内容 |
| --- | --- |
| 決定 | api・web は一般ユーザー `node` で動かす。Alloy に渡す Docker のソケットは読むだけ(`:ro`) |
| 理由 | 乗っ取られたときにできることを減らす |
| 実物 | [apps/api/Dockerfile](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/apps/api/Dockerfile) |

## 5. 目標 {#s5}
| 項目 | 目標 | 確かめ方 |
| --- | --- | --- |
| 攻撃の見本 | 6 本すべて 403 | `tools/attack-samples.sh` |
| 普通の検索 | 200(誤遮断 0) | 同上の 1 本目 |
| ログインの試行 | IP ごとに 1 秒 1 回まで。6 回目以降の連打は 429 | 1 秒に 10 回送ると、最初の 6 回(1 回 + バースト 5)が通り、残りが 429 |
| 外から `/admin/` | すべて 403 | `curl -i http://localhost:18080/admin/chaos` |

## 6. 配下の詳細設計書 {#s6}
- [D-SEC-01 WAF とレート制限](/design/detail/D-SEC-01-waf-and-rate-limit)

## 7. 未決事項 {#s7}
| # | 内容 |
| --- | --- |
| 1 | CSP の `style-src` に `'unsafe-inline'` が残っている。Angular の埋め込みスタイルを指紋か nonce にできるか |
| 2 | CSP の違反をどこかに報告させるか(`report-to`) |
| 3 | 依存パッケージとイメージの脆弱性スキャンをラボに入れるか |

## 8. レビュー観点 {#s8}
- [ ] WAF が「記録だけ」になっていないか
- [ ] 誤遮断の例外が「どの URL の・どの項目の・どのルール」まで狭く書かれているか
- [ ] ログインなど狙われやすい入口に、個別のレート制限があるか
- [ ] CSP のスクリプトに `'unsafe-inline'` や `*` が入っていないか
- [ ] 秘密の値がリポジトリに入っていないか
- [ ] 入口の守りだけに頼らず、アプリの書き方(認可・プレースホルダ)でも守っているか

## この設計を体験する演習 {#exercises}
- [セキュリティ-1 WAF が攻撃を止める](/exercises/17-sec-waf)
- [セキュリティ-2 ログインの連打を止める](/exercises/18-sec-rate-limit-login)
- [セキュリティ-3 CSP で外部スクリプトを止める](/exercises/19-sec-csp)
- [ネットワーク-2 CORS と IP 制限](/exercises/08-nw-cors-and-ip)
