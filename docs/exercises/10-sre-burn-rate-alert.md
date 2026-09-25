---
title: SRE-2 エラーバジェットとアラート
---

# SRE-2 エラーバジェットとアラート

::: info この演習について
- 所要時間: 約 20 分(アラートが鳴って、止むまで待つ時間を含む)
- 使うもの: 軽量版(docker compose)。k6、Prometheus(http://localhost:19090)、Alertmanager(http://localhost:19093)、pager(http://localhost:19094)
- 関係する設計書: [SRE 方式 4.3 アラート](/design/architecture/05-sre#s4-3)・[SRE 方式 4.5 通知の届け方](/design/architecture/05-sre#s4-5)・[D-SRE-02 SLO とバーンレートのアラート](/design/detail/D-SRE-02-slo-burn-rate)
:::

[SRE-1](./09-sre-sli-slo) で SLI と SLO を見たあとに進むと分かりやすいです。

## 1. この設計書はなぜ必要か

アラート(人を呼ぶ仕組み)は、**鳴らなさすぎても、鳴りすぎても** 役に立ちません。

> **よくある事故(鳴りすぎ)**: 「エラーが 1 件でも出たら担当者の携帯に電話」という設定にしました。
> 夜中に何度も電話が鳴りますが、ほとんどは 1 件だけの一時的なエラーで、朝には自然に直っていました。
> 3 か月後、担当者は通知を無視するようになり、本当に注文が全部失敗し始めた夜も、誰も起きませんでした(オオカミ少年)。
>
> **よくある事故(鳴らなさすぎ)**: 「エラー率が 5% を 30 分続いたら」という設定にしたところ、2% のエラーが 3 日続いても誰も気づかず、1 か月分の目標を大きく割り込みました。

「どれくらいの速さで目標(SLO)を食いつぶしているか」で鳴らせば、一時的なぶれでは鳴らさず、じわじわ続く悪化は見逃しません。これを SRE の方式設計書に書きます。

## 2. 何をやっているのか

SLO「1 か月の成功率 99.9%」なら、1 か月で失敗してよい量(**エラーバジェット**)は全体の 0.1% です。
**バーンレート** は「今のエラー率が、ちょうど 1 か月で予算を使い切る速さの何倍か」です(= その窓のエラー率 ÷ 0.001)。
サンプルストアのアラートルール(`observability/prometheus/rules/slo-alerts.yml`)は次のように鳴ります。

| アラート | 条件 | 意味 | 通知 |
| --- | --- | --- | --- |
| `ErrorBudgetBurnPage`(緊急) | 5 分窓 と 1 時間窓 の両方でバーンレート > 14.4 が 1 分続く | 1 時間で 1 か月分の予算の 2% を使う速さ。このままだと約 2 日で使い切る | 今すぐ人を起こす |
| `ErrorBudgetBurnTicket`(警告) | 30 分窓 と 6 時間窓 の両方で > 6 が 5 分続く | 6 時間で 5% を使う速さ | 営業時間内に対応 |
| `ErrorBudgetBurnDemo`(デモ用) | 1 分窓 と 5 分窓 で > 14.4 | 演習ですぐ鳴る様子を見るためだけの物 | 本番では使わない |

鳴ったアラートは Alertmanager がまとめ、ラボの中の通知の受け口 pager に送ります(外には何も送りません)。

たとえ: **バーンレートは「お小遣いの減る速さ」** です。1 か月 3,000 円のお小遣いで、今日 1 日に 1,000 円使ったら「このままだと 3 日でなくなる」と分かります(バーンレート 10)。
「1 回 100 円使ったら親に連絡」ではうるさすぎ、「月末に残高を見る」では遅すぎます。**減る速さで知らせる** のがちょうどよいのです。
2 つの窓を両方見るのは、「さっきまで使いすぎていた」だけで今は止まっているなら、もう知らせなくてよいからです。

## 3. まず触ってみる

1. **前の演習のアラートが残っていないか確かめる**。Prometheus の http://localhost:19090/alerts がすべて緑(Inactive)ならそのまま進めます。
   赤や黄色が残っているときは、次のコマンドで指標と通知の記録をまっさらにしてから始めます(Alertmanager は同じ通知を 1 時間は送り直さないため、残っていると pager に何も届きません)。

   ```bash
   docker compose rm -sf prometheus alertmanager pager
   docker volume rm lab_prometheus-data
   docker compose up -d prometheus alertmanager pager
   ```

2. **api の半分を 500 にして、お客様のまねを 3 分走らせる**。

   ```bash
   tools/chaos.sh set errorRate=0.5
   tools/k6.sh browse.js -e DURATION=3m -e PAGES=0
   ```

3. **k6 を走らせている間に、別のターミナルでアラートの状態を見る**。http://localhost:19090/alerts を開いて 10 秒ごとに再読み込みするか、次のコマンドで 5 秒ごとに表示します(Ctrl+C で止める)。

   ```bash
   while true; do
     printf '%s ' "$(date +%H:%M:%S)"
     curl -s http://localhost:19090/api/v1/alerts | python3 -c 'import json,sys;print(" ".join(sorted(a["labels"]["alertname"]+"="+a["state"] for a in json.load(sys.stdin)["data"]["alerts"])))'
     sleep 5
   done
   ```

4. **バーンレートの値を見る**。Prometheus の「Query」で次を実行します。

   ```text
   job:http_errors:ratio_rate5m{job="api"}
   job:slo_burn_rate:1m{job="api"}
   job:slo_burn_rate:5m{job="api"}
   job:slo_burn_rate:1h{job="api"}
   ```

5. **pager を開く**。http://localhost:19094 に通知が届きます。Alertmanager(http://localhost:19093)でも、今鳴っているアラートが見えます。

6. **スイッチを戻して、アラートが止むのを見る**(k6 はそのまま走らせておいてかまいません)。

   ```bash
   tools/chaos.sh reset
   ```

   1 分窓はすぐ 0 に戻り、5 分窓は 5 分かけて下がります。pager に「解決(resolved)」の通知が届くのを待ちます。

## 4. 何が見えたら成功か

**手順 3**: 壊してから約 15 秒でデモ用が鳴り、約 75 秒で緊急(Page)が鳴ります(下の記録は、時刻の代わりに「壊してからの秒数」と、どのサービス(api)かも出るようにして取った物です)。

```text
+  5s
+ 15s ErrorBudgetBurnDemo(api)=firing ErrorBudgetBurnPage(api)=pending ErrorBudgetBurnTicket(api)=pending
...
+ 71s ErrorBudgetBurnDemo(api)=firing ErrorBudgetBurnPage(api)=pending ErrorBudgetBurnTicket(api)=pending
+ 76s ErrorBudgetBurnDemo(api)=firing ErrorBudgetBurnPage(api)=firing ErrorBudgetBurnTicket(api)=pending
```

`pending` は「条件は満たしたが、決めた時間(Page は 1 分)続くのを待っている」状態です。一瞬のぶれでは鳴らさないための待ち時間です。

**手順 4**: api のエラー率は約 49%、バーンレートは約 490。「1 か月の予算を約 1.5 時間で使い切る」速さです(30 日 × 24 時間 ÷ 490)。

```text
job:http_errors:ratio_rate5m{job="api"}  0.486
job:slo_burn_rate:1m{job="api"}          525.4
job:slo_burn_rate:5m{job="api"}          489.4
job:slo_burn_rate:1h{job="api"}          489.4
```

一方、edge を通したお客様(k6)から見た失敗は 13.97% でした。商品 API の成功した答えが edge にためられ(キャッシュ)、失敗の一部を隠してくれたためです。**どこで測るか** で数字が変わることも覚えておきましょう。

```text
http_req_failed................: 13.97% 83 out of 594
```

**手順 5〜6**: pager に届いた通知(時刻は世界標準時)。

```text
15:23:12 firing   ErrorBudgetBurnDemo  demo    【デモ用】api: バーンレートが 14.4 を超えました(1 分窓と 5 分窓)
15:24:12 firing   ErrorBudgetBurnPage  page    api: エラーバジェットを急速に消費しています(緊急)
15:26:12 resolved ErrorBudgetBurnDemo  demo
15:30:12 resolved ErrorBudgetBurnPage  page
15:30:12 firing   ErrorBudgetBurnTicket ticket
```

**手順 6 の止み方**: 戻してから 1 分窓は約 1 分で 0 に、5 分窓は約 5 分かけて下がり、5 分窓が 14.4 を下回った時点で緊急が解決しました。
1 時間窓はまだ高いままですが、「今はもう起きていない」ので鳴らし続けません。これが 2 つの窓の効き目です。

```text
+ 64s 1m=0.0 5m=471.6 ErrorBudgetBurnPage=firing ErrorBudgetBurnTicket=pending
...
+299s 1m=nan 5m=93.0  ErrorBudgetBurnPage=firing ErrorBudgetBurnTicket=firing
+307s 1m=nan 5m=0.0   ErrorBudgetBurnTicket=firing
```

(`nan` は「その窓にリクエストが 1 件も無いので、割り算ができない」という意味です。k6 が終わったあとに出ます。)

警告(Ticket)は、緊急が鳴っている間は Alertmanager が **黙らせて** いて(抑制)、緊急が解決したところで届きました。
同じ問題で通知が 2 重に鳴らないための工夫です。Ticket は 30 分窓を見ているので、しばらく鳴り続けます。

## 5. ここで覚える言葉

| 言葉 | 一言でいうと | たとえ | この演習で見たもの |
| --- | --- | --- | --- |
| エラーバジェット | SLO の範囲で失敗してよい量 | 1 か月のお小遣い | 99.9% → 0.1% |
| バーンレート | 予算を使う速さ(ちょうど 1 か月で使い切る速さの何倍か) | お小遣いの減る速さ | `job:slo_burn_rate:5m` = 489.4 |
| 窓 | どれだけの時間をまとめて見るか | 家計簿を 1 日単位で見るか 1 週間単位で見るか | 1 分・5 分・1 時間 |
| マルチウィンドウ | 長い窓と短い窓の両方が悪いときだけ鳴らす | 「今週使いすぎ」かつ「今日も使っている」なら注意 | 5 分窓が下がると Page が解決 |
| page と ticket | 今すぐ人を起こす通知と、営業時間内に見ればよい通知 | 火事の非常ベルと、回覧板 | `severity: page` / `ticket` |
| pending / firing / resolved | 様子見中 / 鳴っている / 直った | 煙を感知 → ベルが鳴る → 鎮火の知らせ | Page が 71 秒で pending、76 秒で firing |
| 抑制(inhibit) | 大きい通知が鳴っている間、同じ原因の小さい通知を黙らせる | 非常ベル中は回覧板を回さない | Ticket が suppressed、Page 解決後に届いた |
| Alertmanager | アラートをまとめ、重複を除いて届ける係 | 電話の取り次ぎ係 | http://localhost:19093 |

## 6. 設計書ではここに書く

- **[SRE 方式 4.3 アラート](/design/architecture/05-sre#s4-3)**: 「アラートはバーンレートで鳴らす。緊急 = 5 分窓と 1 時間窓で 14.4 超、警告 = 30 分窓と 6 時間窓で 6 超」と、**数字の出し方(14.4 = 2% × 720 時間 ÷ 1 時間)** まで書きます。
  「CPU 使用率など、お客様の体験に直結しない物では人を起こさない」とも書きます。
- **[SRE 方式 4.5 通知の届け方](/design/architecture/05-sre#s4-5)**: page はどこに(当番の携帯など)、ticket はどこに(チケット管理)、誰が当番か、抑制のルール。
- **[D-SRE-02 SLO とバーンレートのアラート](/design/detail/D-SRE-02-slo-burn-rate)**(一般のカタログでは D-SRE-02): アラートルールの式、`for`(待ち時間)、ラベル、通知文の中身、そして **鳴ったら最初に見る場所**(ダッシュボードの URL、手順書)。
- **[障害対応方式 4.3 気づき方と一次対応](/design/architecture/08-incident-response#s4-3)**: page を受けた人が 15 分以内にすること。

## 7. レビューで聞く質問

- 「このアラートが鳴ったとき、お客様は実際に困っていますか。困っていないのに人を起こすことはありませんか。」
- 「アラートの数字(14.4 など)はどこから来ましたか。SLO から計算した式が書いてありますか。」
- 「一時的なぶれで鳴らないための工夫(窓を 2 つ、待ち時間)はありますか。」
- 「鳴ったら誰に届きますか。その人は、届いたあと最初に何を見ればよいか分かりますか。」
- 「この 1 か月で、何回鳴って、そのうち何回が本当に対応の要るものでしたか。」
- 「直ったとき(resolved)も知らせますか。同じ原因で通知が何重にも届かない仕組みはありますか。」

## 8. 片付け

```bash
tools/chaos.sh reset          # errorRate を 0 に戻す(手順 6 で済んでいれば不要)
```

警告(Ticket)は 30 分窓を見ているので、30 分ほど鳴り続けてから自然に解決します。すぐに消したいときは、手順 1 のコマンドで Prometheus・Alertmanager・pager をまっさらにします。
