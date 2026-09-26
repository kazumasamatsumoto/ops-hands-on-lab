---
title: SRE-1 SLI を測って SLO と比べる
---

# SRE-1 SLI を測って SLO と比べる

::: info この演習について
- 所要時間: 約 20 分
- 使うもの: 軽量版(docker compose)。`curl`、`tools/chaos.sh`、`tools/k6.sh`、Prometheus(http://localhost:19090)、Grafana(http://localhost:13000)
- 仕組みはこちら: [仕組み-11 観測(指標・ログ・トレース)](/how-it-works/11-observability)
- 関係する設計書: [SRE 方式](/design/architecture/05-sre)・[D-SRE-02 SLO とバーンレートのアラート](/design/detail/D-SRE-02-slo-burn-rate)
- 用語集: [SLI](/guide/glossary#sli)・[SLO](/guide/glossary#slo)・[エラーバジェット](/guide/glossary#error-budget)・[p95](/guide/glossary#p95)・[記録ルール](/guide/glossary#recording-rule)・[ヒストグラム](/guide/glossary#histogram)
:::

## 1. この設計書はなぜ必要か

「ちゃんと動いているか」を、感覚ではなく **数字** で決めておかないと、直すべきか・我慢してよいかの判断が人によってばらつきます。

> **よくある事故**: 「なんとなく重い」という報告が続きましたが、目標の数字が無いので「気のせいでは」で流していました。
> 実は成功率が 98% まで落ちていて、100 人に 2 人が買えずに帰っていました。半年分の売り上げを失ってから、初めて数字を測り始めました。

「何を測るか(SLI)」「いくつを目標にするか(SLO)」「その計算式」を、SRE の方式設計書で決めます。

## 2. 何をやっているのか

サンプルストアは、api と storefront の 2 つに **SLO(サービスの目標)** を持っています。測る数字(SLI)は 2 つです。

- **成功率** = 5xx でない返事 ÷ 全部の返事(見守り用の URL は除く)
- **p95 応答時間** = 速い順に並べたとき、95% の所にいる人の待ち時間(100 人なら速い方から 95 番目)

Prometheus が 5 秒ごとに `/metrics` を集め、**記録ルール**(あらかじめ書いた計算式)で SLI を作ります。目標は「月 99.9%」です。
演習では、①api に少しエラーを混ぜて、②生の数を見て、③手で成功率と p95 を計算し、④記録ルールの答えと突き合わせます。

たとえ: **健康診断** です。SLI は「体温」や「血圧」といった測る項目、SLO は「この範囲なら健康」という基準値です。
測っていなければ、具合が悪くなってから気づきます。基準値が無ければ、数字を見ても良い悪いが分かりません。

::: tip CCv2 では
CCv2 の案件では、指標は Dynatrace(APM)で見ます。このラボの Prometheus + Grafana は、その代わりです。「成功率 99.9%」のような目標は、
どの監視ツールを使っても同じ考え方で決めます。「見守り用の URL(ヘルスチェックなど)は SLI から除く」のも共通です。
:::

## 3. まず触ってみる

1. **数え直しやすくするため、api を再起動して数を 0 にする**(数え札は api のメモリの中にあるので、再起動で 0 に戻ります)。

   ```bash
   docker compose restart api
   docker compose ps api        # (healthy) を待つ
   ```

   直前に別の演習で遅延やエラーを入れていたら(たとえば [ネットワーク-1](./07-nw-cache) の手順 6)、5 分ほど空けてから進めてください(記録ルールは「直近 5 分」を見るためです)。
   空けずに進めると、再起動の前の遅い記録も「直近 5 分」に入り、手順 5 の p95 が 0.4 秒のように大きくずれます。

2. **api に 2% のエラーを混ぜ、1 分間お客様のまねをする**。cdn-waf のキャッシュに吸収されないよう、ここでは api に直接かけます(`API_URL=http://api:3001`)。

   ```bash
   tools/chaos.sh set errorRate=0.02
   API_URL=http://api:3001 tools/k6.sh browse.js -e VUS=10 -e DURATION=1m -e PAGES=0
   ```

   k6 の最後に出る `http_req_failed`(失敗の割合)と `p(95)` を控えておきます。

3. **Prometheus で「生の数」を見る**。http://localhost:19090 の「Query」に次を貼って「Execute」します(`curl` で聞いても同じです)。

   ```text
   sum by (status) (http_requests_total{job="api",route!~"/metrics|/healthz|/readyz|/admin/.*|unmatched"})
   ```

   ```text
   sum by (le) (http_request_duration_seconds_bucket{job="api",route!~"/metrics|/healthz|/readyz|/admin/.*|unmatched"})
   ```

   `route!~...` は、「見守り用の URL(`/metrics` など)は数えない」という意味です。お客様の体験と関係ないからです。

4. **手で計算する**(下の「何が見えたら成功か」に計算のしかたがあります)。

5. **記録ルールの答えと比べる**。

   ```text
   job:sli_success:ratio_rate5m{job="api"}
   job:http_request_duration_seconds:p95_rate5m{job="api"}
   job:slo_error_budget_remaining:ratio30d{job="api"}
   ```

6. **Grafana で見る**。http://localhost:13000 を開くと、ホームが「サンプルストア SLO」です。いちばん上の 4 つの枠(成功率・p95・エラーバジェットの残り・バーンレート)には、それぞれ `api` と `storefront` の 2 つの数字が名前付きで並びます。この演習では `api` の方を見ます(この演習の手順では storefront にお客様が来ないので、`storefront` の成功率と p95 は数字が出ず、名前だけの枠になることがあります)。

## 4. 何が見えたら成功か

**手順 2**: k6 から見て、462 回中 5 回が失敗(1.08%)、p95 は 5.72ms。k6 の合格条件(失敗 1% 未満)を超えたので、k6 自身も「基準を超えた」と言っています。

```text
http_req_duration..............: avg=4.39ms min=637.58µs med=3.95ms max=40.17ms p(90)=5.33ms p(95)=5.72ms
http_req_failed................: 1.08%  5 out of 462
http_reqs......................: 462    7.198792/s
```

**手順 3**: Prometheus の生の数(実測)。500 は「ルートに届く前に返した」ので `.../*` としてまとめて数えます(この扱いは記録ルールの `route!~` に合わせてあります)。

```text
{status="200"}  457
{status="500"}    5

{le="0.005"}  443      ← 0.005 秒(5ms)以内に終わった件数
{le="0.01"}   454      ← 10ms 以内
{le="0.025"}  455
{le="0.05"}   462      ← 全部
```

**手順 4: 手で計算する**

- **成功率** = 5xx 以外 ÷ 全体 = 457 ÷ (457 + 5) = **0.9892(98.92%)**
- **SLO と比べる**: 目標 99.9% に対して 98.92%。失敗の割合は 1.08% で、許される 0.1% の **約 11 倍**。
- **p95**: 全体 462 件の 95% は 438.9 件目。5ms 以内に 443 件が入っているので、p95 は 0〜5ms の間。
  Prometheus はこの箱の中を「均等に並んでいる」とみなして、5ms × 438.9 ÷ 443 ≈ **4.9ms** と見積もります。

**手順 5**: 記録ルールの答え(実測)。手計算の p95(約 4.9ms)とほぼ一致します。

```text
job:sli_success:ratio_rate5m{job="api"}                  0.9906
job:http_request_duration_seconds:p95_rate5m{job="api"}  0.004888     ← 手計算の 4.9ms と一致
job:slo_error_budget_remaining:ratio30d{job="api"}       -8.37
```

成功率が手計算(98.92%)より少し良く出るのは、記録ルールが「直近 5 分を 1 秒あたりに直して」計算するためです(短い時間だと少しずれます)。長い時間で見ればそろいます。
エラーバジェットの残り −8.37 は、「1 か月で失敗してよい量(0.1%)の、約 9.4 倍をもう使った」という意味です。

**手順 6**: Grafana の上の 4 つの枠の `api` の数字で、「速さは合格、成功率は不合格」とひと目で分かれば成功です。成功率と、エラーバジェットの残りが赤く出ます。

::: tip storefront にも SLO がある
同じことは storefront にもできます。`API_URL=http://api:3001 WWW_URL=http://storefront:4000 tools/k6.sh browse.js -e VUS=5 -e DURATION=1m` を、api に 2% のエラーを入れたまま流すと、
storefront 自身の成功率は高い(SSR は続けられる)のに、`ssr_api_call` のログに「api への呼び出しが 500 だった」が並びます。api の失敗が、storefront から見た体験にどう出るかが分かります。
:::

## 5. ここで覚える言葉

| 言葉 | 一言でいうと | たとえ | この演習で見たもの |
| --- | --- | --- | --- |
| [SLI](/guide/glossary#sli) | サービスの良し悪しを測る数字 | 体温・血圧 | 成功率・p95 |
| [SLO](/guide/glossary#slo) | SLI の目標値 | 「健康」の基準値 | 月 99.9% |
| [エラーバジェット](/guide/glossary#error-budget) | 目標に対して、あとどれだけ失敗してよいか | 今月あと何回まで休んでよいか | 残り −8.37(使い切って超過) |
| [p95](/guide/glossary#p95) | 速い順に並べて 95% の所にいる人の待ち時間 | 100 人中 95 番目に速い人の時間 | p95 ≈ 4.9ms |
| [記録ルール](/guide/glossary#recording-rule) | あらかじめ書いた計算式で、SLI を作る | 検査結果を自動で計算する式 | `job:sli_success:ratio_rate5m` |
| [ヒストグラム](/guide/glossary#histogram) | 「○秒以内が何件」を箱ごとに数えた物 | 時間帯ごとの来客数の棒グラフ | `..._bucket{le="0.005"}` |

## 6. 設計書ではここに書く

- **[SRE 方式 4.1 SLI: 何を測るか](/design/architecture/05-sre#s4-1)・[4.2 SLO と エラーバジェット](/design/architecture/05-sre#s4-2)**: 測る数字(成功率・p95)、SLO(月 99.9%)、除く URL、測る場所。
- **[D-SRE-02 4.1 記録ルール](/design/detail/D-SRE-02-slo-burn-rate#s4-1)・[4.3 計算式](/design/detail/D-SRE-02-slo-burn-rate#s4-3)**: 記録ルールの名前と式(成功率・p95・エラーバジェットの残り)。
- **[SRE 方式 4.6 ダッシュボード](/design/architecture/05-sre#s4-6)**: 何を並べて見せるか(成功率・p95・エラーバジェット・バーンレート)。

## 7. レビューで聞く質問

- 「このサービスの SLI は何ですか。成功率や応答時間を、どこで(お客様に近い所か、サーバーの中か)測っていますか。」
- 「SLO(目標)はいくつですか。その根拠は何ですか。除いている URL(ヘルスチェックなど)はどれですか。」
- 「成功率や p95 の計算式は、設計書に書いてありますか。人によって数字が変わりませんか。」
- 「エラーバジェットを使い切ったら、何をしますか(新機能を止めて安定に振る、など)。」
- 「api と storefront で、SLI・SLO は別々に持っていますか。」

## 8. 片付け

```bash
tools/chaos.sh reset          # errorRate を 0 に戻す
```

アラート(前の手順でエラーを入れたことによる)が鳴っていれば、5 分ほどで自然に解決します。次の [SRE-2](./10-sre-burn-rate-alert) にそのまま進めます。
