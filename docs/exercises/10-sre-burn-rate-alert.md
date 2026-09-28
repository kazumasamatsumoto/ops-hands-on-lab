---
title: SRE-2 エラーバジェットとアラート
---

# SRE-2 エラーバジェットとアラート

::: info この演習について
- 所要時間: 約 20 分
- 使うもの: 軽量版(docker compose)。`tools/chaos.sh`、`tools/k6.sh`、Prometheus(http://localhost:19090)、Alertmanager(http://localhost:19093)、pager(http://localhost:19094)
- 仕組みはこちら: [仕組み-11 観測(指標・ログ・トレース)](/how-it-works/11-observability)
- 関係する設計書: [SRE 方式](/design/architecture/05-sre)・[D-SRE-02 SLO とバーンレートのアラート](/design/detail/D-SRE-02-slo-burn-rate)
- 用語集: [バーンレート](/guide/glossary#burn-rate)・[マルチウィンドウ](/guide/glossary#multi-window)・[Alertmanager](/guide/glossary#alertmanager)・[pager](/guide/glossary#pager)・[抑止(inhibit)](/guide/glossary#inhibit)
:::

## 1. この設計書はなぜ必要か

失敗が起きたとき、**いつ・誰を起こすか** を決めておかないと、夜中に些細なことで人を叩き起こしたり、逆に本当の大事故を見逃したりします。

> **よくある事故**: 「エラーが 1 件でも出たら通知」にしていたら、通知が鳴りすぎて誰も見なくなりました(オオカミ少年)。
> ある日、本当にお店が半分落ちましたが、いつもの通知に埋もれて 3 時間気づかれませんでした。

「どれくらいの速さで失敗しているか(バーンレート)」で通知の重さを変える、という決め方を SRE の方式設計書に書きます。

## 2. 何をやっているのか

**バーンレート**は、「エラーバジェット(1 か月で失敗してよい量)を、今の速さだと何倍の速さで使っているか」です。1.0 なら「ちょうど 1 か月で使い切る速さ」、10 なら「3 日で使い切る速さ」です。
サンプルストアは、**短い窓と長い窓を組み合わせて** アラートを鳴らします(マルチウィンドウ。緊急は 5 分と 1 時間、警告は 30 分と 6 時間、デモ用は 1 分と 5 分)。

- **緊急(Page)**: 速く大きく燃えている → すぐ人を起こす
- **警告(Ticket)**: ゆっくり燃えている → 翌営業日でよい
- **デモ用(Demo)**: 演習で短時間で鳴らすための、早く鳴るアラート

演習では、api の半分を 500 にして、緊急がどう鳴り、スイッチを戻すとどう止むかを見ます。

たとえ: **家計** です。今月の予算(エラーバジェット)を、月末までに使い切る速さで使っているかを見ます。
1 日で今月分を使うような激しい浪費(高いバーンレート)なら、すぐ家族会議(緊急)。じわじわ超えそうなら、来週相談(警告)。
短い窓(デモ用なら 1 分窓)は最近の勢い、長い窓(1 時間窓など)は「たまたまではなく続いているか」を見ています。

::: tip CCv2 では
バーンレートのアラートは、監視ツール(Dynatrace)でも同じ考え方で組めます。「短い窓と長い窓を両方満たしたときだけ鳴らす」ことで、一瞬のぶれで人を起こさず、
本物の事故は見逃さない、という設計です。通知先(このラボの pager)は、実案件では当番の呼び出し(オンコール)やチケットになります。
:::

## 3. まず触ってみる

1. **前の演習のアラートや指標が残っていないか、まっさらにする**(Alertmanager は同じ通知を 1 時間は送り直さないため、残っていると pager に何も届きません)。

   ::: code-group

   ```bash [Mac / Linux / WSL]
   docker compose rm -sf prometheus alertmanager pager
   docker volume rm lab_prometheus-data
   docker compose up -d prometheus alertmanager pager
   ```

   ```powershell [PowerShell]
   docker compose rm -sf prometheus alertmanager pager
   docker volume rm lab_prometheus-data
   docker compose up -d prometheus alertmanager pager
   ```

   :::

2. **api の半分を 500 にして、お客様のまねを 3 分走らせる**。

   ::: code-group

   ```bash [Mac / Linux / WSL]
   tools/chaos.sh set errorRate=0.5
   tools/k6.sh browse.js -e DURATION=3m -e PAGES=0
   ```

   ```powershell [PowerShell]
   tools/chaos.ps1 set errorRate=0.5
   tools/k6.ps1 browse.js -e DURATION=3m -e PAGES=0
   ```

   :::

3. **k6 を走らせている間に、別のターミナルでアラートの状態を見る**。http://localhost:19090/alerts を開いて再読み込みするか、次のコマンドで 10 秒ごとに表示します(Ctrl+C で止める)。

   ::: code-group

   ```bash [Mac / Linux / WSL]
   while true; do
     printf '%s ' "$(date +%H:%M:%S)"
     curl -s http://localhost:19090/api/v1/alerts | python3 -c 'import json,sys;print(" ".join(sorted(a["labels"]["alertname"]+"="+a["state"] for a in json.load(sys.stdin)["data"]["alerts"] if a["labels"]["alertname"].startswith("Error"))))'
     sleep 10
   done
   ```

   ```powershell [PowerShell]
   while ($true) {
     $alerts = (curl.exe -s http://localhost:19090/api/v1/alerts | ConvertFrom-Json).data.alerts
     $names = $alerts | Where-Object { $_.labels.alertname.StartsWith('Error') } | ForEach-Object { "$($_.labels.alertname)=$($_.state)" } | Sort-Object
     "$(Get-Date -Format HH:mm:ss) $($names -join ' ')"
     Start-Sleep 10
   }
   ```

   :::

4. **バーンレートの値を見る**。Prometheus の「Query」で次を実行します。

   ```text
   job:http_errors:ratio_rate5m{job="api"}
   job:slo_burn_rate:1m{job="api"}
   job:slo_burn_rate:5m{job="api"}
   job:slo_burn_rate:1h{job="api"}
   ```

5. **pager を開く**。http://localhost:19094 に通知が届きます。Alertmanager(http://localhost:19093)でも、今鳴っているアラートが見えます。

6. **スイッチを戻して、アラートが止むのを見る**(k6 はそのまま走らせておいてかまいません)。

   ::: code-group

   ```bash [Mac / Linux / WSL]
   tools/chaos.sh reset
   ```

   ```powershell [PowerShell]
   tools/chaos.ps1 reset
   ```

   :::

   1 分窓はすぐ 0 に戻り、5 分窓は 5 分かけて下がります。pager に状態が「解消」(resolved)の通知が届くのを待ちます(届いたばかりの通知は「発生中」と表示されます)。

## 4. 何が見えたら成功か

**手順 3**: 壊してから約 30 秒でデモ用が鳴り、約 90 秒で緊急(Page)が鳴ります(実測)。`pending` は「条件は満たしたが、決めた時間続くのを待っている」状態です。一瞬のぶれで鳴らさないための待ち時間です。

```text
12:04:26                                   ← 壊した直後。まだ何も出ない
12:04:57 ErrorBudgetBurnDemo=firing ErrorBudgetBurnPage=pending ErrorBudgetBurnTicket=pending   ← 約 30 秒
12:05:27 ErrorBudgetBurnDemo=firing ErrorBudgetBurnPage=pending ErrorBudgetBurnTicket=pending
12:05:57 ErrorBudgetBurnDemo=firing ErrorBudgetBurnPage=firing ErrorBudgetBurnTicket=pending    ← 約 90 秒
```

(手順 1 の直後に打つと、Prometheus の起動が終わる前の数秒だけ `JSONDecodeError`(PowerShell では `ConvertFrom-Json` のエラー)が出ることがあります。10 秒後の次の行から正しく出ます。)

**手順 4**: api のエラー率は約 54%、バーンレートは約 540。「1 か月の予算を約 1.3 時間で使い切る」速さです(30 日 × 24 時間 ÷ 540 ≈ 1.3)。

```text
job:http_errors:ratio_rate5m{job="api"}  0.542
job:slo_burn_rate:1m{job="api"}          632.4
job:slo_burn_rate:5m{job="api"}          542.1
job:slo_burn_rate:1h{job="api"}          542.1
```

一方、cdn-waf を通したお客様(k6)から見た失敗は約 17% でした。商品の成功した答えが cdn-waf にためられ(キャッシュ)、失敗の一部を隠したためです。**どこで測るか** で数字が変わることも覚えておきましょう。

```text
http_req_failed................: 17.27% 114 out of 660
```

**手順 5**: pager に届いた通知(時刻は日本時間)。

```text
10:39:02 発生中 ErrorBudgetBurnDemo  api
10:40:02 発生中 ErrorBudgetBurnPage  api
```

**手順 6 の止み方**: 戻してから 1 分窓は約 1 分で 0(`nan`)に、5 分窓は約 5 分かけて下がり、5 分窓が基準を下回った時点で緊急が解決しました。
1 時間窓はまだ高いままですが、「今はもう起きていない」ので鳴らし続けません。これが 2 つの窓の効き目です。

```text
10:43:02 解消   ErrorBudgetBurnDemo  api
10:47:02 解消   ErrorBudgetBurnPage  api
10:47:07 発生中 ErrorBudgetBurnTicket api
```

(`nan` は「その窓にリクエストが 1 件も無いので割り算ができない」という意味です。k6 が終わったあとに出ます。)
警告(Ticket)は、緊急が鳴っている間は Alertmanager が **黙らせて**(抑制)いて、緊急が解決したところで届きました。
同じ問題で通知が 2 重に鳴らないための工夫です。Ticket は長い窓(30 分・6 時間)を見ているので、しばらく鳴り続けます。

## 5. ここで覚える言葉

| 言葉 | 一言でいうと | たとえ | この演習で見たもの |
| --- | --- | --- | --- |
| [バーンレート](/guide/glossary#burn-rate) | エラーバジェットを何倍の速さで使っているか | 予算の使い過ぎの速さ | 1h 窓で約 540 倍 |
| [マルチウィンドウ](/guide/glossary#multi-window) | 短い窓と長い窓を組み合わせて判定する | 「今の勢い」と「続いているか」を両方見る | 緊急は 5 分と 1 時間、警告は 30 分と 6 時間(デモ用は 1 分と 5 分) |
| 緊急(Page)と 警告(Ticket) | すぐ起こす通知 / 翌営業日でよい通知 | 救急車 / 予約診療 | Page はすぐ、Ticket は長い窓 |
| [Alertmanager](/guide/glossary#alertmanager) | アラートをまとめ、通知先に振り分ける係 | 火災報知器の集中管理盤 | 同じ通知を 1 時間は送り直さない |
| [pager](/guide/glossary#pager) | 通知を受け取って一覧に出す受け口 | 呼び出しの掲示板 | firing / resolved が並ぶ |
| [抑止(inhibit)](/guide/glossary#inhibit) | 上位の通知が鳴っている間、下位を黙らせる | 救急対応中は予約診療の呼び出しを止める | 緊急が解決してから Ticket が届く |

## 6. 設計書ではここに書く

- **[SRE 方式 4.3 アラート](/design/architecture/05-sre#s4-3)・[4.5 通知の届け方](/design/architecture/05-sre#s4-5)**: バーンレートのしきい値、窓の組み合わせ、緊急と警告の分け方、通知先。
- **[D-SRE-02 4.2 アラート](/design/detail/D-SRE-02-slo-burn-rate#s4-2)・[4.4 通知(Alertmanager)](/design/detail/D-SRE-02-slo-burn-rate#s4-4)**: アラートの名前・条件・for(待ち時間)・抑制の関係。
- **[障害対応方式](/design/architecture/08-incident-response)**: 緊急が鳴ったときに、誰が何分以内に動くか。

## 7. レビューで聞く質問

- 「緊急(すぐ起こす)と警告(翌営業日)の線は、どのバーンレートで引きますか。」
- 「一瞬のぶれで人を起こさない工夫(短い窓と長い窓の両方、for の待ち時間)は入っていますか。」
- 「同じ問題で通知が何重にも鳴らないようにしていますか(抑制)。」
- 「通知が鳴りすぎて誰も見なくなる状態を、どう防ぎますか。」
- 「エラーバジェットを使い切ったとき、開発を止めて安定に振る、といった取り決めはありますか。」

## 8. 片付け

::: code-group

```bash [Mac / Linux / WSL]
tools/chaos.sh reset
```

```powershell [PowerShell]
tools/chaos.ps1 reset
```

:::

Ticket(警告)は長い窓を見ているので、しばらく残ります。急いで消したいときは、手順 1 のまっさらにするコマンドをもう一度実行します。
