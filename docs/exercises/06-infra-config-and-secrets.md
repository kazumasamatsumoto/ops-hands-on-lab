---
title: インフラ-2 設定値とシークレットを環境で分ける
---

# インフラ-2 設定値とシークレットを環境で分ける

::: info この演習について
- 所要時間: 約 20 分
- 使うもの: 軽量版(docker compose)。Node.js 24(`tools/manifest/render.mjs` を動かす)、`kubectl`(クラスタは要りません。YAML を組み立てて見るだけ)
- 仕組みはこちら: [仕組み-12 manifest と環境(d1・s1・p1)](/how-it-works/12-manifest-and-environments)・[仕組み-8 aspect と worker](/how-it-works/08-aspects-and-worker)
- 関係する設計書: [インフラ方式](/design/architecture/03-infrastructure)・[D-INF-01 起動構成(compose と Kubernetes)](/design/detail/D-INF-01-compose-and-k8s)・[セキュリティ方式](/design/architecture/10-security)
- 用語集: [環境変数](/guide/glossary#env-var)・[Secret](/guide/glossary#secret)・[ConfigMap](/guide/glossary#configmap)・[manifest.json](/guide/glossary#manifest-json)・[d1・s1・p1](/guide/glossary#environments)・[aspect](/guide/glossary#aspect)・[kustomize](/guide/glossary#kustomize)・[オーバーレイ](/guide/glossary#overlay)
:::

## 1. この設計書はなぜ必要か

アプリは同じでも、開発・検証・本番で **変えるべき値** があります。台数、キャッシュの有無、ログの細かさ、誰が入ってよいか、そして **パスワードなどの秘密の値(シークレット)** です。
これをプログラムの中や、みんなが見るリポジトリに書いてしまうと、取り返しがつきません。

> **よくある事故 1**: 検証環境で動作確認をするため、担当者が設定ファイルに本番の DB のパスワードを書き、そのままリポジトリに入れました。
> リポジトリは協力会社にも公開されていて、半年後の監査で見つかりました。パスワードを変えるには本番を止める必要があり、休日に緊急作業になりました。
>
> **よくある事故 2**: 本番だけ台数を 2 台にする設定を、担当者が本番の画面から手で変えていました。次のデプロイで設計図(manifest)の値 1 台に戻り、
> セールの初日に 1 台でさばくことになってお店が落ちました。「どこに書いた値が本物か」が決まっていなかったのです。

どの値を環境ごとに変えるか、どこに書くか(1 か所にまとめる)、秘密の値をどこに置き、誰が見られるか。これをインフラの方式設計書で決めます。

## 2. 何をやっているのか

サンプルストアの構成は、リポジトリ直下の **`manifest.json`** 1 つに書いてあります(CCv2 の manifest の考え方をまねた、このラボ独自の形)。

| manifest.json の項目 | 中身 | できる物 |
| --- | --- | --- |
| `aspects[]` | api・backoffice・backgroundProcessing(worker)の台数・環境変数・秘密の値の名前 | aspect ごとの Deployment(`k8s/generated/base/*.yaml`) |
| `endpoints[]` | www・api・backoffice のホスト名・行き先・IP フィルタ・閉じる口 | Ingress(`k8s/generated/base/ingress.yaml`) |
| `secrets` | 秘密の値の入れ物の名前(`lab-secrets`)と鍵の名前(`PGPASSWORD`・`BACKOFFICE_PASSWORD`) | Deployment の `secretKeyRef`(値そのものは書かない) |
| `environments.d1/s1/p1` | 環境ごとの違い(台数・キャッシュ・IP フィルタ・ログの細かさ) | 環境ごとの差分(`k8s/generated/envs/*/`) |

`node tools/manifest/render.mjs` が manifest.json を読んで、本格版の Kubernetes の定義を作ります。軽量版の `docker-compose.yml` は、この manifest に手で合わせてあり、
`render.mjs --check` で食い違いを確かめられます。

演習では、①コンテナの中の設定値を見る(同じイメージが `ASPECT` で役を変えている)、②manifest を 1 行変えると何が変わるかを見る、③d1 と p1 の違いを YAML で見比べる、
④秘密の値の置き方と「見える人には見える」ことを確かめる、の順に進みます。

たとえ: **アプリは「同じ型の金庫」、設定値は「金庫を置く場所の住所」、シークレットは「金庫の暗証番号」** です。
型(アプリ)はどの支店(環境)でも同じでよいですが、暗証番号は支店ごとに変え、設計図(リポジトリ)には書きません。
manifest.json は「全支店の設置の指示書」で、支店ごとの違い(d1・s1・p1)も同じ指示書の中に書きます。

::: tip CCv2 では
CCv2 では、リポジトリの `manifest.json` に aspect・エンドポイントなどを書き、Cloud Portal でビルドしてデプロイすると、裏で Kubernetes のリソースができます。
環境(d1・s1・p1)ごとの違いのうち、**秘密の値や環境ごとの設定値は Cloud Portal の環境の設定(サービスのプロパティ)** に置き、リポジトリには書きません。
このラボの `render.mjs` と `k8s/generated/envs/` は、その「裏でできるもの」を目に見える形にしたものです。
:::

## 3. まず触ってみる

1. **コンテナの中の設定値を見る**。api・backoffice・worker は同じイメージ(`lab/api:local`)で、`ASPECT` だけが違います。

   ::: code-group

   ```bash [Mac / Linux / WSL]
   for s in api backoffice worker; do
     echo "== $s"; docker compose exec -T $s printenv | grep -E '^(ASPECT|PGHOST|PGPASSWORD|CORS|SEARCH|CRON|BACKOFFICE|LOG_LEVEL)' | sort
   done
   echo "== storefront"; docker compose exec -T storefront printenv | grep -E '^(RENDER|SSR|API_)' | sort
   ```

   ```powershell [PowerShell]
   foreach ($s in 'api', 'backoffice', 'worker') {
     "== $s"; docker compose exec -T $s printenv | Select-String -Pattern '^(ASPECT|PGHOST|PGPASSWORD|CORS|SEARCH|CRON|BACKOFFICE|LOG_LEVEL)' | ForEach-Object { $_.Line } | Sort-Object
   }
   "== storefront"; docker compose exec -T storefront printenv | Select-String -Pattern '^(RENDER|SSR|API_)' | ForEach-Object { $_.Line } | Sort-Object
   ```

   :::

2. **manifest と compose が食い違っていないか確かめる**。

   ::: code-group

   ```bash [Mac / Linux / WSL]
   node tools/manifest/render.mjs --check
   ```

   ```powershell [PowerShell]
   node tools/manifest/render.mjs --check
   ```

   :::

3. **manifest を 1 行変えて、できる物の違いを見る**。本番(p1)の api の台数を 2 → 3 にしてみます。変える前にコピーを取ります。

   ::: code-group

   ```bash [Mac / Linux / WSL]
   cp manifest.json /tmp/manifest.json.bak
   cp -r k8s/generated /tmp/generated.bak
   python3 - <<'EOF'
   import json; m = json.load(open('manifest.json'))
   m['environments']['p1']['replicas']['api'] = 3
   json.dump(m, open('manifest.json', 'w'), ensure_ascii=False, indent=2)
   EOF
   node tools/manifest/render.mjs
   diff -r /tmp/generated.bak k8s/generated
   ```

   ```powershell [PowerShell]
   Copy-Item manifest.json "$env:TEMP/manifest.json.bak"
   Copy-Item -Recurse k8s/generated "$env:TEMP/generated.bak"
   $m = Get-Content -Raw manifest.json | ConvertFrom-Json
   $m.environments.p1.replicas.api = 3
   [IO.File]::WriteAllText("$PWD/manifest.json", ($m | ConvertTo-Json -Depth 100))
   node tools/manifest/render.mjs
   git diff --no-index "$env:TEMP/generated.bak" k8s/generated
   ```

   :::

   PowerShell には `diff` が無いので、git の「2 つのファイル(フォルダ)を比べる」機能 `git diff --no-index` を使います。違いは git の形式(`-`/`+` の行)で出ます。

   終わったら元に戻します(`render.mjs` をもう一度動かして、できる物も戻します)。

   ::: code-group

   ```bash [Mac / Linux / WSL]
   cp /tmp/manifest.json.bak manifest.json && node tools/manifest/render.mjs
   diff -r /tmp/generated.bak k8s/generated && echo 元に戻っています
   ```

   ```powershell [PowerShell]
   Copy-Item "$env:TEMP/manifest.json.bak" manifest.json && node tools/manifest/render.mjs
   git diff --no-index "$env:TEMP/generated.bak" k8s/generated && Write-Output 元に戻っています
   ```

   :::

4. **食い違いを見つける仕組みを試す**。manifest の api の `CORS_ALLOWED_ORIGINS` を別の値にして `--check` を動かし、すぐ戻します。

   ::: code-group

   ```bash [Mac / Linux / WSL]
   sed -i.tmp 's#"CORS_ALLOWED_ORIGINS": "http://www.lab.localhost:18080"#"CORS_ALLOWED_ORIGINS": "http://shop.lab.localhost:18080"#' manifest.json && rm manifest.json.tmp
   node tools/manifest/render.mjs --check; echo "終了コード=$?"
   cp /tmp/manifest.json.bak manifest.json
   ```

   ```powershell [PowerShell]
   $f = "$PWD/manifest.json"
   [IO.File]::WriteAllText($f, ([IO.File]::ReadAllText($f) -replace '"CORS_ALLOWED_ORIGINS": "http://www\.lab\.localhost:18080"', '"CORS_ALLOWED_ORIGINS": "http://shop.lab.localhost:18080"'))
   node tools/manifest/render.mjs --check; "終了コード=$LASTEXITCODE"
   Copy-Item "$env:TEMP/manifest.json.bak" manifest.json
   ```

   :::

5. **環境 d1 と p1 の違いを YAML で見比べる**。`kubectl kustomize` は、クラスタが無くても「共通(base)+ 環境の差分(overlay)」を組み立てた最終の YAML を出します。

   ::: code-group

   ```bash [Mac / Linux / WSL]
   diff <(kubectl kustomize k8s/generated/envs/d1) <(kubectl kustomize k8s/generated/envs/p1)
   ```

   ```powershell [PowerShell]
   kubectl kustomize k8s/generated/envs/d1 > "$env:TEMP/d1.yaml"
   kubectl kustomize k8s/generated/envs/p1 > "$env:TEMP/p1.yaml"
   git diff --no-index "$env:TEMP/d1.yaml" "$env:TEMP/p1.yaml"
   ```

   :::

6. **秘密の値の置き方を見る**。manifest には秘密の「名前」だけがあり、Deployment は `secretKeyRef`(入れ物 `lab-secrets` の鍵 `PGPASSWORD` を使う)で値を受け取ります。

   ::: code-group

   ```bash [Mac / Linux / WSL]
   kubectl kustomize k8s/generated/envs/p1 | grep -B3 -A4 'secretKeyRef' | head -20
   sed -n '1,20p' k8s/platform/secret.yaml
   ```

   ```powershell [PowerShell]
   kubectl kustomize k8s/generated/envs/p1 | Select-String 'secretKeyRef' -Context 3,4 | Select-Object -First 2
   Get-Content k8s/platform/secret.yaml -TotalCount 20
   ```

   :::

   PowerShell では、見つかった行の頭に `>` が付き、その前後の行と一緒に出ます(最初の 2 か所だけ)。

7. **環境変数は「見える人には見える」ことを知る**。Docker を操作できる人は、コンテナの設定値をそのまま読めます。

   ::: code-group

   ```bash [Mac / Linux / WSL]
   docker inspect lab-backoffice-1 --format '{{range .Config.Env}}{{println .}}{{end}}' | grep PASSWORD
   ```

   ```powershell [PowerShell]
   docker inspect lab-backoffice-1 --format '{{range .Config.Env}}{{println .}}{{end}}' | Select-String 'PASSWORD'
   ```

   :::

8. **秘密のファイルが git に入らないことを確かめる**(リポジトリを git で取ってきた場合)。`.gitignore` に `.env.*` が書いてあります。

   ::: code-group

   ```bash [Mac / Linux / WSL]
   printf 'BACKOFFICE_PASSWORD=x\n' > .env.staging
   git check-ignore -v .env.staging manifest.json
   rm -f .env.staging
   ```

   ```powershell [PowerShell]
   [IO.File]::WriteAllText("$PWD/.env.staging", "BACKOFFICE_PASSWORD=x`n")
   git check-ignore -v .env.staging manifest.json
   Remove-Item -Force .env.staging     # 先頭が . のファイルは「隠しファイル」扱いになることがあるので -Force を付ける
   ```

   :::

### 本格版では

本格版(kind)では、環境を切り替えて起動すると、manifest の `environments` の違いが実物に出ます。

::: code-group

```bash [Mac / Linux / WSL]
LAB_ENV=d1 LAB_SKIP_BUILD=1 k8s/up.sh
kubectl -n lab get deploy                                  # storefront・api が 1 台ずつ
kubectl -n lab get configmap lab-environment -o yaml       # LAB_ENV=d1・EDGE_CACHE=off
kubectl -n lab get secret lab-secrets -o yaml              # 値は base64 で書き換えただけ。読む権限がある人なら誰でも中身を読める
LAB_ENV=p1 LAB_SKIP_BUILD=1 k8s/up.sh                      # 戻す
```

```powershell [PowerShell]
k8s/up.ps1 -Env d1 -SkipBuild
kubectl -n lab get deploy                                  # storefront・api が 1 台ずつ
kubectl -n lab get configmap lab-environment -o yaml       # LAB_ENV=d1・EDGE_CACHE=off
kubectl -n lab get secret lab-secrets -o yaml              # 値は base64 で書き換えただけ。読む権限がある人なら誰でも中身を読める
k8s/up.ps1 -Env p1 -SkipBuild                              # 戻す
```

:::

## 4. 何が見えたら成功か

**手順 1**: 同じイメージでも `ASPECT` が違い、backoffice だけが管理画面のパスワード、worker だけが定期ジョブの間隔を持っています。storefront は描画モードと api の 2 つの住所を持っています。

```text
== api
ASPECT=api
CORS_ALLOWED_ORIGINS=http://www.lab.localhost:18080
LOG_LEVEL=info
PGHOST=db
PGPASSWORD=store
SEARCH_PROVIDER=db
== backoffice
ASPECT=backoffice
BACKOFFICE_PASSWORD=admin
LOG_LEVEL=info
PGHOST=db
PGPASSWORD=store
SEARCH_PROVIDER=db
== worker
ASPECT=backgroundProcessing
CRON_INTERVAL_SECONDS=60
...
== storefront
API_INTERNAL_URL=http://api:3001
API_PUBLIC_URL=http://api.lab.localhost:18080
RENDER_MODE=ssr
SSR_TIMEOUT_MS=3000
SSR_WINDOW_BUG=false
```

(ラボなので分かりやすい見本の値です。本番でこの書き方はしません。)

**手順 2**: 食い違いが無ければ、この 1 行です。

```text
manifest.json と docker-compose.yml・ingress/default.conf.template は食い違っていません(軽量版の既定値で比べています)。
```

**手順 3**: manifest の 1 行が、環境 p1 の差分の 1 行になります。ほかのファイルは変わりません。

```text
k8s/generated/ を作りました(base: 6 ファイル、環境: d1・s1・p1)
diff -r /tmp/generated.bak/envs/p1/kustomization.yaml k8s/generated/envs/p1/kustomization.yaml
12c12
<     count: 2
---
>     count: 3
```

**手順 4**: 食い違いが見つかると、どこがどう違うかを書いて、終了コード 1 で終わります(CI に入れておけば、食い違ったまま出さずに済みます)。

```text
食い違いがあります:
  - api の CORS_ALLOWED_ORIGINS: manifest は "http://shop.lab.localhost:18080"、compose は "http://www.lab.localhost:18080"
終了コード=1
```

**手順 5**: d1 と p1 の違いは、キャッシュの ON/OFF・台数・ログの細かさ・IP フィルタ(d1 はお店も api も社内だけ)です(抜粋)。

```text
<   EDGE_CACHE: "off"
<   LAB_ENV: d1
---
>   EDGE_CACHE: "on"
>   LAB_ENV: p1
93c93
<   replicas: 1
---
>   replicas: 2
<         - name: LOG_LEVEL
<           value: debug
>         - name: LOG_LEVEL
>           value: info
<   annotations:
<     nginx.ingress.kubernetes.io/allowlist-source-range: 127.0.0.1/32,172.30.89.0/24,172.30.91.0/24
```

**手順 6**: Deployment には値が書かれず、入れ物と鍵の名前だけです。

```text
        - name: PGPASSWORD
          valueFrom:
            secretKeyRef:
              key: PGPASSWORD
              name: lab-secrets
```

**手順 7**: コンテナの設定値は、Docker を触れる人には丸見えです。「環境変数にしたから安全」ではありません。**誰が Docker(本番なら Kubernetes や Cloud Portal)を触れるか** が守りの本体です。

```text
PGPASSWORD=store
BACKOFFICE_PASSWORD=admin
```

**手順 8**: `.env.staging` は `.gitignore` の 16 行目 `.env.*` で無視されます。`manifest.json` は無視されない(= リポジトリに入る)ので、秘密の値を書いてはいけません。

```text
.gitignore:16:.env.*	.env.staging
```

## 5. ここで覚える言葉

| 言葉 | 一言でいうと | たとえ | この演習で見たもの |
| --- | --- | --- | --- |
| [環境変数](/guide/glossary#env-var) | プログラムの外から渡す設定値 | 家電の設定スイッチ | `ASPECT=backoffice`、`RENDER_MODE=ssr` |
| [aspect](/guide/glossary#aspect) | 同じイメージを、役割ごとに分けて動かす単位 | 同じ制服の店員を、レジ係・倉庫係に分ける | api・backoffice・backgroundProcessing |
| [manifest.json](/guide/glossary#manifest-json) | 構成を 1 か所に書いた設計図 | 全支店の設置の指示書 | `render.mjs` が Deployment と Ingress を作る |
| [d1・s1・p1](/guide/glossary#environments) | 開発・ステージング・本番の環境 | 試作室・リハーサル会場・本番の舞台 | d1 はキャッシュなし・1 台・社内だけ |
| [kustomize](/guide/glossary#kustomize)・[オーバーレイ](/guide/glossary#overlay) | 共通の定義に、環境ごとの差分を重ねる書き方 | 共通の制服 + 部署ごとの名札 | `k8s/generated/envs/p1/kustomization.yaml` の `count: 3` |
| [Secret](/guide/glossary#secret)(シークレット) | 秘密の値の入れ物 | 金庫の暗証番号 | `secretKeyRef` の `lab-secrets` |
| [ConfigMap](/guide/glossary#configmap) | 秘密でない設定値の入れ物 | 支店の住所録 | `lab-environment`(`LAB_ENV`・`EDGE_CACHE`) |

## 6. 設計書ではここに書く

- **[全体方式 4.7 構成を manifest.json 1 か所に書く](/design/architecture/00-overall#s4-7)**: 「台数・環境変数・エンドポイント・IP フィルタは manifest に書く。画面で手で変えた値は次のデプロイで消える前提」。
- **[全体方式 4.2 設定は環境変数、秘密の値は別の置き場所](/design/architecture/00-overall#s4-2)**・**[インフラ方式 4.5 設定値と秘密情報](/design/architecture/03-infrastructure#s4-5)**:
  設定値の一覧を表にします。**名前・意味・既定値・環境ごとの値(d1 / s1 / p1)・秘密かどうか・どこに置くか**。
- **[インフラ方式 4.7 manifest.json から Kubernetes の定義を作る](/design/architecture/03-infrastructure#s4-7)**・**[4.8 環境 d1・s1・p1](/design/architecture/03-infrastructure#s4-8)**: 環境ごとの違いの表と、その理由(d1 はキャッシュを切って変更をすぐ見る、など)。
- **[D-INF-01 起動構成 4.5 設定と秘密](/design/detail/D-INF-01-compose-and-k8s#s4-5)**・**[4.6 manifest.json からできる物](/design/detail/D-INF-01-compose-and-k8s#s4-6)**・**[4.7 環境ごとの違い](/design/detail/D-INF-01-compose-and-k8s#s4-7)**。
- **[セキュリティ方式 4.6 秘密情報とパスワード](/design/architecture/10-security#s4-6)**: 秘密の値を見られる人・変える手順・変える周期。
- **[QA 方式 4.5 manifest と compose の食い違いを確かめる](/design/architecture/06-qa#s4-5)**: `render.mjs --check` を CI で動かす。

## 7. レビューで聞く質問

- 「環境ごとに変える値の一覧はありますか。d1・s1・p1 で違う値は、どれで、なぜ違いますか。」
- 「本番の台数や IP フィルタは、どこに書いた値が本物ですか。画面で手で変えた値が次のデプロイで戻る、ということはありませんか。」
- 「パスワードや鍵は、リポジトリ・設定ファイル・チケット・チャットのどこかに書かれていませんか。」
- 「秘密の値を見られる人は誰ですか。Docker や Kubernetes、Cloud Portal を操作できる人は全員見られる、と分かっていますか。」
- 「秘密の値を変える(ローテーションする)とき、どのサービスを再起動する必要がありますか。手順はありますか。」

## 8. 片付け

manifest.json と `k8s/generated/` が元に戻っているか確かめます。

::: code-group

```bash [Mac / Linux / WSL]
diff /tmp/manifest.json.bak manifest.json && diff -r /tmp/generated.bak k8s/generated && node tools/manifest/render.mjs --check
rm -rf /tmp/manifest.json.bak /tmp/generated.bak
```

```powershell [PowerShell]
git diff --no-index "$env:TEMP/manifest.json.bak" manifest.json && git diff --no-index "$env:TEMP/generated.bak" k8s/generated && node tools/manifest/render.mjs --check
Remove-Item -Recurse -Force "$env:TEMP/manifest.json.bak", "$env:TEMP/generated.bak"
```

:::

本格版で `LAB_ENV=d1` を試した場合は、`LAB_ENV=p1 LAB_SKIP_BUILD=1 k8s/up.sh`(PowerShell では `k8s/up.ps1 -Env p1 -SkipBuild`)で本番の形に戻します。
