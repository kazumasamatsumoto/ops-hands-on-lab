---
title: 仕組み-2 ingress(エンドポイントと IP フィルタ)
---

# 仕組み-2 ingress(エンドポイントと IP フィルタ)

::: tip このページで分かること
- 同じ 18080 番に来たリクエストを、**ホスト名だけで** storefront・api・backoffice に分ける仕組み。
- backoffice を「社内の IP からだけ」にする IP フィルタと、利用者の本当の IP を知る方法。
- 入口が cdn-waf と ingress の **2 段** になっている理由。
- CCv2 の Cloud Portal の「エンドポイント」「IP フィルタ」との対応。
:::

## 1. 一言でいうと {#s1}

ingress は、**クラスタの入口にいる受付係** です。封筒の宛名(ホスト名)を見て、どの窓口(サービス)に回すかを決め、社員専用の部屋(backoffice)には社員証(社内の IP)を持った人しか通しません。

**たとえ: 会社の受付**

- 同じ玄関(18080 番)から入ってきても、「営業部あて(www)」「経理部あて(api)」「役員室あて(backoffice)」で行き先が違う。
- 役員室は、社員証(社内の IP 範囲)を見せた人だけ通す。
- 「サーバー室(`/admin/`・`/metrics`・`/readyz`)」は、外から来た人は誰も通さない。
- ログインの窓口は、同じ人が 1 秒に何度も来たら少し待ってもらう(総当たり攻撃を遅くする)。

**なぜ 2 段(cdn-waf と ingress)なのか**

| | cdn-waf(警備員) | ingress(受付) |
| --- | --- | --- |
| 置き場所 | クラスタの外 | クラスタの入口 |
| 持ち主(CCv2 の案件) | お客さんが別に契約する CDN・WAF(CCv2 にも簡易の Basic WAF はある) | CCv2(Cloud Portal で設定) |
| 知っていること | 攻撃の形・よく聞かれる答え | どのホスト名がどのサービスか・社内の IP の範囲 |
| やること | キャッシュ・WAF・全体のレート制限・ヘッダ | 振り分け・IP フィルタ・ログインの回数制限・中の人だけの口を閉じる |

役割と持ち主が違うので、分けておくと「CDN の会社を変えても、振り分けの設定はそのまま」「エンドポイントを足しても、WAF の設定はそのまま」にできます。

## 2. 1 リクエストの流れ {#s2}

```text
 cdn-waf ──▶ ingress:8080
             Host: backoffice.lab.localhost
             X-Forwarded-For: 127.0.0.1          ← cdn-waf が書いた「本当の利用者の IP」
             (直接つないできた相手 = cdn-waf 172.30.89.10)

  ① 本当の IP を決める   直接の相手が 172.30.89.10(cdn-waf)なら X-Forwarded-For を信じる
                         → $remote_addr = 127.0.0.1
  ② server を選ぶ        server_name backoffice.lab.localhost の塊
  ③ IP フィルタ          allow 127.0.0.1/32; allow 172.30.89.0/24; allow 172.30.91.0/24; deny all;
                         → 127.0.0.1 は許す範囲 → 通す(範囲の外なら 403)
  ④ 閉じた口か           /admin/・/metrics・/readyz なら 403
  ⑤ 行き先へ             proxy_pass http://backoffice:3001

  www なら   → storefront:4000(IP フィルタなし。/metrics だけ閉じる)
  api なら   → api:3001(IP フィルタなし。/admin/・/metrics・/readyz を閉じる。
                          /authorizationserver/oauth/token は IP ごとに 1 秒 1 回・余裕 5 回(続けてなら 6 回まで通る))
  知らない名前 → 404「エンドポイントがありません」
```

1. **本当の IP を決めます。** ingress に直接つないでくるのはいつも cdn-waf です。そのままだと、全員が「cdn-waf から来た人」に見えてしまいます。そこで cdn-waf が書いた `X-Forwarded-For` を読みますが、このヘッダは誰でも偽れるので、「cdn-waf の IP(172.30.89.10)から来たときだけ」信じます。
2. **ホスト名で塊を選びます。** nginx の `server_name` が一致した `server { }` の設定が使われます。どれにも当たらなければ、最初の「知らないホスト名」用の塊が 404 を返します。
3. **IP フィルタ。** backoffice だけ、許す範囲の一覧(allow)と「それ以外は拒否(deny all)」で絞ります。
4. **閉じた口。** 指標(`/metrics`)・準備の確認(`/readyz`)・カオスの切り替え(`/admin/`)は、中の人(Prometheus や運用者)だけが使う口なので、外からは 403 にします。
5. **行き先へ渡します。** 行き先の名前は、リクエストが来たときに Docker の DNS で引きます(引いた結果は 10 秒だけ覚えておきます)。

## 3. 設定の読み方 {#s3}

ファイル: [ingress/default.conf.template](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/ingress/default.conf.template)・[ingress/40-ip-filter.sh](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/ingress/40-ip-filter.sh)。値は [docker-compose.yml](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/docker-compose.yml) の `ingress:` にあります。

### 3.1 本当の利用者の IP {#s3-1}

```nginx
set_real_ip_from ${CDN_WAF_IP};
real_ip_header X-Forwarded-For;
```

- `set_real_ip_from` … 「この相手から来たときだけ、ヘッダの IP を信じる」相手。`CDN_WAF_IP` は `172.30.89.10` です。
- `real_ip_header` … どのヘッダから本当の IP を読むか。
- こうすると、以降の `allow` / `deny` やログインの回数制限が、cdn-waf の IP ではなく **利用者の IP** で効きます。
- cdn-waf の IP を固定しているのは docker-compose.yml の `ipv4_address: 172.30.89.10` です。

### 3.2 ホスト名での振り分け {#s3-2}

```nginx
server {
  listen 8080;
  server_name api.lab.localhost;
  set $backend http://api:3001;

  location /admin/     { deny all; }
  location = /metrics  { deny all; }
  location = /readyz   { deny all; }

  location = /authorizationserver/oauth/token {
    limit_req zone=login burst=5 nodelay;
    proxy_pass $backend;
  }

  location / {
    proxy_pass $backend;
  }
}
```

- `server_name api.lab.localhost` … この塊は api のエンドポイントです。
- `set $backend http://api:3001` … 行き先を変数に入れておくと、行き先がまだ起動していなくても nginx は起動できます(その間は 502)。
- `location /admin/ { deny all; }` … `/admin/` で始まるパスは誰でも 403。`location = /metrics` の `=` は「完全に一致したときだけ」です。
- `limit_req zone=login burst=5 nodelay` … トークンの発行だけに、IP ごとの回数制限をかけます。帳簿は次の行で作ります。

```nginx
limit_req_zone $binary_remote_addr zone=login:10m rate=1r/s;
limit_req_status 429;
```

- IP ごとに 1 秒 1 回。`burst=5 nodelay` は「1 秒 1 回を超えた分も 5 回までは待たせずに通す」という余裕なので、続けて打つと 6 回目までは通り、7 回目から 429 です(その後は 1 秒に 1 回ずつ通れる分が戻ります)。api はわざと「何度失敗してもロックしない」ので、ここが唯一の歯止めです。

### 3.3 IP フィルタ(backoffice) {#s3-3}

```nginx
  include /etc/nginx/ip-filters/backoffice.conf;
```

この 1 行で読み込む中身は、起動時に `40-ip-filter.sh` が環境変数から作ります。

```sh
for cidr in $(echo "${BACKOFFICE_IP_ALLOWLIST:-}" | tr ',' ' '); do
  ...
  echo "allow $cidr;" >> "$out"
done
echo "deny all;" >> "$out"
```

- `BACKOFFICE_IP_ALLOWLIST` の既定は `127.0.0.1/32 172.30.89.0/24 172.30.91.0/24` です(manifest.json の `ipFilters.office` と同じ並び)。
  - `127.0.0.1/32` … ホスト PC(cdn-waf が「この PC から来た」通信をこの番号で伝えます)。
  - `172.30.89.0/24` … 軽量版の Docker ネットワーク(Playwright・k6 のコンテナなど)。
  - `172.30.91.0/24` … 本格版(kind)のネットワーク。軽量版では使いませんが、manifest.json とそろえています。
  - 社外の代わりのネットワーク(軽量版 `172.30.90.0/24`)は入っていないので、そこから来ると 403 です。
- 範囲を 1 つずつ `allow` にし、最後に `deny all`。「許す一覧 + それ以外は拒否」です。一覧が空なら誰も通しません(うっかり全開にしないため)。
- `/32` や `/24` は CIDR という書き方で、「前から何ビットが同じなら同じ範囲か」を表します。`/32` は 1 つの IP だけ、`/24` は最後の数字が 0〜255 の 256 個です。

### 3.4 本格版: 同じことを Ingress リソースで書く {#s3-4}

本格版では、ingress-nginx というソフトが Ingress リソースを読んで同じ振り分けをします。ファイルは manifest.json から作られます([k8s/generated/base/ingress.yaml](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/k8s/generated/base/ingress.yaml))。

```yaml
kind: Ingress
metadata:
  name: backoffice
  annotations:
    nginx.ingress.kubernetes.io/allowlist-source-range: "127.0.0.1/32,172.30.89.0/24,172.30.91.0/24"
spec:
  ingressClassName: nginx
  rules:
    - host: backoffice.lab.localhost
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: backoffice
                port:
                  number: 3001
```

- `rules[].host` … ホスト名(nginx の `server_name` に当たる)。
- `backend.service` … 行き先の Service の名前とポート(nginx の `proxy_pass` に当たる)。
- 注釈 `allowlist-source-range` … IP フィルタ。範囲の外からは 403。
- 閉じた口(`/admin`・`/metrics`・`/readyz`)は、別の Ingress `backoffice-blocked` の注釈 `denylist-source-range: "0.0.0.0/0"`(誰からでも 403)で表しています。回数制限は `api-ratelimit-1` の注釈 `limit-rps: "1"`・`limit-burst-multiplier: "5"` です。

本格版では、cdn-waf はクラスタの外の Docker コンテナ(ネットワーク `lab-kind` = `172.30.91.0/24` の中の `172.30.91.10`)として動き、kind のノードの 80 番(ingress-nginx)に渡します。ingress-nginx にも「cdn-waf からの `X-Forwarded-For` だけを信じる」設定(`proxy-real-ip-cidr`)を入れて、軽量版の `set_real_ip_from` と同じ働きにしています。

ingress-nginx 全体の設定は ConfigMap `ingress-nginx-controller`(Namespace `ingress-nginx`)で、ラボで足した値は [k8s/vendor/ingress-nginx/kustomization.yaml](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/k8s/vendor/ingress-nginx/kustomization.yaml) にあります。

| 設定 | 値 | 軽量版で当たるもの |
| --- | --- | --- |
| `use-forwarded-headers` | `"true"` | `real_ip_header X-Forwarded-For` |
| `proxy-real-ip-cidr` | `"172.30.91.0/24"`(lab-kind。cdn-waf がいる所) | `set_real_ip_from`(軽量版は cdn-waf の 1 台だけ) |
| `limit-req-status-code` | `"429"`(ingress-nginx の既定は 503) | `limit_req_status 429` |
| `log-format-upstream` | 1 行 1 JSON(`remote_addr`・`request_id`・`via`・`ingress`・`status` など。項目名は軽量版にそろえ、`ingress` だけ多い) | `log_format` |

信じる相手の範囲は、軽量版(cdn-waf の 1 台)より広い「lab-kind のネットワーク全体」です。ラボでは lab-kind にいるのが cdn-waf・kind のノード・演習用のコンテナだけなので、この広さにしています。

## 4. 確かめるコマンド {#s4}

::: code-group

```bash [Mac / Linux / WSL]
# 今の IP フィルタの中身
docker compose exec ingress cat /etc/nginx/ip-filters/backoffice.conf
# → allow 127.0.0.1/32;
#   allow 172.30.89.0/24;
#   allow 172.30.91.0/24;
#   deny all;

# この PC(社内扱い)からは backoffice に届く
curl -s -o /dev/null -w '%{http_code}\n' http://backoffice.lab.localhost:18080/backoffice/login
# → 200

# 社外の代わりのネットワーク(lab_outside)からは 403
docker run --rm --network lab_outside curlimages/curl:8.16.0 -s -o /dev/null -w '%{http_code}\n' \
  -H 'Host: backoffice.lab.localhost' http://cdn-waf:18080/backoffice/login
# → 403

# 社外からでも、お店(www)は誰でも
docker run --rm --network lab_outside curlimages/curl:8.16.0 -s -o /dev/null -w '%{http_code}\n' \
  -H 'Host: www.lab.localhost' http://cdn-waf:18080/
# → 200

# 中の人だけの口は外から 403
curl -s -o /dev/null -w '%{http_code}\n' http://api.lab.localhost:18080/admin/chaos   # → 403
curl -s -o /dev/null -w '%{http_code}\n' http://api.lab.localhost:18080/metrics       # → 403

# ログインの回数制限: 10 回連打 → 最初の数回は 400(パスワード違い)、そのあと 429
for i in $(seq 1 10); do
  curl -s -o /dev/null -w '%{http_code} ' http://api.lab.localhost:18080/authorizationserver/oauth/token \
    -d 'grant_type=password&client_id=storefront&username=alice&password=wrong'
done; echo

# ingress のログ: remote_addr が利用者の IP、via が cdn-waf
docker compose logs --tail=3 ingress

# この PC も社外扱いにしてみる(許す範囲から 127.0.0.1 を外す)→ ブラウザでも 403
BACKOFFICE_IP_ALLOWLIST=172.30.89.0/24 docker compose up -d ingress
# 元に戻す
docker compose up -d ingress
```

```powershell [PowerShell]
# 今の IP フィルタの中身
docker compose exec ingress cat /etc/nginx/ip-filters/backoffice.conf
# → allow 127.0.0.1/32;
#   allow 172.30.89.0/24;
#   allow 172.30.91.0/24;
#   deny all;

# この PC(社内扱い)からは backoffice に届く
curl.exe -s -o NUL -w '%{http_code}\n' http://backoffice.lab.localhost:18080/backoffice/login
# → 200

# 社外の代わりのネットワーク(lab_outside)からは 403(コンテナの中の curl なので -o /dev/null のまま)
docker run --rm --network lab_outside curlimages/curl:8.16.0 -s -o /dev/null -w '%{http_code}\n' `
  -H 'Host: backoffice.lab.localhost' http://cdn-waf:18080/backoffice/login
# → 403

# 社外からでも、お店(www)は誰でも
docker run --rm --network lab_outside curlimages/curl:8.16.0 -s -o /dev/null -w '%{http_code}\n' `
  -H 'Host: www.lab.localhost' http://cdn-waf:18080/
# → 200

# 中の人だけの口は外から 403
curl.exe -s -o NUL -w '%{http_code}\n' http://api.lab.localhost:18080/admin/chaos   # → 403
curl.exe -s -o NUL -w '%{http_code}\n' http://api.lab.localhost:18080/metrics       # → 403

# ログインの回数制限: 10 回連打 → 最初の数回は 400(パスワード違い)、そのあと 429
$codes = foreach ($i in 1..10) {
  curl.exe -s -o NUL -w '%{http_code}' http://api.lab.localhost:18080/authorizationserver/oauth/token `
    -d 'grant_type=password&client_id=storefront&username=alice&password=wrong'
}
$codes -join ' '

# ingress のログ: remote_addr が利用者の IP、via が cdn-waf
docker compose logs --tail=3 ingress

# この PC も社外扱いにしてみる(許す範囲から 127.0.0.1 を外す)→ ブラウザでも 403
$env:BACKOFFICE_IP_ALLOWLIST = '172.30.89.0/24'; docker compose up -d ingress
# 元に戻す(環境変数を消してから作り直す)
Remove-Item Env:BACKOFFICE_IP_ALLOWLIST; docker compose up -d ingress
```

:::

::: tip PowerShell
`$env:BACKOFFICE_IP_ALLOWLIST = …` は同じウィンドウで打つ以後のコマンド全部に効き続けます。元に戻すときは `Remove-Item Env:BACKOFFICE_IP_ALLOWLIST` を先に打ってから `docker compose up -d ingress` します。
:::

:::: details 本格版(Kubernetes)では

::: code-group

```bash [Mac / Linux / WSL]
kubectl -n lab get ingress                     # エンドポイントの一覧(HOSTS 欄にホスト名)
kubectl -n lab describe ingress backoffice      # 注釈(IP フィルタ)と行き先
kubectl kustomize k8s/generated/envs/d1 | grep -A8 allowlist-source-range | grep '^  name:'   # IP フィルタの付いた Ingress の名前。d1 では api・api-ratelimit-1・backoffice・www(p1 は backoffice だけ)

# 社外の代わりのネットワーク lab-kind-outside(172.30.92.0/24)から → 403
docker run --rm --network lab-kind-outside curlimages/curl:8.16.0 -s -o /dev/null -w '%{http_code}\n' \
  -H 'Host: backoffice.lab.localhost' http://lab-cdn-waf:18080/backoffice/login
# お店(www)は p1 なら社外からも 200(d1・s1 では 403)
docker run --rm --network lab-kind-outside curlimages/curl:8.16.0 -s -o /dev/null -w '%{http_code}\n' \
  -H 'Host: www.lab.localhost' http://lab-cdn-waf:18080/

# ingress-nginx のログ: remote_addr が利用者の IP(172.30.92.x なら社外)、via が cdn-waf(172.30.91.10)、ingress が当たった Ingress の名前
kubectl -n ingress-nginx logs deploy/ingress-nginx-controller --tail=5
```

```powershell [PowerShell]
kubectl -n lab get ingress                     # エンドポイントの一覧(HOSTS 欄にホスト名)
kubectl -n lab describe ingress backoffice      # 注釈(IP フィルタ)と行き先
kubectl kustomize k8s/generated/envs/d1 | Select-String 'allowlist-source-range' -Context 0,8 | ForEach-Object { $_.Context.PostContext } | Select-String '^  name:'   # IP フィルタの付いた Ingress の名前。d1 では api・api-ratelimit-1・backoffice・www(p1 は backoffice だけ)

# 社外の代わりのネットワーク lab-kind-outside(172.30.92.0/24)から → 403
docker run --rm --network lab-kind-outside curlimages/curl:8.16.0 -s -o /dev/null -w '%{http_code}\n' `
  -H 'Host: backoffice.lab.localhost' http://lab-cdn-waf:18080/backoffice/login
# お店(www)は p1 なら社外からも 200(d1・s1 では 403)
docker run --rm --network lab-kind-outside curlimages/curl:8.16.0 -s -o /dev/null -w '%{http_code}\n' `
  -H 'Host: www.lab.localhost' http://lab-cdn-waf:18080/

# ingress-nginx のログ: remote_addr が利用者の IP(172.30.92.x なら社外)、via が cdn-waf(172.30.91.10)、ingress が当たった Ingress の名前
kubectl -n ingress-nginx logs deploy/ingress-nginx-controller --tail=5
```

:::

::::

## 5. CCv2 / Composable Storefront ではどこに当たるか {#s5}

| ラボ | CCv2 で当たるもの |
| --- | --- |
| `server_name www.lab.localhost` → storefront | Cloud Portal の「エンドポイント」(URL と、渡す先の aspect。JS Storefront 用・api 用・backoffice 用などを環境ごとに作る) |
| `include .../backoffice.conf`(allow / deny) | エンドポイントに付ける「IP フィルタ」(許す IP の範囲の一覧) |
| `manifest.json` の `ipFilters.office` | 社内の IP の範囲を名前付きでまとめた物(Cloud Portal で IP フィルタのセットを作るのに相当) |
| d1・s1 では www・api も社内だけ | 開発・検証環境のエンドポイントを社内の IP だけにする、よくある運用 |
| `/admin/`・`/metrics`・`/readyz` を閉じる | 外に出さない管理用の口(CCv2 では、エンドポイントに出さないか、Cloud Portal の「Deny Path Set」(拒否するパスの一覧)をエンドポイントに付けて閉じる) |
| ingress-nginx(本格版) | CCv2 の裏で動く Kubernetes の入口(利用者は直接は触らない) |

## 6. よくある誤解 {#s6}

- **「IP フィルタは cdn-waf でかけてもよい」** → かけられますが、CCv2 ではエンドポイントごとの IP フィルタが基本の道具です。ラボも「エンドポイントの持ち物」として ingress に置いています。
- **「127.0.0.1 を許しているから、誰でも入れる」** → 127.0.0.1 として伝わるのは、この PC の 127.0.0.1 の 18080 番に来た通信だけです。外の PC からは 18080 番にそもそも届きません。
- **「`X-Forwarded-For` を見れば利用者の IP が分かる」** → 誰が書いたかが大事です。信じてよい相手(自分の CDN)を `set_real_ip_from` で限っているから意味があります。
- **「ホスト名が違えば、別のサーバーが要る」** → 1 つの入口で、`Host` ヘッダを見て振り分けられます(名前ベースのバーチャルホスト)。
- **「IP フィルタがあれば、backoffice のパスワードは弱くてもよい」** → IP フィルタは「入口の鍵」、パスワードは「部屋の鍵」です。両方要ります(ラボの `admin` / `admin` は見本の値です)。

## 7. 関係する演習と設計書 {#s7}

- 演習: [ネットワーク-2 CORS と IP 制限](/exercises/08-nw-cors-and-ip)・[セキュリティ-2 ログインの連打を止める](/exercises/18-sec-rate-limit-login)・[ネットワーク-3 Ingress とエンドポイント](/exercises/20-nw-ingress-endpoints)
- 設計書: [ネットワーク方式 4.1 振り分け](/design/architecture/04-network#s4-1)・[4.4 backoffice エンドポイントの IP フィルタ](/design/architecture/04-network#s4-4)・[4.7 入口を 2 段に分ける](/design/architecture/04-network#s4-7)・[4.8 エンドポイントごとの IP フィルタと環境の差](/design/architecture/04-network#s4-8)・[4.6 タイムアウトと見守り用の口](/design/architecture/04-network#s4-6)・[セキュリティ方式 4.4 管理の入口](/design/architecture/10-security#s4-4)・[D-NW-01 edge の経路とキャッシュ](/design/detail/D-NW-01-edge-route)
- 前後のページ: [仕組み-1 cdn-waf](./01-cdn-waf) ・ [仕組み-3 Kubernetes の基本](./03-kubernetes-basics)
