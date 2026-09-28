---
title: セキュリティ-1 WAF が攻撃を止める
---

# セキュリティ-1 WAF が攻撃を止める

::: info この演習について
- 所要時間: 約 25 分
- 使うもの: 軽量版(docker compose)。`curl`(PowerShell は `curl.exe`)、`tools/attack-samples.sh`・`tools/chaos.sh`(PowerShell は `tools/attack-samples.ps1`・`tools/chaos.ps1`)
- 仕組みはこちら: [仕組み-1 cdn-waf(CDN と WAF)](/how-it-works/01-cdn-waf)・[仕組み-9 検索と Solr](/how-it-works/09-search-solr)
- 関係する設計書: [セキュリティ方式](/design/architecture/10-security)・[D-SEC-01 WAF とレート制限](/design/detail/D-SEC-01-waf-and-rate-limit)
- 用語集: [WAF](/guide/glossary#waf)・[ModSecurity](/guide/glossary#modsecurity)・[OWASP CRS](/guide/glossary#owasp-crs)・[異常スコア](/guide/glossary#anomaly-score)・[パラノイアレベル](/guide/glossary#paranoia-level)・[誤遮断](/guide/glossary#false-positive)・[SQL インジェクション](/guide/glossary#sql-injection)
:::

## 1. この設計書はなぜ必要か

アプリに穴(SQL インジェクションなど)が残っていても、入口で怪しい入力を止められれば、被害を防げます。ただし止め方を厳しくしすぎると、普通のお客様まで止めてしまいます。

> **よくある事故**: 検索欄に、ある文字列を入れるだけで、会員のパスワードの控えが引き出せる状態になっていました(SQL インジェクション)。
> アプリの直しは間に合っていませんでしたが、入口に WAF が入っていたので、その攻撃は入口で止まり、被害はありませんでした。
> 別の会社では WAF を厳しくしすぎて、日本語の商品名で検索できなくなり、売り上げが落ちました。

「入口でどんな攻撃を止めるか」「厳しさをどう決めるか」「誤って止めたときにどう直すか」を、セキュリティの方式設計書で決めます。

## 2. 何をやっているのか

サンプルストアの入口 cdn-waf には、ModSecurity(WAF の本体)と OWASP CRS(攻撃の形を集めたルール集)が入っています。
リクエストを 1 つずつルールに当て、当たるたびに「怪しさの点数(異常スコア)」を足し、**合計が 5 点以上なら 403 で止めます**(`ANOMALY_INBOUND`)。
**疑い深さ**(`BLOCKING_PARANOIA`、1〜4)を上げるほど、細かいルールまで使うので、攻撃に強くなる代わりに誤遮断も増えます。

演習では、①攻撃の見本が止まるのを見る、②アプリに本物の穴(`sqliBug`)を開けて、WAF を通さないと検索の意味が書き換わることを見る、③疑い深さを上げて誤遮断を起こす、④誤遮断を「狭い例外」で直す、の順に進みます。

たとえ: **空港の保安検査** です。検査員(WAF)は荷物の「怪しさ」を点数で見て、一定以上なら止めます。
検査を厳しくするほど危ない物は通りにくくなりますが、ペットボトルや爪切りまで止められて、普通の旅行者が怒り出します。
そのときは「検査をやめる」のではなく、「この種類の荷物のこの点だけ見ない」という例外を、狭く決めて書きます。

::: tip CCv2 では
cdn-waf は、CCv2 の案件で別に契約する WAF(例: AWS WAF)に当たります。「アプリの穴が直るまでの盾」であり、「見落とした穴のための 2 枚目の壁」でもあります。
WAF はアプリの穴を塞ぐものではありません。穴はアプリで直します(値を SQL に連結せず、置き場所で渡す)。誤遮断を狭く直す考え方も、どの WAF でも共通です。
:::

## 3. まず触ってみる

::: warning 攻撃の見本は、このラボにだけ
`tools/attack-samples.sh`(`tools/attack-samples.ps1`)と、この演習の攻撃の文字列は、**このラボ(www.lab.localhost・api.lab.localhost)にだけ** 送ってください。実在のサイトや他人のサーバーに送ってはいけません。許可なく送ると法律に触れるおそれがあります。
:::

1. **攻撃の見本を送る**。普通の検索は通り、攻撃は止まります。

   ::: code-group

   ```bash [Mac / Linux / WSL]
   tools/attack-samples.sh
   ```

   ```powershell [PowerShell]
   tools/attack-samples.ps1
   ```

   :::

2. **なぜ止めたかを見る**(ルールの番号)。

   ::: code-group

   ```bash [Mac / Linux / WSL]
   docker compose logs cdn-waf --no-log-prefix --since 1m | grep -o '"ruleId":"[0-9]*"' | sort | uniq -c
   ```

   ```powershell [PowerShell]
   docker compose logs cdn-waf --no-log-prefix --since 1m | Select-String -Pattern '"ruleId":"[0-9]*"' -AllMatches `
     | ForEach-Object { $_.Matches.Value } | Group-Object | Select-Object Count, Name
   ```

   :::

   PowerShell では、ルール番号ごとの回数が `Count` と `Name` の 2 列の表で出ます。

3. **アプリに SQL インジェクションの穴を開けて、WAF を通さずに試す**。`sqliBug=true` にすると、検索語がそのまま SQL に連結されます。
   ここでは「常に真になる条件(`' OR '1'='1`)」を、cdn-waf を通さずに api の中から直接送り、**検索の意味が書き換わって全商品が返る** ことだけを確かめます(会員の情報は引き出しません)。

   ::: code-group

   ```bash [Mac / Linux / WSL]
   tools/chaos.sh set sqliBug=true
   docker compose exec -T api curl -s "http://localhost:3001/occ/v2/samplestore/products/search?query=%27%20OR%20%271%27%3D%271" \
     | python3 -c 'import json,sys;print("返った件数:",json.load(sys.stdin)["pagination"]["totalResults"],"(= 全 30 件。検索語で件数が変わっていない = SQL の意味が書き換わった)")'
   docker compose logs api --no-log-prefix --since 30s | grep sqliBug | tail -1 \
     | python3 -c 'import sys,json;s=json.loads(sys.stdin.read())["sql"];print("危ない SQL: …",s[s.find("WHERE"):][:70],"…")'
   ```

   ```powershell [PowerShell]
   tools/chaos.ps1 set sqliBug=true
   $r = docker compose exec -T api curl -s "http://localhost:3001/occ/v2/samplestore/products/search?query=%27%20OR%20%271%27%3D%271" | ConvertFrom-Json
   "返った件数: $($r.pagination.totalResults) (= 全 30 件。検索語で件数が変わっていない = SQL の意味が書き換わった)"
   $s = (docker compose logs api --no-log-prefix --since 30s | Select-String sqliBug | Select-Object -Last 1 | ForEach-Object { $_.Line } | ConvertFrom-Json).sql
   "危ない SQL: … " + [regex]::Match($s, 'WHERE.{0,65}').Value + " …"
   ```

   :::

4. **同じ攻撃を、cdn-waf(WAF)経由で送る**。

   ::: code-group

   ```bash [Mac / Linux / WSL]
   curl -s -o /dev/null -w '%{http_code}\n' "http://api.lab.localhost:18080/occ/v2/samplestore/products/search?query=%27%20OR%20%271%27%3D%271"
   docker compose logs cdn-waf --no-log-prefix --since 20s | grep '"transaction"' | tail -1 | grep -o '"ruleId":"[0-9]*"' | sort | uniq -c
   tools/chaos.sh reset
   ```

   ```powershell [PowerShell]
   curl.exe -s -o NUL -w '%{http_code}\n' "http://api.lab.localhost:18080/occ/v2/samplestore/products/search?query=%27%20OR%20%271%27%3D%271"
   docker compose logs cdn-waf --no-log-prefix --since 20s | Select-String '"transaction"' | Select-Object -Last 1 | ForEach-Object { $_.Line } `
     | Select-String -Pattern '"ruleId":"[0-9]*"' -AllMatches | ForEach-Object { $_.Matches.Value } | Group-Object | Select-Object Count, Name
   tools/chaos.ps1 reset
   ```

   :::

   2 行目の `tail -1`(PowerShell は `Select-Object -Last 1`)は「cdn-waf が最後に止めた 1 件(今送った攻撃)」だけを見るためです。

5. **疑い深さを上げて、普通の検索を試す**。1 → 3 → 4 と上げ、日本語や記号の入った普通の検索を送ります。

   ::: code-group

   ```bash [Mac / Linux / WSL]
   A=http://api.lab.localhost:18080/occ/v2/samplestore/products/search?query=
   for pl in 1 3 4; do
     BLOCKING_PARANOIA=$pl docker compose up -d cdn-waf >/dev/null 2>&1
     docker compose ps cdn-waf | grep -q healthy || sleep 3
     printf 'PL=%s: ' $pl
     for q in "%E3%83%8E%E3%83%BC%E3%83%88%20(A5)" "50%25%20off" "O%27Reilly" "select%20pen"; do
       printf '%s ' "$(curl -s -o /dev/null -w '%{http_code}' "$A$q")"
     done; echo "  (ノート(A5) / 50% off / O'Reilly / select pen)"
   done
   ```

   ```powershell [PowerShell]
   $A = 'http://api.lab.localhost:18080/occ/v2/samplestore/products/search?query='
   foreach ($pl in 1, 3, 4) {
     $env:BLOCKING_PARANOIA = "$pl"; docker compose up -d cdn-waf *> $null
     if (-not (docker compose ps cdn-waf | Select-String healthy)) { Start-Sleep 3 }
     $codes = foreach ($q in '%E3%83%8E%E3%83%BC%E3%83%88%20(A5)', '50%25%20off', 'O%27Reilly', 'select%20pen') { curl.exe -s -o NUL -w '%{http_code}' "${A}${q}" }
     "PL=${pl}: $($codes -join ' ')  (ノート(A5) / 50% off / O'Reilly / select pen)"
   }
   ```

   :::

6. **止めた理由を見る**(疑い深さ 3 のとき)。

   ::: code-group

   ```bash [Mac / Linux / WSL]
   BLOCKING_PARANOIA=3 docker compose up -d cdn-waf >/dev/null 2>&1; sleep 3
   curl -s -o /dev/null "$A%E3%83%8E%E3%83%BC%E3%83%88%20(A5)"
   docker compose logs cdn-waf --no-log-prefix --since 15s | grep '"transaction"' | grep 'A5' | tail -1 \
     | python3 -c 'import sys,json;[print(m["details"]["ruleId"],"|",m["message"][:60]) for m in json.loads(sys.stdin.read())["transaction"]["messages"]]'
   ```

   ```powershell [PowerShell]
   $env:BLOCKING_PARANOIA = '3'; docker compose up -d cdn-waf *> $null; Start-Sleep 3
   curl.exe -s -o NUL "${A}%E3%83%8E%E3%83%BC%E3%83%88%20(A5)"
   $t = docker compose logs cdn-waf --no-log-prefix --since 15s | Select-String '"transaction"' | ForEach-Object { $_.Line } `
     | Select-String 'A5' | Select-Object -Last 1 | ForEach-Object { $_.Line } | ConvertFrom-Json
   $t.transaction.messages | ForEach-Object { "$($_.details.ruleId) | $($_.message.Substring(0, [Math]::Min(60, $_.message.Length)))" }
   ```

   :::

7. **狭い例外で直す**。`cdn-waf/modsecurity/lab-exclusions-before.conf` の最後に、次を足します(「商品検索の query と URL だけ、日本語・記号で誤遮断したルールを外す」という意味です)。

   ::: code-group

   ```bash [Mac / Linux / WSL]
   cp cdn-waf/modsecurity/lab-exclusions-before.conf /tmp/excl.bak
   cat >> cdn-waf/modsecurity/lab-exclusions-before.conf <<'EOF'

   # 演習: 商品検索の query だけ、日本語・記号で誤遮断したルールを外す(狭い例外)
   SecRule REQUEST_URI "@beginsWith /occ/v2/samplestore/products/search" \
       "id:1002,phase:1,pass,nolog,\
       ctl:ruleRemoveTargetById=920272;ARGS:query,\
       ctl:ruleRemoveTargetById=920272;REQUEST_URI_RAW,\
       ctl:ruleRemoveTargetById=920273;ARGS:query,\
       ctl:ruleRemoveTargetById=920273;REQUEST_URI_RAW,\
       ctl:ruleRemoveTargetById=942460;ARGS:query,\
       ctl:ruleRemoveTargetById=942432;ARGS:query"
   EOF
   BLOCKING_PARANOIA=3 docker compose up -d --force-recreate cdn-waf >/dev/null 2>&1; sleep 3
   curl -s -o /dev/null -w '%{http_code} ノート (A5) 検索 API\n' "$A%E3%83%8E%E3%83%BC%E3%83%88%20(A5)"
   curl -s -o /dev/null -w '%{http_code} 常に真の攻撃(止まったまま)\n' "$A%27%20OR%20%271%27%3D%271"
   curl -s -o /dev/null -w '%{http_code} script タグの攻撃(止まったまま)\n' "$A%3Cscript%3Ealert(1)%3C%2Fscript%3E"
   curl -s -o /dev/null -w '%{http_code} ノート on /search 画面(例外を書いていない)\n' "http://www.lab.localhost:18080/search?q=%E3%83%8E%E3%83%BC%E3%83%88%20(A5)"
   ```

   ```powershell [PowerShell]
   $f = "$PWD/cdn-waf/modsecurity/lab-exclusions-before.conf"
   Copy-Item $f "$env:TEMP/excl.bak"
   $rule = @'

   # 演習: 商品検索の query だけ、日本語・記号で誤遮断したルールを外す(狭い例外)
   SecRule REQUEST_URI "@beginsWith /occ/v2/samplestore/products/search" \
       "id:1002,phase:1,pass,nolog,\
       ctl:ruleRemoveTargetById=920272;ARGS:query,\
       ctl:ruleRemoveTargetById=920272;REQUEST_URI_RAW,\
       ctl:ruleRemoveTargetById=920273;ARGS:query,\
       ctl:ruleRemoveTargetById=920273;REQUEST_URI_RAW,\
       ctl:ruleRemoveTargetById=942460;ARGS:query,\
       ctl:ruleRemoveTargetById=942432;ARGS:query"
   '@
   [IO.File]::WriteAllText($f, [IO.File]::ReadAllText($f) + $rule.Replace("`r`n", "`n") + "`n")
   $env:BLOCKING_PARANOIA = '3'; docker compose up -d --force-recreate cdn-waf *> $null; Start-Sleep 3
   "$(curl.exe -s -o NUL -w '%{http_code}' "${A}%E3%83%8E%E3%83%BC%E3%83%88%20(A5)") ノート (A5) 検索 API"
   "$(curl.exe -s -o NUL -w '%{http_code}' "${A}%27%20OR%20%271%27%3D%271") 常に真の攻撃(止まったまま)"
   "$(curl.exe -s -o NUL -w '%{http_code}' "${A}%3Cscript%3Ealert(1)%3C%2Fscript%3E") script タグの攻撃(止まったまま)"
   "$(curl.exe -s -o NUL -w '%{http_code}' "http://www.lab.localhost:18080/search?q=%E3%83%8E%E3%83%BC%E3%83%88%20(A5)") ノート on /search 画面(例外を書いていない)"
   ```

   :::

   ::: tip PowerShell
   - ファイルへの追記に `>>` や `Set-Content` を使うと、改行が CRLF に変わったり文字コードが変わったりして、cdn-waf が例外ファイルを読めなくなることがあります。そのため `[IO.File]::WriteAllText`(UTF-8・LF のまま)で書いています。
   - 日本語の文字は、`curl.exe -w` の中ではなく PowerShell の文字列の側に置いています(Windows の curl.exe に日本語の引数を渡すと、文字コードの都合で化けることがあるためです)。
   :::

## 4. 何が見えたら成功か

**手順 1**: 普通の検索だけ 200、攻撃の見本は全部 403。

```text
--- api(OCC の商品検索 query)
200  普通の検索(通るべき)
403  SQL インジェクション: 常に真
403  SQL インジェクション: UNION
403  SQL インジェクション: コメント
403  XSS: script タグ
403  パスの巡回(../)
--- storefront(画面の検索 q)
200  普通の検索(通るべき)
403  SQL インジェクション: 常に真
403  XSS: img onerror
```

(実際の表示では、各行の下に送った URL も出ます。)

**手順 3(WAF なし)**: 普通に検索すると、検索語に合う商品だけが返ります。ところが `' OR '1'='1` を入れると、**検索語に関係なく全 30 件が返ります**。検索の意味そのものが書き換わった証拠です。ログには、検索語がそのまま SQL に連結されたことが残ります。

```text
返った件数: 30 (= 全 30 件。検索語で件数が変わっていない = SQL の意味が書き換わった)
危ない SQL: … WHERE p.name ILIKE '%' OR '1'='1%' ORDER BY p.code LIMIT 20 OFFSET 0 …
```

これは「検索の条件がすり抜けた」だけの、無害な確かめです。同じ穴を使えば、本来見えないはずのデータまで引き出せてしまう、という所までが SQL インジェクションの怖さです(この演習では、そこまではしません)。

**手順 4(WAF あり)**: 403。SQL インジェクションの形を見つけたルール(942100)と、合計点が上限を超えたことを表すルール(949110)が並びます。

```text
403
   1 "ruleId":"942100"      ← SQL Injection Attack Detected
   1 "ruleId":"949110"      ← Inbound Anomaly Score Exceeded
```

WAF は穴を「ふさいで」はいません。**穴はアプリにあり、直すのはアプリ(値を SQL に連結せず、置き場所 `$1` で渡す)** です。WAF は、直すまでの間と、見落とした穴のための 2 枚目の壁です。

**手順 5**: 疑い深さを上げるほど、日本語や記号の入った普通の検索が止められます(実測)。

| 入力 | PL=1 | PL=3 | PL=4 |
| --- | --- | --- | --- |
| ノート (A5) | 200 | **403** | **403** |
| 50% off | 200 | **403** | **403** |
| O'Reilly | 200 | 200 | **403** |
| select pen | 200 | 200 | **403** |

疑い深さ 3 で、日本語や `( )` を含む普通の検索が止まり始めます。「厳しくすればするほど安全」ではなく、**誤遮断とのつり合い** で決める値です。

**手順 6**: 「ノート (A5)」を止めた理由。日本語の文字(ASCII 以外)そのものが「おかしな文字」とみなされ、記号の多さも足されて、合計が上限を超えています。

```text
920272 | Invalid character in request (outside of printable chars bel
942460 | Meta-Character Anomaly Detection Alert - Repetitive Non-Word
949110 | Inbound Anomaly Score Exceeded (Total Score: 13)
```

疑い深さを 4 にすると、さらに 920273(もっと厳しい文字の決まり)と 942432(SQL で使う記号の多さ)も加わり、合計は 21 点になります。手順 7 の例外に 4 つのルールを書いているのは、疑い深さ 4 でも誤遮断しないようにするためです。

**手順 7**: 狭い例外を入れると、検索 API の日本語・記号は通り、攻撃は止まったまま。例外を書いていない画面の検索(`/search`)は、まだ止まります。**例外が狭く効いている** 証拠です。

```text
200 ノート (A5) 検索 API
403 常に真の攻撃(止まったまま)
403 script タグの攻撃(止まったまま)
403 ノート on /search 画面(例外を書いていない)
```

## 5. ここで覚える言葉

| 言葉 | 一言でいうと | たとえ | この演習で見たもの |
| --- | --- | --- | --- |
| [WAF](/guide/glossary#waf) | 入口で怪しい入力を止める壁 | 空港の保安検査 | 攻撃が 403、普通の検索は 200 |
| [ModSecurity](/guide/glossary#modsecurity) / [OWASP CRS](/guide/glossary#owasp-crs) | WAF の本体 / 攻撃の形を集めたルール集 | 検査員 / 危険物リスト | ルール番号 942100 など |
| [異常スコア](/guide/glossary#anomaly-score) | 怪しさの合計点。閾値を超えたら止める | 危険物の合計ポイント | Total Score が 5 以上で 403 |
| [パラノイアレベル](/guide/glossary#paranoia-level) | 検査の疑い深さ(1〜4) | 検査の厳しさの段階 | 3 で日本語検索が止まる |
| [誤遮断](/guide/glossary#false-positive) | 攻撃でない物を止めてしまうこと | 爪切りを没収される | ノート (A5) が 403 |
| 狭い例外 | 特定の URL・項目・ルールだけ検査を外す | 「この種類の荷物のこの点だけ見ない」 | 検索 API だけ通し、画面は止めたまま |
| [SQL インジェクション](/guide/glossary#sql-injection) | 入力で SQL の意味を書き換える攻撃 | 注文票に細工して意味を変える | `' OR '1'='1` で全件返る |

## 6. 設計書ではここに書く

- **[セキュリティ方式 4.1 WAF](/design/architecture/10-security#s4-1)・[4.2 誤遮断の直し方](/design/architecture/10-security#s4-2)**: 遮断モードにするか、疑い深さと閾値、誤遮断を狭く直す書き方。
- **[D-SEC-01 4.1 WAF の設定値](/design/detail/D-SEC-01-waf-and-rate-limit#s4-1)・[4.2 例外の書き方](/design/detail/D-SEC-01-waf-and-rate-limit#s4-2)**: `BLOCKING_PARANOIA`・`ANOMALY_INBOUND` の値、例外ルールの ID の付け方と対象の絞り方。
- **[BE 方式 4.4 SQL の書き方](/design/architecture/02-backend#s4-4)**: 値を SQL に連結せず、置き場所(プレースホルダ)で渡す。WAF はアプリの穴の代わりにはならない。

## 7. レビューで聞く質問

- 「WAF は記録だけですか、遮断しますか。SQL インジェクションや XSS の典型は、実際に 403 になりますか。」
- 「疑い深さ(パラノイアレベル)と閾値は、いくつですか。誤遮断はどれくらい出ますか。」
- 「日本語や記号の入った普通の入力(商品名・住所)で、誤って止まらないか確かめましたか。」
- 「誤遮断を直すとき、WAF を切るのではなく、狭い例外で直す運用になっていますか。」
- 「WAF があることを理由に、アプリの穴(SQL の連結など)を放置していませんか。」

## 8. 片付け

例外ファイルと疑い深さを元に戻します。

::: code-group

```bash [Mac / Linux / WSL]
cp /tmp/excl.bak cdn-waf/modsecurity/lab-exclusions-before.conf && rm /tmp/excl.bak
docker compose up -d --force-recreate cdn-waf        # BLOCKING_PARANOIA を付けずに起動 = 既定の 1
docker compose ps cdn-waf                            # (healthy) を待つ
docker compose exec -T cdn-waf printenv BLOCKING_PARANOIA   # 1 ならよい
tools/chaos.sh status                                # sqliBug が false ならよい
```

```powershell [PowerShell]
Copy-Item "$env:TEMP/excl.bak" cdn-waf/modsecurity/lab-exclusions-before.conf; Remove-Item "$env:TEMP/excl.bak"
Remove-Item Env:BLOCKING_PARANOIA -ErrorAction SilentlyContinue   # 手順 5〜7 で入れた環境変数を消す
docker compose up -d --force-recreate cdn-waf        # BLOCKING_PARANOIA を付けずに起動 = 既定の 1
docker compose ps cdn-waf                            # (healthy) を待つ
docker compose exec -T cdn-waf printenv BLOCKING_PARANOIA   # 1 ならよい
tools/chaos.ps1 status                               # sqliBug が false ならよい
```

:::
