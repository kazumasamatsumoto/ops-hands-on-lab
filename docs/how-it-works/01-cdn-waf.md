---
title: 仕組み-1 cdn-waf(CDN と WAF)
---

# 仕組み-1 cdn-waf(CDN と WAF)

::: tip このページで分かること
- cdn-waf が 1 つのリクエストに対して、**どの順で何を確かめ、何を足すか**。
- キャッシュ(ためて使い回す)・レート制限(回数の制限)・WAF(攻撃の遮断)・セキュリティヘッダの設定の 1 行ずつの意味。
- CCv2 の案件で、この役を誰が持つのか(CCv2 の中にはなく、お客さんが別に用意するのが普通)。
:::

## 1. 一言でいうと {#s1}

cdn-waf は、**お店(クラスタ)の外に立つ、盾と受け渡し口** です。
よく聞かれる答えは自分で返し(キャッシュ)、同じ人が送りすぎたら止め(レート制限)、攻撃らしい物はお店に届く前に止めます(WAF)。

**たとえ: ショッピングモールの入口の警備員**

- 手荷物検査をして、危ない物を持った人は入れない(WAF)。
- 同じ人が 1 秒に何十回も出入りしたら止める(レート制限)。
- 「トイレはどこ?」のような、誰に聞かれても同じ答えは、お店に聞きに行かずに自分で答える(キャッシュ)。
- ただし「私の荷物はどこ?」のような **その人だけの質問** は、自分で答えずにお店に回す(ログイン中はキャッシュしない)。

本物の CDN は世界中の利用者の近くに置かれ、遠くのお店まで行かずに答えを返すことで速くします。ラボでは同じ PC の中の 1 つのコンテナ(nginx + ModSecurity + OWASP CRS)がこの役をしています。

## 2. 1 リクエストの流れ {#s2}

```text
 ブラウザ ── GET http://www.lab.localhost:18080/p/100001 ──▶ cdn-waf
                                                            │
  ① どの入口に来たか      8081(ホスト PC 用)→ 利用者の IP = 127.0.0.1 とみなす
                          18080(Docker の中・社外の代わり)→ 送り元の IP をそのまま使う
  ② どのホスト名か        server_name で www / api / backoffice の塊を選ぶ
  ③ WAF(ModSecurity)     URL・ヘッダ・本文を OWASP CRS のルールで採点 → 5 点以上なら 403
  ④ レート制限            IP ごとに 1 秒 20 回(まとめて 80 回まで)→ 超えたら 429
  ⑤ キャッシュを探す      キー = メソッド + ホスト名 + URL
       ├ ある(30 秒以内) → ここで返す  X-Cache-Status: HIT
       └ ない            → ⑥ へ        X-Cache-Status: MISS
  ⑥ ingress:8080 へ渡す   Host はそのまま。X-Forwarded-For に「本当の利用者の IP」を上書き
  ⑦ 返事が来たら          ためてよい返事なら 30 秒ためる / CSP などのヘッダを足す / 1 行 JSON のログ
                                                            │
 ブラウザ ◀──────────────────────────────────────────────────┘
```

1. **入口の番号で、利用者の IP を決めます。** Docker Desktop は、ホスト PC から来た通信の送り元を別の番号に書き換えてしまいます。そこで「8081 番(= この PC からだけ届く入口)に来たら 127.0.0.1 から来たことにする」と決めています。こうすると ingress の IP フィルタで「この PC は社内」と扱えます。
2. **ホスト名で設定の塊を選びます。** 3 つのホスト名は同じ 18080 番に来ます。nginx は `Host` ヘッダを見て、どの `server { }` の設定を使うかを決めます。
3. **WAF が中身を採点します。** OWASP CRS(攻撃の典型をまとめたルール集)が、SQL インジェクションや XSS の「らしさ」に点数を付けます。合計が `ANOMALY_INBOUND`(既定 5)以上なら 403 で止めます。
4. **レート制限を数えます。** 3 つのホスト名で 1 つの帳簿を共有するので、「同じ人の合計」で数えます。
5. **キャッシュを探します。** ただし `Authorization` か `Cookie` を持ったリクエストは、ためた物を返さず、新しくためもしません。
6. **ingress に渡します。** ホスト名を付けたまま渡すので、振り分けは ingress が行えます。
7. **帰り道でヘッダを足します。** CSP など「ブラウザへのお願い」をここでまとめて付けます。

## 3. 設定の読み方 {#s3}

ファイル: [cdn-waf/default.conf.template](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/cdn-waf/default.conf.template)(起動時に `${...}` が環境変数で置き換わります)。値は [docker-compose.yml](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/docker-compose.yml) の `cdn-waf:` の `environment` にあります。

### 3.1 キャッシュ {#s3-1}

```nginx
proxy_cache_path /tmp/nginx-cache levels=1:2 keys_zone=store_cache:10m max_size=100m inactive=1d use_temp_path=off;
```

- ためる場所は `/tmp/nginx-cache`。`keys_zone=store_cache:10m` は「目次(どの URL をためたか)用に 10MB」、`max_size=100m` は「中身は 100MB まで」、`inactive=1d` は「1 日使われなければ捨てる」です。

```nginx
map "${EDGE_CACHE}" $cache_disabled {
  default 1;
  on      0;
}
```

- キャッシュの ON/OFF を切り替える **ただ 1 か所** です。`EDGE_CACHE` が `on` なら 0(= 無効にしない)、それ以外なら 1(= 無効にする)。

```nginx
map "$http_authorization$http_cookie" $has_credentials {
  ""      0;
  default 1;
}
```

- `Authorization` と `Cookie` をつなげた文字列が空なら 0、何か入っていれば 1。「ログイン中らしい人」を見分けます。

```nginx
proxy_cache_key "$request_method$host$request_uri";
proxy_cache_bypass $cache_disabled $has_credentials;
proxy_no_cache     $cache_disabled $has_credentials;
proxy_cache_lock on;
```

- `proxy_cache_key` … 何が同じなら「同じ答え」とみなすか。メソッド + ホスト名 + URL(`?` 以降も含む)です。
- `proxy_cache_bypass` … どちらかが 1 なら、ためた物を **返さない**。
- `proxy_no_cache` … どちらかが 1 なら、返事を **ためない**。
- `proxy_cache_lock on` … 同じ URL を同時にたくさん頼まれても、奥に取りに行くのは 1 回だけ(行列の先頭の人だけが取りに行く)。

```nginx
  location ~ ^/p/[^/]+/?$ {
    proxy_cache store_cache;
    proxy_cache_valid 200 30s;
    proxy_pass $ingress;
  }
```

- www では `/`・`/p/{コード}`・`/search` の HTML だけを 30 秒ためます。`proxy_cache_valid 200 30s` は「200 の返事を 30 秒」という意味です。
- api では `products/search`・`products/{コード}`・`cms/pages` を 30 秒、`/medias/` を 1 日(`1d`)ためます。トークンや注文はためません。
- 返事に `Cache-Control: no-store` が付いていれば、nginx はためません。SSR をあきらめた空の HTML、トークン、注文には api や storefront がこれを付けています。

### 3.2 レート制限 {#s3-2}

```nginx
limit_req_zone $binary_remote_addr zone=per_ip:10m rate=${EDGE_GLOBAL_RATE};
limit_req_status 429;
```

```nginx
  limit_req zone=per_ip burst=${EDGE_GLOBAL_BURST} nodelay;
```

- `limit_req_zone` … 「IP アドレスごとの回数の帳簿」を作ります。`rate` は既定 `20r/s`(1 秒 20 回)。
- `limit_req_status 429` … 超えたら 429(Too Many Requests)。
- `burst=80 nodelay` … 画面 1 枚で JS・CSS・画像・api をまとめて取りに来るので、80 回までの「まとめ買い」は待たせずに通します。それも超えたら 429 です。
- ログインの回数制限(1 秒 1 回)は、ここではなく ingress にあります([仕組み-2](./02-ingress-and-endpoints))。

### 3.3 利用者の IP を ingress に伝える {#s3-3}

```nginx
map $server_port $client_ip {
  8081    127.0.0.1;
  default $remote_addr;
}
...
proxy_set_header X-Forwarded-For $client_ip;
proxy_set_header X-Request-Id $request_id;
```

- 8081 番に来たら 127.0.0.1、それ以外は本当の送り元。
- `X-Forwarded-For` は「足す」のではなく **上書き** します。利用者が偽の `X-Forwarded-For` を付けてきても、それを消すためです。
- `X-Request-Id` … リクエストごとの番号です。cdn-waf のログの `request_id`、ingress のログの `request_id`、storefront・api のログの `reqId` に同じ番号が残るので、1 つのリクエストを追えます([仕組み-11](./11-observability))。

### 3.4 セキュリティヘッダ {#s3-4}

```nginx
  add_header Content-Security-Policy "${WWW_CSP}" always;
  add_header X-Content-Type-Options "nosniff" always;
  add_header Referrer-Policy "strict-origin-when-cross-origin" always;
  add_header X-Frame-Options "DENY" always;
  add_header X-Cache-Status $upstream_cache_status always;
```

- `Content-Security-Policy` … このページが読み込んでよいスクリプト・画像・通信先の一覧(CSP)。www の値は `WWW_CSP` にあり、`connect-src` と `img-src` に `http://api.lab.localhost:18080` が入っています(ブラウザが別オリジンの api から JSON と画像を取るため)。
- `nosniff` … ファイルの種類をブラウザに推測させない。
- `Referrer-Policy` … 別のサイトへ移るとき、元の URL をどこまで伝えるか。
- `X-Frame-Options: DENY` … 他のサイトの枠(iframe)の中に表示させない(クリックを横取りする攻撃の対策)。
- `always` … 403 や 500 のときも付けます。
- `X-Cache-Status` … HIT / MISS / BYPASS / EXPIRED。キャッシュを使った場所だけに付きます。

### 3.5 WAF の強さ {#s3-5}

WAF の本体の設定はイメージの中にあり、強さは環境変数で決めます([docker-compose.yml](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/docker-compose.yml))。

```yaml
      MODSEC_RULE_ENGINE: "On" # On = 遮断する / DetectionOnly = 記録だけ
      BLOCKING_PARANOIA: ${BLOCKING_PARANOIA:-1}
      ANOMALY_INBOUND: ${ANOMALY_INBOUND:-5}
```

- `MODSEC_RULE_ENGINE: "On"` … 見つけたら止めます(`DetectionOnly` は記録だけ)。
- `BLOCKING_PARANOIA` … 疑い深さ 1〜4。上げるほど細かいルールまで使い、誤遮断(まじめな入力を止めること)も増えます。
- `ANOMALY_INBOUND` … 怪しさの合計点がこれ以上で止めます。上げるほど甘くなります。
- 誤遮断を直すときは、WAF を切らずに「どの URL の、どの項目だけ、どのルールを外すか」を [cdn-waf/modsecurity/lab-exclusions-before.conf](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/cdn-waf/modsecurity/lab-exclusions-before.conf) に狭く書きます。

## 4. 確かめるコマンド {#s4}

```bash
# キャッシュ: 同じ URL を 2 回。1 回目 MISS、2 回目 HIT(30 秒で切れる)
curl -sI http://www.lab.localhost:18080/p/100001 | grep -i x-cache
curl -sI http://www.lab.localhost:18080/p/100001 | grep -i x-cache
# → X-Cache-Status: MISS
# → X-Cache-Status: HIT

# ログイン中らしい(Authorization あり)なら、ためた物を使わない
curl -sI -H 'Authorization: Bearer dummy' http://www.lab.localhost:18080/p/100001 | grep -i x-cache
# → X-Cache-Status: BYPASS

# 商品画像は 1 日ためる(api も Cache-Control: public, max-age=86400 を返す)
curl -sI http://api.lab.localhost:18080/medias/100001.svg | grep -iE 'cache-control|x-cache'

# セキュリティヘッダ
curl -sI http://www.lab.localhost:18080/ | grep -iE 'content-security-policy|x-frame-options|x-content-type-options|referrer-policy'

# WAF: SQL インジェクションらしい入力は 403(このラボにだけ送ること)
curl -s -o /dev/null -w '%{http_code}\n' "http://api.lab.localhost:18080/occ/v2/samplestore/products/search?query=%27%20OR%20%271%27%3D%271"
# → 403

# 止めた理由(ルール ID)はログに JSON で出る
docker compose logs cdn-waf | grep -o '"ruleId":"[0-9]*"' | sort | uniq -c | head

# キャッシュを切る(ここ 1 か所)→ 何度打っても X-Cache-Status が BYPASS になる
EDGE_CACHE=off docker compose up -d cdn-waf
# 元に戻す(書かなければ既定の on)
docker compose up -d cdn-waf
```

::: details 本格版(Kubernetes)では
cdn-waf は **クラスタの外の Docker コンテナ**(名前 `lab-cdn-waf`)として `k8s/up.sh` が起動し、設定ファイルも同じ物を使います。違うのは行き先だけで、kind のノードの 80 番(ingress-nginx)に渡します。キャッシュの ON/OFF は環境(d1・s1・p1)ごとに manifest.json の `cdnCache` で決まり、ConfigMap `lab-environment` の `EDGE_CACHE` を起動のときに読みます(d1 は off)。
```bash
docker logs --tail=5 lab-cdn-waf
kubectl -n lab get configmap lab-environment -o jsonpath='{.data.EDGE_CACHE}'; echo

# 一時的にキャッシュを切る: EDGE_CACHE を付けて up.sh をもう一度(環境の値より優先。cdn-waf のコンテナだけ作り直される)
EDGE_CACHE=off LAB_SKIP_BUILD=1 k8s/up.sh
# 元に戻す(付けなければ環境の値に戻る)
LAB_SKIP_BUILD=1 k8s/up.sh
```
`k8s/up.sh` は `LAB_ENV` を書かないと p1 になります。d1・s1 で試しているときは `LAB_ENV=d1` のように今の環境も付けてください。
:::

## 5. CCv2 / Composable Storefront ではどこに当たるか {#s5}

| ラボ | CCv2 の案件で当たるもの |
| --- | --- |
| cdn-waf というコンテナ | お客さんが別に契約する CDN・WAF(例: CloudFront + AWS WAF、Akamai など)。CCv2 のエンドポイントの前に置く |
| `proxy_cache_valid 200 30s` | CDN のキャッシュの設定(パスごとの保存時間。キャッシュのルール) |
| `$has_credentials` でためない | CDN の「Cookie・Authorization ヘッダがあればキャッシュしない」設定 |
| `limit_req`(IP ごと 1 秒 20 回) | WAF のレート制限のルール |
| ModSecurity + OWASP CRS | WAF のマネージドルール(SQL インジェクション・XSS など) |
| lab-exclusions-before.conf | WAF の例外ルール(誤遮断の対処) |
| `add_header Content-Security-Policy` | CDN で付けるレスポンスヘッダ、または Composable Storefront の SSR サーバーで付けるヘッダ |

CCv2 の Cloud Portal には「エンドポイント」と「IP フィルタ」がありますが、それは次の ingress の役です([仕組み-2](./02-ingress-and-endpoints))。CDN・WAF をどこに置くかは、案件ごとに決めることです。

## 6. よくある誤解 {#s6}

- **「CDN は画像や JS のためだけの物」** → HTML や API の返事もためられます。ためてよいのは「誰に聞かれても同じ答え」だけ、という線引きが大事です。
- **「キャッシュは長いほどよい」** → 長いほど奥は楽になりますが、管理画面で価格を変えても画面に出るまで遅れます。ラボは 30 秒にしています([仕組み-5](./05-headless-cms))。
- **「WAF があれば、アプリの SQL は多少雑でもよい」** → WAF は典型的な攻撃の「形」を見るだけです。形を変えた攻撃は通ることがあります。アプリ側でプレースホルダを使うのが本当の対策です。
- **「WAF は DetectionOnly で入れておけば安全」** → 記録するだけで止めません。止めたいなら遮断モード(`On`)にし、誤遮断を例外ルールで狭く直します。
- **「X-Forwarded-For は信じてよい」** → 誰でも偽れます。信じてよいのは「自分が置いた CDN が上書きした値」だけです。

## 7. 関係する演習と設計書 {#s7}

- 演習: [ネットワーク-1 前段のキャッシュ](/exercises/07-nw-cache)・[セキュリティ-1 WAF が攻撃を止める](/exercises/17-sec-waf)・[セキュリティ-3 CSP で外部スクリプトを止める](/exercises/19-sec-csp)・[性能-1 負荷試験で限界を見る](/exercises/12-perf-load-test)
- 設計書: [ネットワーク方式 4.2 キャッシュ](/design/architecture/04-network#s4-2)・[4.3 ためてはいけない物](/design/architecture/04-network#s4-3)・[セキュリティ方式 4.1 WAF](/design/architecture/10-security#s4-1)・[4.2 誤遮断の直し方](/design/architecture/10-security#s4-2)・[4.3 レート制限](/design/architecture/10-security#s4-3)・[4.5 セキュリティヘッダと CSP](/design/architecture/10-security#s4-5)・[性能方式 4.2 入口でためて減らす](/design/architecture/07-performance#s4-2)・[ネットワーク方式 4.7 入口を 2 段に分ける](/design/architecture/04-network#s4-7)・[D-SEC-01 WAF とレート制限](/design/detail/D-SEC-01-waf-and-rate-limit)
- 前後のページ: [仕組み-0 全体の流れ](./00-overview) ・ [仕組み-2 ingress とエンドポイント](./02-ingress-and-endpoints)
