---
title: インフラ-2 設定値とシークレットを環境で分ける
---

# インフラ-2 設定値とシークレットを環境で分ける

::: info この演習について
- 所要時間: 約 15 分
- 使うもの: 軽量版(docker compose)。`curl`、`openssl`(Mac・Linux には最初から入っています)
- 関係する設計書: [インフラ方式](/design/architecture/03-infrastructure)・[D-INF-01 起動構成(compose と Kubernetes)](/design/detail/D-INF-01-compose-and-k8s)・[セキュリティ方式](/design/architecture/10-security)
:::

## 1. この設計書はなぜ必要か

アプリは同じでも、開発・検証・本番で **変えるべき値** があります。つなぐ DB、ログの細かさ、そして **パスワードや署名の鍵(シークレット)** です。
これをプログラムの中や、みんなが見るリポジトリに書いてしまうと、取り返しがつきません。

> **よくある事故**: 検証環境で動作確認をするため、担当者が設定ファイルに本番の DB のパスワードを書き、そのままリポジトリに入れました。
> リポジトリは協力会社にも公開されていて、半年後の監査で見つかりました。パスワードを変えるには本番を止める必要があり、休日に緊急作業になりました。
> 別の会社では、検証環境と本番で同じ署名の鍵を使っていたため、検証環境で作ったログインの札(トークン)で本番に入れてしまいました。

どの値を環境ごとに変えるか、秘密の値をどこに置き、誰が見られるか。これをインフラの方式設計書で決めます。

## 2. 何をやっているのか

サンプルストアの設定は、すべて **環境変数**(プログラムの外から渡す設定値)で渡しています。値は `docker-compose.yml` に書いてあり、`${JWT_SECRET:-既定値}` のように **外から上書きできる** 形にしてある物もあります。
演習では、①コンテナの中の設定値を見る、②検証環境用の「秘密のファイル」`.env.staging` を作って署名の鍵を差し替える、③鍵が変わると古いログインの札が使えなくなることを見る、④そのファイルが git に入らないことを確かめる、の順に進みます。

たとえ: **アプリは「同じ型の金庫」、設定値は「金庫を置く場所の住所」、シークレットは「金庫の暗証番号」** です。
型(アプリ)はどの支店でも同じでよいですが、暗証番号は支店ごとに変え、設計図(リポジトリ)には書きません。

## 3. まず触ってみる

1. **コンテナの中の設定値を見る**。

   ```bash
   docker compose exec -T api printenv | grep -E 'PG|JWT|CHAOS|LOG' | sort
   docker compose exec -T web printenv | grep -E 'RENDER|SSR|API_INT'
   ```

2. **いまの鍵で、ログインの札を作っておく**。

   ```bash
   TOKEN=$(curl -s -X POST -H 'Content-Type: application/json' \
     -d '{"username":"alice","password":"password"}' http://localhost:18080/api/login \
     | python3 -c 'import json,sys;print(json.load(sys.stdin)["token"])')
   curl -s -o /dev/null -w 'before: %{http_code}\n' -H "Authorization: Bearer $TOKEN" http://localhost:18080/api/me/orders
   ```

3. **検証環境用の秘密のファイルを作る**。鍵は人が考えずに、乱数で作ります。画面には中身を出さないようにしています。

   ```bash
   printf 'JWT_SECRET=staging-%s\n' "$(openssl rand -hex 16)" > .env.staging
   sed 's/=.*/=(32 文字の乱数)/' .env.staging
   ```

4. **その鍵で api を起動し直す**。`--env-file` で「このファイルの値を使って」と頼みます。

   ```bash
   docker compose --env-file .env.staging up -d api
   docker compose ps api        # (healthy) を待つ
   ```

5. **古い札と新しい札を試す**。

   ```bash
   curl -s -w ' %{http_code}\n' -H "Authorization: Bearer $TOKEN" http://localhost:18080/api/me/orders
   T2=$(curl -s -X POST -H 'Content-Type: application/json' \
     -d '{"username":"alice","password":"password"}' http://localhost:18080/api/login \
     | python3 -c 'import json,sys;print(json.load(sys.stdin)["token"])')
   curl -s -o /dev/null -w 'new token: %{http_code}\n' -H "Authorization: Bearer $T2" http://localhost:18080/api/me/orders
   ```

6. **秘密が git に入らないことを確かめる**(リポジトリを git で取ってきた場合)。`.gitignore` に `.env.*` が書いてあります。

   ```bash
   git check-ignore -v .env.staging docker-compose.yml
   ```

7. **環境変数は「見える人には見える」ことを知る**。Docker を操作できる人は、コンテナの設定値をそのまま読めます。

   ```bash
   docker inspect lab-api-1 --format '{{range .Config.Env}}{{println .}}{{end}}' | grep JWT | cut -c1-20
   ```

### 本格版では

本格版(kind)では、設定値は **ConfigMap**、秘密の値は **Secret** という別々の入れ物に分けています。中身と作り方は `k8s/README.md` と `k8s/` のマニフェストを見てください。

```bash
kubectl get configmap,secret -n lab          # 入れ物の一覧
kubectl describe secret -n lab               # 中身の「名前と大きさ」だけが出て、値は出ない
```

## 4. 何が見えたら成功か

**手順 1**: api は DB の接続先・パスワード・署名の鍵を、web は描画モードや api の住所を、環境変数で受け取っています。

```text
CHAOS_ERROR_RATE=0
...
JWT_SECRET=lab-only-not-a-real-secret
LOG_LEVEL=info
PGDATABASE=store
PGHOST=db
PGPASSWORD=store
PGUSER=store

API_INTERNAL_URL=http://api:3001
SSR_TIMEOUT_MS=3000
SSR_WINDOW_BUG=false
RENDER_MODE=ssr
```

(ラボなので分かりやすい見本の値です。本番でこの書き方はしません。)

**手順 2〜5**: 鍵を変えた瞬間に、古い鍵で作った札は使えなくなり、新しい鍵で作った札だけが通ります。

```text
before: 200
JWT_SECRET=(32 文字の乱数)
{"error":"unauthorized","message":"トークンが無効か、期限切れです"} 401
new token: 200
```

これは「検証環境で作った札を本番に持ち込んでも使えない」ことと同じです。環境ごとに鍵を分ける意味がここにあります。
逆に、本番で鍵を変えると **ログイン中の全員が一度ログアウトされる** ことも分かります(鍵を変える手順書に書くべきことです)。

**手順 6**: `.env.staging` は `.gitignore` の 16 行目 `.env.*` で除外されます。`docker-compose.yml` は除外されない(= 入る)ので、何も出ません。

```text
.gitignore:16:.env.*	.env.staging
```

**手順 7**: Docker を操作できる人には、秘密の値が見えます。

```text
JWT_SECRET=staging-f
```

「秘密の置き場所」だけでなく「誰がその置き場所を見られるか」も決めないと、秘密は守れません。

### リポジトリに入れてよい物・いけない物

| 物 | 例(このラボ) | リポジトリ | 理由 |
| --- | --- | --- | --- |
| 環境で変わらない設定 | ポート番号、キャッシュ 30 秒 | 入れる | 皆で同じ物を使い、変更の履歴を残したい |
| 環境で変わる設定(秘密でない) | `RENDER_MODE`、`LOG_LEVEL`、api の住所 | 入れる(環境ごとのファイルで) | 間違えたら差分で気づける |
| シークレット | DB のパスワード、`JWT_SECRET`、外部サービスの API キー、`*.pem` | **入れない** | 一度入れると履歴から消せない |
| 個人のデータ | `backups/` の DB のバックアップ | **入れない** | 会員の情報が入っている |

## 5. ここで覚える言葉

| 言葉 | 一言でいうと | たとえ | この演習で見たもの |
| --- | --- | --- | --- |
| 環境変数 | プログラムの外から渡す設定値 | 家電の設定スイッチ | `printenv` で見た `PGHOST=db` など |
| シークレット | 知られたら困る値(パスワード・鍵) | 金庫の暗証番号 | `JWT_SECRET`、`PGPASSWORD` |
| 環境(開発・検証・本番) | 同じアプリを動かす別々の場所 | 同じ型の金庫を置く別々の支店 | `.env.staging` を作って api を起動し直した |
| `.env` ファイル | 環境変数をまとめて書いたファイル。リポジトリに入れない | 暗証番号を書いた封筒(金庫室にしまう) | `docker compose --env-file .env.staging` |
| `.gitignore` | git に入れないファイルの一覧 | 「持ち出し禁止」の棚の一覧 | `.gitignore:16:.env.*` |
| 鍵の入れ替え(ローテーション) | 秘密の値を定期的・緊急時に変えること | 暗証番号の変更 | 鍵を変えたら古い札が 401 |
| ConfigMap / Secret | Kubernetes の、設定値と秘密の値の入れ物 | 普通の書類棚と、鍵付きの書類棚 | 本格版の `kubectl get configmap,secret` |

## 6. 設計書ではここに書く

- **[インフラ方式 4.5 設定値と秘密情報](/design/architecture/03-infrastructure#s4-5)**:
  「設定はすべて環境変数で渡す」「シークレットはリポジトリに入れず、Secret(本番はクラウドの秘密の保管庫)に置く」「見られるのは運用担当の○○だけ」。
- **[全体方式 4.2 設定は環境変数、秘密の値は別の置き場所](/design/architecture/00-overall#s4-2)**: システム全体の決まりとして 1 行。
- **[D-INF-01 起動構成 4.5 設定と秘密](/design/detail/D-INF-01-compose-and-k8s#s4-5)**(一般のカタログでは D-INF-01): 環境変数の一覧表。**名前・意味・既定値・開発/検証/本番の値・秘密かどうか** の列を作り、秘密の行は値を書かず「Secret の○○から」と書きます。
- **[セキュリティ方式 4.6 秘密情報とパスワード](/design/architecture/10-security#s4-6)**(一般のカタログでは D-SEC-10 秘密情報の管理): 「環境ごとに鍵を分ける」「鍵は年 1 回と、漏れた疑いがあるときに入れ替える」「入れ替えると全員がログアウトされるので、時間帯と告知を決める」。

## 7. レビューで聞く質問

- 「この変更で、新しく増えた設定値はありますか。環境変数の一覧表に、開発・検証・本番の値が書いてありますか。」
- 「パスワードや鍵が、コード・設定ファイル・テストデータ・ログのどこかに書かれていませんか。」
- 「検証環境と本番で、同じパスワードや同じ鍵を使っている所はありますか。」
- 「その秘密の値を見られるのは誰ですか。見た記録は残りますか。」
- 「鍵を入れ替えるとき、利用者や他のシステムに何が起きますか(全員ログアウトなど)。手順書はありますか。」
- 「もし秘密の値をリポジトリに入れてしまったら、何をする決まりですか(値の入れ替えが先、履歴の削除は後)。」

## 8. 片付け

鍵をラボの既定値に戻し、秘密のファイルを消します。

```bash
docker compose up -d api                       # --env-file を付けずに起動し直す
docker compose ps api                          # (healthy) を待つ
docker compose exec -T api printenv JWT_SECRET # lab-only-not-a-real-secret に戻ればよい
rm -f .env.staging
unset TOKEN T2
```
