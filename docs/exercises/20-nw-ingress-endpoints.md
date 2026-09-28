---
title: ネットワーク-3 Ingress とエンドポイント
---

# ネットワーク-3 Ingress とエンドポイント

::: info この演習について
- 所要時間: 約 20 分(本格版もやるなら +15 分)
- 使うもの: 軽量版(docker compose)。`curl`(PowerShell は `curl.exe`)、`docker run`(社外のふりをする)。本格版(kind)があれば Ingress リソースが見られます
- 仕組みはこちら: [仕組み-2 ingress(エンドポイントと IP フィルタ)](/how-it-works/02-ingress-and-endpoints)・[仕組み-1 cdn-waf(CDN と WAF)](/how-it-works/01-cdn-waf)・[仕組み-12 manifest と環境](/how-it-works/12-manifest-and-environments)
- 関係する設計書: [ネットワーク方式](/design/architecture/04-network)・[D-NW-01 cdn-waf と ingress の経路とキャッシュ](/design/detail/D-NW-01-edge-route)
- 用語集: [Ingress](/guide/glossary#ingress)・[エンドポイント](/guide/glossary#endpoint)・[IP フィルタ](/guide/glossary#ip-filter)・[X-Forwarded-For](/guide/glossary#x-forwarded-for)・[リバースプロキシ](/guide/glossary#reverse-proxy)
:::

## 1. この設計書はなぜ必要か

第 2 版のサンプルストアは、1 つの入口(18080 番)の下に、お店・API・管理画面の 3 つの窓口があります。「どのホスト名がどの窓口に行くか」「どの窓口を誰に開けるか」を決めないと、
管理画面が世界に開いていたり、内部だけの口(指標・カオスの切り替え)が外から触れたりします。

> **よくある事故**: お店・API・管理画面を 1 つのサーバーにまとめたとき、振り分けの設定を 1 行間違えて、管理画面が誰でも開ける状態で公開されました。
> URL を知られただけで、価格や在庫を勝手に書き換えられる状態でした。「どのホスト名を、どの窓口に、誰に開けるか」が 1 か所にまとまっていなかったのです。

入口の 2 段構え(外の盾と、中の受付)と、窓口(エンドポイント)ごとの振り分け・IP フィルタ・閉じる口を、ネットワークの方式設計書で決めます。

## 2. 何をやっているのか

サンプルストアの入口は **2 段** です。

| | cdn-waf | ingress |
| --- | --- | --- |
| 置き場所 | クラスタの外(利用者の近く) | クラスタの入口 |
| CCv2 で当たるもの | 別に契約する CDN・WAF | Cloud Portal の「エンドポイント」と「IP フィルタ」 |
| やること | キャッシュ・WAF・全体のレート制限・セキュリティヘッダ | ホスト名で窓口を決める・窓口ごとの IP フィルタ・内部の口を閉じる・ログインの回数制限 |
| 設定の場所 | `cdn-waf/default.conf.template` | `ingress/default.conf.template`(本格版は Ingress リソース) |

ingress は、ホスト名を見て 3 つの窓口(エンドポイント)に振り分けます。

- `www.lab.localhost` → storefront(お店。誰でも)
- `api.lab.localhost` → api(OCC の REST・OAuth・画像。誰でも。ログインだけ回数制限)
- `backoffice.lab.localhost` → backoffice(管理画面。**社内 IP だけ**)

さらに、内部の人だけが使う口は外から 403 で閉じています(api と backoffice は `/admin`・`/metrics`・`/readyz`、お店(www)は `/metrics`。storefront には `/admin` と `/readyz` が無いためです)。
利用者の本当の IP は cdn-waf が `X-Forwarded-For` に書き、ingress は **cdn-waf から来たときだけ** その値を信じます(偽れないように)。

たとえ: **ショッピングモールの警備員(cdn-waf)と、各店の受付(ingress)** です。警備員は怪しい人を止め、よく聞かれる案内(キャッシュ)は自分で答えます。
受付は「どの窓口か(ホスト名)」と「社員専用の部屋に入れてよいか(IP フィルタ)」を決めます。

::: tip CCv2 では
ingress のホスト名の振り分けは、Cloud Portal の「エンドポイント」に当たります。窓口ごとの IP フィルタは、エンドポイントの「IP フィルタ」に当たります。
「本番はお店・API を誰でも、管理画面は社内だけ。開発・検証はお店も社内だけ」という環境ごとの違いは、CCv2 では Cloud Portal で環境ごとにエンドポイントと IP フィルタを設定して作ります。このラボでは、それを manifest.json の `environments` に書いています([インフラ-2](./06-infra-config-and-secrets))。
:::

## 3. まず触ってみる

1. **3 つのホスト名が、それぞれの窓口に行くのを見る**。ingress のログに、ホスト名・行き先(upstream)・利用者の IP が出ます。

   ::: code-group

   ```bash [Mac / Linux / WSL]
   for h in www api backoffice; do curl -s -o /dev/null "http://$h.lab.localhost:18080/healthz"; done
   docker compose logs ingress --no-log-prefix --since 20s | grep '"uri":"/healthz"' \
     | python3 -c 'import sys,json;[print(d["host"],"→",d["upstream"],"(status",d["status"],", client",d["remote_addr"]+")") for d in map(json.loads, sys.stdin)]'
   ```

   ```powershell [PowerShell]
   foreach ($h in 'www', 'api', 'backoffice') { curl.exe -s -o NUL "http://${h}.lab.localhost:18080/healthz" }
   docker compose logs ingress --no-log-prefix --since 20s | Select-String '"uri":"/healthz"' `
     | ForEach-Object { $d = $_.Line | ConvertFrom-Json; "$($d.host) → $($d.upstream) (status $($d.status), client $($d.remote_addr))" }
   ```

   :::

   (ingress のログには、nginx の標準の 1 行と、このラボで足した JSON の 1 行の 2 つが出ます。ここでは JSON の方(`"uri":"/healthz"`)だけを選んでいます。)
   (`/healthz` は本来内部の口ですが、ここでは「どの窓口に振り分けられたか」を見るために使っています。窓口ごとの `upstream` が違うことに注目します。)

2. **知らないホスト名は、どこにも行かない**。

   ::: code-group

   ```bash [Mac / Linux / WSL]
   curl -s http://localhost:18080/                                          # cdn-waf が案内を返す
   docker compose exec -T cdn-waf curl -s -H 'Host: shop.lab.localhost' http://ingress:8080/   # ingress は 404
   ```

   ```powershell [PowerShell]
   curl.exe -s http://localhost:18080/                                      # cdn-waf が案内を返す
   docker compose exec -T cdn-waf curl -s -H 'Host: shop.lab.localhost' http://ingress:8080/   # ingress は 404(コンテナの中の curl なので .exe なし)
   ```

   :::

3. **内部の口(`/admin`・`/metrics`・`/readyz`)が外から閉じているのを見る**。中からは開きます。

   ::: code-group

   ```bash [Mac / Linux / WSL]
   for u in /admin/chaos /metrics /readyz; do curl -s -o /dev/null -w "%{http_code} api$u\n" "http://api.lab.localhost:18080$u"; done
   curl -s -o /dev/null -w "%{http_code} www/metrics\n" http://www.lab.localhost:18080/metrics
   docker compose exec -T api curl -s -o /dev/null -w '%{http_code} 中から api /metrics\n' http://localhost:3001/metrics
   ```

   ```powershell [PowerShell]
   foreach ($u in '/admin/chaos', '/metrics', '/readyz') { "$(curl.exe -s -o NUL -w '%{http_code}' "http://api.lab.localhost:18080$u") api$u" }
   "$(curl.exe -s -o NUL -w '%{http_code}' http://www.lab.localhost:18080/metrics) www/metrics"
   docker compose exec -T api curl -s -o /dev/null -w '%{http_code} 中から api /metrics\n' http://localhost:3001/metrics
   ```

   :::

4. **管理画面の IP フィルタ(社内 = 200、社外 = 403)を見る**。この PC は「社内」、`lab_outside` は「社外」の代わりです。

   ::: code-group

   ```bash [Mac / Linux / WSL]
   docker compose exec -T ingress cat /etc/nginx/ip-filters/backoffice.conf
   curl -s -o /dev/null -w '社内(この PC) → backoffice: %{http_code}\n' http://backoffice.lab.localhost:18080/backoffice/login
   docker run --rm --network lab_outside curlimages/curl:8.16.0 -s -o /dev/null -w '社外 → backoffice: %{http_code}\n' \
     -H 'Host: backoffice.lab.localhost' http://cdn-waf:18080/backoffice/login
   docker run --rm --network lab_outside curlimages/curl:8.16.0 -s -o /dev/null -w '社外 → www(お店): %{http_code}\n' \
     -H 'Host: www.lab.localhost' http://cdn-waf:18080/
   ```

   ```powershell [PowerShell]
   docker compose exec -T ingress cat /etc/nginx/ip-filters/backoffice.conf
   "社内(この PC) → backoffice: $(curl.exe -s -o NUL -w '%{http_code}' http://backoffice.lab.localhost:18080/backoffice/login)"
   docker run --rm --network lab_outside curlimages/curl:8.16.0 -s -o /dev/null -w '社外 → backoffice: %{http_code}\n' `
     -H 'Host: backoffice.lab.localhost' http://cdn-waf:18080/backoffice/login
   docker run --rm --network lab_outside curlimages/curl:8.16.0 -s -o /dev/null -w '社外 → www(お店): %{http_code}\n' `
     -H 'Host: www.lab.localhost' http://cdn-waf:18080/
   ```

   :::

   `docker run … curlimages/curl` の行は、コンテナの中の Linux の curl を動かしているので、PowerShell でも `-o /dev/null` のままです。

5. **社内の範囲(BACKOFFICE_IP_ALLOWLIST)を変えて、この PC も締め出す**。許す範囲から 127.0.0.1 を外して起動し直すと、この PC からも 403 になります。

   ::: code-group

   ```bash [Mac / Linux / WSL]
   BACKOFFICE_IP_ALLOWLIST=172.30.89.0/24 docker compose up -d ingress
   docker compose ps ingress        # (healthy) を待つ
   docker compose logs ingress --no-log-prefix | grep -A2 'IP フィルタ' | tail -3   # 起動時に作った許す範囲
   curl -s -o /dev/null -w 'この PC → backoffice: %{http_code}\n' http://backoffice.lab.localhost:18080/backoffice/login
   docker compose up -d ingress     # 元に戻す(既定の許す範囲)
   docker compose ps ingress
   curl -s -o /dev/null -w '元に戻した後: %{http_code}\n' http://backoffice.lab.localhost:18080/backoffice/login
   ```

   ```powershell [PowerShell]
   $env:BACKOFFICE_IP_ALLOWLIST = '172.30.89.0/24'; docker compose up -d ingress
   docker compose ps ingress        # (healthy) を待つ
   docker compose logs ingress --no-log-prefix | Select-String -Context 0,2 'IP フィルタ' | Select-Object -Last 1   # 起動時に作った許す範囲
   "この PC → backoffice: $(curl.exe -s -o NUL -w '%{http_code}' http://backoffice.lab.localhost:18080/backoffice/login)"
   Remove-Item Env:BACKOFFICE_IP_ALLOWLIST; docker compose up -d ingress     # 元に戻す(既定の許す範囲)
   docker compose ps ingress
   "元に戻した後: $(curl.exe -s -o NUL -w '%{http_code}' http://backoffice.lab.localhost:18080/backoffice/login)"
   ```

   :::

   PowerShell の `Select-String -Context 0,2` は、当たった行の頭に `>` を付け、その下の 2 行も一緒に出します。

6. **偽の IP は信じないことを確かめる**。社外から、自分で `X-Forwarded-For: 127.0.0.1`(社内のふり)を付けても通りません。

   ::: code-group

   ```bash [Mac / Linux / WSL]
   docker run --rm --network lab_outside curlimages/curl:8.16.0 -s -o /dev/null -w '社外+偽XFF → backoffice: %{http_code}\n' \
     -H 'Host: backoffice.lab.localhost' -H 'X-Forwarded-For: 127.0.0.1' http://cdn-waf:18080/backoffice/login
   ```

   ```powershell [PowerShell]
   docker run --rm --network lab_outside curlimages/curl:8.16.0 -s -o /dev/null -w '社外+偽XFF → backoffice: %{http_code}\n' `
     -H 'Host: backoffice.lab.localhost' -H 'X-Forwarded-For: 127.0.0.1' http://cdn-waf:18080/backoffice/login
   ```

   :::

### 本格版では

本格版(kind)では、この振り分けと IP フィルタは **Ingress リソース**(`k8s/generated/base/ingress.yaml`。manifest.json から render.mjs が作る)になり、ingress-nginx が読みます。

::: code-group

```bash [Mac / Linux / WSL]
kubectl -n lab get ingress    # ホスト名 → どこへ、が一覧で見える
kubectl -n lab get ingress -o custom-columns='NAME:.metadata.name,HOST:.spec.rules[0].host,PATH:.spec.rules[0].http.paths[*].path,ALLOW:.metadata.annotations.nginx\.ingress\.kubernetes\.io/allowlist-source-range,DENY:.metadata.annotations.nginx\.ingress\.kubernetes\.io/denylist-source-range,RPS:.metadata.annotations.nginx\.ingress\.kubernetes\.io/limit-rps'
```

```powershell [PowerShell]
kubectl -n lab get ingress    # ホスト名 → どこへ、が一覧で見える
kubectl -n lab get ingress -o custom-columns='NAME:.metadata.name,HOST:.spec.rules[0].host,PATH:.spec.rules[0].http.paths[*].path,ALLOW:.metadata.annotations.nginx\.ingress\.kubernetes\.io/allowlist-source-range,DENY:.metadata.annotations.nginx\.ingress\.kubernetes\.io/denylist-source-range,RPS:.metadata.annotations.nginx\.ingress\.kubernetes\.io/limit-rps'
```

:::

`backoffice` の Ingress には `allowlist-source-range`(社内の範囲)、内部の口の Ingress(`*-blocked`)には `denylist-source-range: 0.0.0.0/0`(全部拒否)、
ログインの Ingress(`api-ratelimit-1`)には `limit-rps` の注釈が付いています。軽量版で nginx.conf に手で書いた振り分け・IP フィルタ・閉じる口が、注釈という形になっただけで、やっていることは同じです。

## 4. 何が見えたら成功か

**手順 1**: 同じ入口に来た 3 つのホスト名が、それぞれ別の窓口(upstream)に振り分けられます。利用者の IP(`client`)はこの PC の 127.0.0.1 です。

```text
www.lab.localhost → 172.30.89.14:4000 (status 200 , client 127.0.0.1)
api.lab.localhost → 172.30.89.12:3001 (status 200 , client 127.0.0.1)
backoffice.lab.localhost → 172.30.89.11:3001 (status 200 , client 127.0.0.1)
```

(172.30.89.… の番号は、コンテナを起動した順番で変わります。20 秒以内に 2 回打つと、同じ 3 行が 2 回ずつ出ます。)

**手順 2**: 知らないホスト名は、cdn-waf が「このホスト名は使っていません」と案内し、ingress は「エンドポイントがありません」と 404 を返します。

```text
このホスト名は使っていません。http://www.lab.localhost:18080/ を開いてください。
エンドポイントがありません(ホスト名: shop.lab.localhost)
```

**手順 3**: 内部の口は外から 403、お店の `/metrics` も 403。中からは 200。

```text
403 api/admin/chaos
403 api/metrics
403 api/readyz
403 www/metrics
200 中から api /metrics
```

**手順 4**: 許す範囲の一覧の最後に「それ以外は拒否」。この PC からは 200、社外からは 403(お店の www は社外でも 200)。

```text
allow 127.0.0.1/32;
allow 172.30.89.0/24;
allow 172.30.91.0/24;
deny all;
社内(この PC) → backoffice: 200
社外 → backoffice: 403
社外 → www(お店): 200
```

**手順 5**: 許す範囲から 127.0.0.1 を外すと、この PC からも 403。元に戻すと 200。

```text
40-ip-filter.sh: backoffice の IP フィルタ:
  allow 172.30.89.0/24;
  deny all;
この PC → backoffice: 403
元に戻した後: 200
```

**手順 6**: 偽の `X-Forwarded-For` を付けても 403。cdn-waf が `X-Forwarded-For` を本当の送り元の IP で **上書き** し、ingress は cdn-waf(172.30.89.10)から来たときだけ `X-Forwarded-For` を信じるので、社外から自分で書いた値は届く前に消えています。

```text
社外+偽XFF → backoffice: 403
```

## 5. ここで覚える言葉

| 言葉 | 一言でいうと | たとえ | この演習で見たもの |
| --- | --- | --- | --- |
| [Ingress](/guide/glossary#ingress) | ホスト名・パスで、どの窓口に渡すかの決まり | ビルの受付の案内板 | 3 つのホスト名を 3 つの窓口へ |
| [エンドポイント](/guide/glossary#endpoint) | 外に出す窓口の 1 つ 1 つ | 店の窓口 | www・api・backoffice |
| [IP フィルタ](/guide/glossary#ip-filter) | 送り元の住所で入れるかを決める | 社員証がないと入れない通用口 | backoffice が社外から 403 |
| 入口の 2 段 | 外の盾(CDN・WAF)と、中の受付(振り分け) | モールの警備員と店の受付 | cdn-waf と ingress |
| [X-Forwarded-For](/guide/glossary#x-forwarded-for) | 前段が書く「本当の利用者の IP」。偽れる | 取次が書き添える差出人 | cdn-waf からのときだけ信じる |
| 内部の口を閉じる | 指標・管理の口を外から触らせない | 従業員用ドアに鍵 | `/admin`・`/metrics` が外から 403 |

## 6. 設計書ではここに書く

- **[ネットワーク方式 4.1 振り分け](/design/architecture/04-network#s4-1)・[4.7 入口を 2 段に分ける](/design/architecture/04-network#s4-7)**: ホスト名 → 窓口の対応、cdn-waf と ingress の役割の分担。
- **[ネットワーク方式 4.4 backoffice エンドポイントの IP フィルタ](/design/architecture/04-network#s4-4)・[4.8 エンドポイントごとの IP フィルタと環境の差](/design/architecture/04-network#s4-8)**: 窓口ごとの IP フィルタ、環境(d1/s1/p1)ごとの違い。
- **[D-NW-01 4.6 ingress の振り分けと閉じる口](/design/detail/D-NW-01-edge-route#s4-6)・[4.7 本格版の Ingress との対応](/design/detail/D-NW-01-edge-route#s4-7)**: 窓口ごとの表(ホスト名・行き先・IP フィルタ・閉じる口・回数制限)と、本格版の Ingress リソース・注釈との対応。

## 7. レビューで聞く質問

- 「外に出す窓口(エンドポイント)は何個ですか。それぞれ、どのホスト名で、どのサービスに行きますか。」
- 「管理画面は、どの範囲の IP から入れますか。社外から届かないことを、どのコマンドで確かめましたか。」
- 「指標・管理・準備確認の口(`/metrics`・`/admin`・`/readyz`)は、外から閉じていますか。」
- 「利用者の本当の IP を、どのヘッダから、どの相手から来たときだけ信じますか。偽の IP を弾けますか。」
- 「環境(開発・検証・本番)ごとに、誰に開けるかは変わりますか。それは 1 か所(manifest)で決まっていますか。」

## 8. 片付け

手順 5 で `BACKOFFICE_IP_ALLOWLIST` を変えても、`docker compose up -d ingress`(つまみを付けずに起動)で既定に戻ります(PowerShell は、先に `Remove-Item Env:BACKOFFICE_IP_ALLOWLIST` で環境変数を消しておきます)。念のため確かめます。

::: code-group

```bash [Mac / Linux / WSL]
docker compose exec -T ingress cat /etc/nginx/ip-filters/backoffice.conf   # 127.0.0.1/32 が入っていればよい
curl -s -o /dev/null -w 'この PC → backoffice: %{http_code}\n' http://backoffice.lab.localhost:18080/backoffice/login   # 200 ならよい
```

```powershell [PowerShell]
Remove-Item Env:BACKOFFICE_IP_ALLOWLIST -ErrorAction SilentlyContinue; docker compose up -d ingress
docker compose exec -T ingress cat /etc/nginx/ip-filters/backoffice.conf   # 127.0.0.1/32 が入っていればよい
"この PC → backoffice: $(curl.exe -s -o NUL -w '%{http_code}' http://backoffice.lab.localhost:18080/backoffice/login)"   # 200 ならよい
```

:::
