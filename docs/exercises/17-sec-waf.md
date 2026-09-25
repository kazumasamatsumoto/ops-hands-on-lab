---
title: セキュリティ-1 WAF が攻撃を止める
---

# セキュリティ-1 WAF が攻撃を止める

::: info この演習について
- 所要時間: 約 30 分
- 使うもの: 軽量版(docker compose)。`tools/attack-samples.sh`、`tools/chaos.sh`、`curl`
- 関係する設計書: [セキュリティ方式 4.1 WAF](/design/architecture/10-security#s4-1)・[セキュリティ方式 4.2 誤遮断の直し方](/design/architecture/10-security#s4-2)・[BE 方式 4.4 SQL の書き方](/design/architecture/02-backend#s4-4)・[D-SEC-01 WAF とレート制限](/design/detail/D-SEC-01-waf-and-rate-limit)
:::

::: danger 攻撃の見本は、このラボにだけ使ってください
この演習の攻撃の文字列は、自分の PC の中のラボ(http://localhost:18080)に送るためだけの物です。実在するサイトや他人のサーバーに送ってはいけません。許可なく送ると法律に触れるおそれがあります。
:::

## 1. この設計書はなぜ必要か

アプリの穴は、どれだけ気をつけてもゼロにはなりません。入口で「典型的な攻撃の形」を止める WAF は、その穴が見つかるまでの時間を稼ぐ **2 枚目の壁** です。
ただし、厳しくしすぎると、普通のお客様まで止めてしまいます。

> **よくある事故(穴)**: 商品検索の入力欄に特殊な文字を入れると、SQL の意味が書き換わる穴がありました。攻撃者は検索欄から、会員のパスワードの控えを抜き出しました。
>
> **よくある事故(厳しすぎ)**: それを受けて WAF を一番厳しい設定にしたところ、翌日「検索すると 403 になる」と問い合わせが殺到。日本語の検索がほぼ全部止まっていました。
> 慌てた担当者は WAF を丸ごと切り、元の穴だらけの状態に戻してしまいました。

どこに WAF を置き、どれくらいの厳しさで、誤って止めたときにどう直すか。これをセキュリティの方式設計書に書きます。

## 2. 何をやっているのか

サンプルストアの入口 edge には、ModSecurity(WAF の本体)と OWASP CRS(攻撃の形を集めたルール集)が入っています。
リクエストを 1 つずつルールに当て、当たるたびに「怪しさの点数」を足し、**合計が 5 点以上なら 403 で止めます**(`ANOMALY_INBOUND`)。
**疑い深さ**(`BLOCKING_PARANOIA`、1〜4)を上げるほど、細かいルールまで使うので、攻撃に強くなる代わりに誤遮断も増えます。

演習では、①攻撃の見本が止まるのを見る、②アプリに本物の穴(`sqliBug`)を開けて、WAF を通さないと何が抜かれるかを見る、③疑い深さを上げて誤遮断を起こす、④誤遮断を「狭い例外」で直す、の順に進みます。

たとえ: **空港の保安検査** です。検査員(WAF)は荷物の「怪しさ」を点数で見て、一定以上なら止めます。
検査を厳しくするほど危ない物は通りにくくなりますが、ペットボトルや爪切りまで止められて、普通の旅行者が怒り出します。
そのときは「検査をやめる」のではなく、「この種類の荷物のこの点だけ見ない」という例外を、狭く決めて書きます。

## 3. まず触ってみる

1. **攻撃の見本を送る**。

   ```bash
   tools/attack-samples.sh
   ```

2. **なぜ止めたかを見る**(ルールの番号)。

   ```bash
   docker compose logs edge --no-log-prefix --since 1m | grep -o '"ruleId":"[0-9]*"' | sort | uniq -c
   ```

3. **アプリに SQL インジェクションの穴を開ける**。

   ```bash
   tools/chaos.sh set sqliBug=true
   ```

4. **WAF を通さずに(api に直接)攻撃する**。`docker compose exec api` で api のコンテナの中から、api に直接送ります(edge を通らない = WAF が無い状態)。

   ```bash
   docker compose exec -T api curl -s "http://localhost:3001/api/products?q=%27%20UNION%20SELECT%20id%2Cusername%2Cpassword_hash%2C%27x%27%2C1%2C1%20FROM%20users--" \
     | python3 -c 'import json,sys;d=json.load(sys.stdin);print(len(d),"rows");[print(r["id"],r["name"],r["description"][:24]+"…") for r in d if r["category"]=="x"]'
   docker compose logs api --no-log-prefix --since 1m | grep sqliBug | tail -1 | cut -c1-250
   ```

5. **同じ攻撃を、edge(WAF)経由で送る**。

   ```bash
   curl -s -o /dev/null -w '%{http_code}\n' "http://localhost:18080/api/products?q=%27%20UNION%20SELECT%20id%2Cusername%2Cpassword_hash%2C%27x%27%2C1%2C1%20FROM%20users--"
   docker compose logs edge --no-log-prefix --since 1m | grep '"transaction"' | tail -1 | grep -o '"ruleId":"[0-9]*"' | sort | uniq -c
   tools/chaos.sh reset
   ```

   2 行目の `tail -1` は「edge が最後に止めた 1 件(今送った攻撃)」だけを見るためです。付けないと、手順 1 の見本の分も混ざって数えられます。

6. **疑い深さを上げて、普通の検索を試す**。1 → 3 に上げ、日本語や記号の入った普通の検索を送ります。

   ```bash
   BLOCKING_PARANOIA=3 docker compose up -d edge
   docker compose ps edge        # (healthy) を待つ
   for q in "%E3%83%8E%E3%83%BC%E3%83%88%20(A5)" "50%25%20off" "O%27Reilly" "select%20pen"; do
     printf '%s %s\n' "$(curl -s -o /dev/null -w '%{http_code}' "http://localhost:18080/api/products?q=$q")" "$q"
   done
   ```

   (`%E3%83%8E%E3%83%BC%E3%83%88%20(A5)` は「ノート (A5)」、`50%25%20off` は「50% off」を URL の形に直した物です。)

7. **止めた理由を見る**。

   ```bash
   docker compose logs edge --no-log-prefix --since 1m | grep '"transaction"' | grep 'A5' | tail -1 \
     | python3 -c 'import json,sys;[print(m["details"]["ruleId"],"|",m["message"][:70]) for m in json.loads(sys.stdin.read())["transaction"]["messages"]]'
   ```

8. **狭い例外で直す**。`edge/modsecurity/lab-exclusions-before.conf` の最後に、次の 6 行を足します(「商品検索の URL の、`q` と URL の文字だけ、日本語で当たった 2 つのルールを見ない」という意味です)。

   ```bash
   cp edge/modsecurity/lab-exclusions-before.conf /tmp/excl.bak
   cat >> edge/modsecurity/lab-exclusions-before.conf <<'EOF'

   # 演習: 商品検索だけ、日本語で誤遮断した 2 つのルールを「q と URL」から外す
   SecRule REQUEST_URI "@beginsWith /api/products" \
       "id:1002,phase:1,pass,nolog,\
       ctl:ruleRemoveTargetById=920272;ARGS:q,\
       ctl:ruleRemoveTargetById=920272;REQUEST_URI_RAW,\
       ctl:ruleRemoveTargetById=942460;ARGS:q"
   EOF
   BLOCKING_PARANOIA=3 docker compose up -d --force-recreate edge
   docker compose ps edge        # (healthy) を待つ
   curl -s -o /dev/null -w '%{http_code} ノート (A5)\n' "http://localhost:18080/api/products?q=%E3%83%8E%E3%83%BC%E3%83%88%20(A5)"
   curl -s -o /dev/null -w '%{http_code} UNION attack\n' "http://localhost:18080/api/products?q=%27%20UNION%20SELECT%20id%2Cusername%2Cpassword_hash%2C%27x%27%2C1%2C1%20FROM%20users--"
   curl -s -o /dev/null -w '%{http_code} ノート on /products (page)\n' "http://localhost:18080/products?q=%E3%83%8E%E3%83%BC%E3%83%88"
   ```

## 4. 何が見えたら成功か

**手順 1**: 普通の検索だけ 200、攻撃の見本は全部 403。

```text
200  普通の検索(通るべき)
403  SQL インジェクション: 常に真
403  SQL インジェクション: UNION
403  SQL インジェクション: コメント
403  XSS: script タグ
403  XSS: img onerror
403  パスの巡回(../)
```

**手順 4(WAF なし)**: 商品 30 件に混ざって、**会員 3 人の名前とパスワードの控え**(ハッシュ)が返ってきます。ログには、検索語がそのまま SQL に連結されたことが残ります。

```text
33 rows
3 carol scrypt$d38d2328d06d74ad6…
2 bob scrypt$9cf2d1d5f89a2359b…
1 alice scrypt$a567fa32c34aefcf7…

{"level":40,"service":"api","chaos":"sqliBug","sql":"SELECT id, name, description, category, price, stock FROM products WHERE name ILIKE '%' UNION SELECT id,username,password_hash,'x',1,1 FROM users--%' ORDER BY id",...}
```

**手順 5(WAF あり)**: 403。4 つのルールが SQL インジェクションの形を見つけ、合計 20 点で止めました。

```text
403
   1 "ruleId":"942100"      ← SQL Injection Attack Detected via libinjection
   1 "ruleId":"942190"
   1 "ruleId":"942270"
   1 "ruleId":"942360"
   1 "ruleId":"949110"      ← Inbound Anomaly Score Exceeded (Total Score: 20)
```

WAF は穴を「ふさいで」はいません。**穴はアプリにあり、直すのはアプリ(値を SQL に連結せず、置き場所 `$1` で渡す)** です。WAF は、直すまでの間と、見落とした穴のための 2 枚目の壁です。

**手順 6**: 疑い深さ 3 では、日本語や記号の入った普通の検索が止められます。疑い深さ 1〜4 で同じ入力を試した結果(実測)は次のとおりです。

| 入力 | 1 | 2 | 3 | 4 |
| --- | --- | --- | --- | --- |
| ノート (A5) | 200 | 200 | **403** | **403** |
| 50% off | 200 | 200 | **403** | **403** |
| O'Reilly | 200 | 200 | 200 | **403** |
| select pen | 200 | 200 | 200 | **403** |
| ログイン(`POST /api/login`) | 200 | 200 | 200 | **403** |
| 商品詳細の画面 | 200 | 200 | 200 | 200 |

疑い深さ 4 では、**ログインすらできなくなりました**。

**手順 7**: 「ノート (A5)」を止めた理由。日本語の文字(ASCII 以外)そのものが「おかしな文字」とみなされています。

```text
920272 | Invalid character in request (outside of printable chars below ascii 127)
942460 | Meta-Character Anomaly Detection Alert - Repetitive Non-Word Characters
949110 | Inbound Anomaly Score Exceeded (Total Score: 13)
```

**手順 8**: 例外を入れると、API の日本語検索は通り、攻撃は止まったまま。例外を書いていない画面の検索(`/products?q=`)は、まだ止まります。**例外が狭く効いている** 証拠です。

```text
200 ノート (A5)
403 UNION attack
403 ノート on /products (page)
```

## 5. ここで覚える言葉

| 言葉 | 一言でいうと | たとえ | この演習で見たもの |
| --- | --- | --- | --- |
| WAF | 入口で、攻撃の形をしたリクエストを止める仕組み | 空港の保安検査 | edge の 403 |
| SQL インジェクション | 入力に SQL の断片を混ぜ、命令の意味を書き換える攻撃 | 注文書の余白に「ついでに金庫も開けて」と書き足す | `sqliBug=true` で会員 3 人のハッシュが漏れた |
| プレースホルダ | 値を SQL の「置き場所」に入れて渡す、安全な書き方 | 注文書の決まった欄にしか書けない | api の正しい書き方 `ILIKE $1` |
| 異常スコア(怪しさの点数) | ルールに当たるたびに足す点数。一定以上で遮断 | 検査の減点方式 | `Total Score: 20` |
| 疑い深さ(パラノイアレベル) | どこまで細かいルールを使うか(1〜4) | 検査の厳しさ | 3 で日本語検索が 403、4 でログインも 403 |
| 誤遮断(フォールスポジティブ) | 普通のリクエストを攻撃と間違えて止めること | ペットボトルで止められる | 「ノート (A5)」が 403 |
| 例外ルール | 特定の URL・項目・ルールだけ検査から外す書き方 | 「液体はこの袋に入れれば可」 | `ctl:ruleRemoveTargetById=920272;ARGS:q` |
| 検知だけのモード(DetectionOnly) | 止めずに記録だけする設定 | 検査はするが通す試行期間 | `MODSEC_RULE_ENGINE`(この演習では使わない) |

## 6. 設計書ではここに書く

- **[セキュリティ方式 4.1 WAF](/design/architecture/10-security#s4-1)**: 「入口に WAF を置き、遮断モードで動かす。疑い深さは 1(日本語のサイトで 3 以上は誤遮断が多いことを確かめた)。点数のしきい値は 5」「WAF はアプリの穴を直す代わりではない」。
- **[セキュリティ方式 4.2 誤遮断の直し方](/design/architecture/10-security#s4-2)**: 「誤遮断が出たら WAF を切らない。ログのルール番号を見て、**URL・項目・ルール番号を絞った例外** を書き、レビューを通す」「新しい設定は、まず検知だけのモードで 1 週間様子を見る」。
- **[BE 方式 4.4 SQL の書き方](/design/architecture/02-backend#s4-4)**: 「値は必ずプレースホルダで渡す。文字列の連結で SQL を組み立てない」。
- **[QA 方式 4.4 守りの確認](/design/architecture/06-qa#s4-4)**: WAF の設定を変えたら、`tools/attack-samples.sh` のような確認を毎回流す。
- **[D-SEC-01 WAF とレート制限](/design/detail/D-SEC-01-waf-and-rate-limit)**(一般のカタログでは D-SEC-01): [4.1 WAF の設定値](/design/detail/D-SEC-01-waf-and-rate-limit#s4-1)(疑い深さ・しきい値)と、[4.2 例外の書き方](/design/detail/D-SEC-01-waf-and-rate-limit#s4-2)(例外の一覧: ID・URL・項目・ルール番号・理由・承認者)。

## 7. レビューで聞く質問

- 「WAF は遮断モードですか、記録だけのモードですか。疑い深さとしきい値はいくつで、なぜその値ですか。」
- 「WAF が止めた・止めなかったを確かめる試験(攻撃の見本)は、設定を変えるたびに流していますか。」
- 「誤遮断が出たとき、例外はどの URL・どの項目・どのルールに絞りましたか。WAF 全体を切っていませんか。」
- 「WAF を通らずにアプリに届く道(管理用の口、社内からの直接の接続など)はありませんか。」
- 「アプリ側で、SQL は全部プレースホルダで組み立てていますか。WAF に頼って直していない穴はありませんか。」

## 8. 片付け

例外のファイルを元に戻し、疑い深さを既定の 1 に戻します。

```bash
cp /tmp/excl.bak edge/modsecurity/lab-exclusions-before.conf && rm /tmp/excl.bak
docker compose up -d --force-recreate edge      # BLOCKING_PARANOIA を付けずに = 1
docker compose ps edge                          # (healthy) を待つ
docker compose exec -T edge printenv BLOCKING_PARANOIA   # 1 ならよい
tools/chaos.sh reset                            # sqliBug を false に(手順 5 で済んでいれば不要)
tools/attack-samples.sh                         # 最初と同じ結果(普通の検索 200、攻撃 403)ならよい
```
