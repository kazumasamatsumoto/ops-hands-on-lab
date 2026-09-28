---
title: 性能-1 負荷試験で限界を見る
---

# 性能-1 負荷試験で限界を見る

::: info この演習について
- 所要時間: 約 20 分
- 使うもの: 軽量版(docker compose)。`tools/k6.sh`(PowerShell は `tools/k6.ps1`)、Prometheus(http://localhost:19090)、Grafana(http://localhost:13000)、`docker stats`
- 仕組みはこちら: [仕組み-1 cdn-waf(CDN と WAF)](/how-it-works/01-cdn-waf)・[仕組み-4 storefront の SSR](/how-it-works/04-storefront-ssr)
- 関係する設計書: [性能方式](/design/architecture/07-performance)・[D-PERF-05 負荷試験](/design/detail/D-PERF-05-load-test)
- 用語集: [負荷試験](/guide/glossary#load-test)・[k6](/guide/glossary#k6)・[VU](/guide/glossary#vu)・[ステップ負荷](/guide/glossary#step-load)・[スループット](/guide/glossary#throughput)・[閾値](/guide/glossary#threshold)
:::

## 1. この設計書はなぜ必要か

「たぶん耐えられる」で本番を迎えると、いちばん人が来る日にお店が落ちます。どこまで耐えるかは、測らないと分かりません。

> **よくある事故**: セールの初日、開始 10 分でお店が真っ白に。あとで調べると、平常時の 5 倍の人が来ただけでした。
> 「5 倍くらいなら大丈夫だろう」と誰かが言い、誰も測っていませんでした。限界がどこかを、事前に一度も見ていなかったのです。

「どれくらいの流量まで、どの数字(成功率・応答時間)を保てるか」を、性能の方式設計書で決め、負荷試験で確かめます。

## 2. 何をやっているのか

k6(負荷をかける道具)が「仮想の利用者(VU)」を何人も作り、同時にリクエストを送ります。`tools/k6/ramp.js` は人数を段階的に増やす試験(ステップ負荷)です。
この演習では 2 回試します。

1. **いつもの入口(cdn-waf)経由で**: cdn-waf には「同じ IP から 1 秒 20 回まで」のレート制限があるので、k6 1 台から強くかけると、アプリの前に入口で止まります(429)。
2. **入口を通さず storefront に直接**: 商品詳細の画面(サーバーで描画する = 重い処理)に、100 → 200 → 400 人と増やし、**件数が伸びなくなり、待ち時間が延び始める所(限界)** を探します。

たとえ: **ラーメン屋の行列** です。お客様(VU)を増やしていくと、最初は「来た分だけさばける」のに、ある所から厨房(サーバー)が追いつかず、さばける数は増えないのに待ち時間だけが延びます。そこが限界です。
なお、店の前の整理係(cdn-waf のレート制限)が「お 1 人様 1 秒に 20 回まで」と止めていると、厨房の限界を測る前に整理係で止まってしまいます。

::: tip CCv2 では
負荷試験は、ステージング(s1)環境で行うのが基本です。1 台の k6 は 1 つの IP なので、CDN のレート制限や WAF に先に当たります。
「アプリの限界を測るときは、入口を避けるか、試験のときだけ制限を緩める」工夫が要るのは、CCv2 でも同じです。どれを選んだかを試験の記録に書きます。
:::

## 3. まず触ってみる

1. **cdn-waf 経由で段階的に負荷をかける**(約 5 分かかります)。その間、Grafana の「サンプルストア SLO」を開いておきます。

   ::: code-group

   ```bash [Mac / Linux / WSL]
   tools/k6.sh ramp.js
   ```

   ```powershell [PowerShell]
   tools/k6.ps1 ramp.js
   ```

   :::

2. **結果を読む**。最後にまとめが出ます。`http_req_failed`(失敗の割合)と、合格の基準(`THRESHOLDS`)を見比べてください。

3. **レート制限を避けて、storefront(画面)の限界を見る**。cdn-waf を通さず、Docker のネットワークの中から storefront(`http://storefront:4000`)に直接かけます。
   人数は `--stage 時間:人数` で上書きできます(ここでは 30 秒ずつ 100 → 200 → 400 人)。3 分かかります。

   ::: code-group

   ```bash [Mac / Linux / WSL]
   WWW_URL=http://storefront:4000 tools/k6.sh ramp.js -e TARGET=page \
     --stage 30s:100 --stage 30s:100 --stage 30s:200 --stage 30s:200 --stage 30s:400 --stage 30s:400
   ```

   ```powershell [PowerShell]
   $env:WWW_URL = 'http://storefront:4000'
   tools/k6.ps1 ramp.js -e TARGET=page `
     --stage 30s:100 --stage 30s:100 --stage 30s:200 --stage 30s:200 --stage 30s:400 --stage 30s:400
   Remove-Item Env:WWW_URL     # 終わったら消す(消し忘れると、次の k6 も cdn-waf を通らなくなります)
   ```

   :::

   ::: tip PowerShell
   bash の `WWW_URL=… tools/k6.sh` は「その 1 回だけ」環境変数を渡しますが、PowerShell の `$env:WWW_URL = …` は **ターミナルを閉じるまで残ります**。使い終わったら `Remove-Item Env:WWW_URL` で消してください(以後の演習でも同じです)。
   :::

4. **走っている間、30 秒ごとに Prometheus で数字を見る**。http://localhost:19090 の「Query」で、次の 3 つを実行します(Graph の表示にすると推移が見えます)。

   ```text
   sum(rate(http_requests_total{job="storefront",route="/p/:code"}[30s]))
   histogram_quantile(0.95, sum by (le) (rate(http_request_duration_seconds_bucket{job="storefront",route="/p/:code"}[30s])))
   rate(process_cpu_seconds_total{job="storefront"}[30s])
   ```

   上から「1 秒あたりの件数」「p95 の待ち時間(秒)」「storefront が使った CPU(1.0 = CPU 1 個ぶん)」です。

5. **メモリも見る**。

   ::: code-group

   ```bash [Mac / Linux / WSL]
   docker stats --no-stream --format '{{.Name}} {{.CPUPerc}} {{.MemUsage}}' | grep lab-
   ```

   ```powershell [PowerShell]
   docker stats --no-stream --format '{{.Name}} {{.CPUPerc}} {{.MemUsage}}' | Select-String 'lab-'
   ```

   :::

## 4. 何が見えたら成功か

**手順 1〜2(cdn-waf 経由)**: 13,289 回のうち 8,391 回(63%)が 429(レート制限)。それなのに k6 の判定は **合格(✓)** です。
`ramp.js` の合格の基準が「p95 が 1 秒未満」だけで、失敗の割合を見ていないからです。**基準の決め方しだいで、ひどい結果でも合格になる** 良い見本です。

```text
  █ THRESHOLDS
    http_req_duration
    ✓ 'p(95)<1000' p(95)=13.17ms

  █ TOTAL RESULTS
    ...
    ✗ 200(成功)
      ↳  36% — ✓ 4898 / ✗ 8391
    ✗ 429 ではない(レート制限に当たっていない)
      ↳  36% — ✓ 4898 / ✗ 8391
    ✓ 5xx ではない
    ...
    http_req_failed................: 63.14% 8391 out of 13289
    http_reqs......................: 13289  44.277334/s
```

1 台の k6 は 1 つの IP なので、入口から見ると「1 人のお客様がものすごい速さで連打している」のと同じです。本物のお客様は何千もの別々の IP から来ます。
だから **アプリの限界を測るときは入口のレート制限を避ける**(奥に直接かける、試験のときだけ制限を緩める、k6 を何台にも分ける)工夫が要ります。どれを選んだかも試験の記録に書きます。

**手順 3〜4(storefront に直接)**: 30 秒ごとに見た数字(実測。この PC は Docker に CPU 10 個ぶん)。

| 経過 | 人数(VU) | 件数 / 秒 | p95 | storefront の CPU |
| --- | --- | --- | --- | --- |
| +30 秒 | 100 | 90 | 0.099 秒 | 1.16 |
| +62 秒 | 200 | 170 | 0.192 秒 | 1.57 |
| +95 秒 | 200→400 | 199 | 0.495 秒 | 1.67 |
| +160 秒 | 400 | 209 | 1.923 秒 | 2.03 |

人数を 200 → 400 と **2 倍** にしても、件数は 170 → 209 と **1.2 倍** にしか増えず、p95 は 0.19 → 1.92 秒と **10 倍** に延びました。
storefront の CPU は 2.0(CPU 2 個ぶん)を超えています。画面を組み立てる計算が重いので、ここがこの storefront 1 台の限界に近い所です。
待ち時間だけが延びて件数が頭打ちになる、この曲がり角が「限界」です。

k6 のまとめ(3 分全体):

```text
    ✗ 'p(95)<1000' p(95)=1.52s
    http_req_duration..............: avg=617.51ms min=… med=455.94ms max=2.17s p(90)=1.43s p(95)=1.52s
    http_req_failed................: 0.00%  0 out of 32479
    http_reqs......................: 32479  178.953989/s
```

失敗は 0% ですが、p95 が 1.52 秒で「1 秒未満」の基準を割りました。**落ちてはいないが、遅くて使い物にならない** 状態も「限界を超えた」と見なします。

## 5. ここで覚える言葉

| 言葉 | 一言でいうと | たとえ | この演習で見たもの |
| --- | --- | --- | --- |
| [負荷試験](/guide/glossary#load-test) | わざと大勢で来て、どこまで耐えるか測る | 開店前の混雑リハーサル | `tools/k6.sh ramp.js` |
| [k6](/guide/glossary#k6) | 負荷をかける道具 | 大勢のお客様役を出す装置 | 段階的に VU を増やす |
| [VU](/guide/glossary#vu)(仮想利用者) | 同時に動くお客様役の数 | 行列に並ぶ人数 | 100 → 200 → 400 人 |
| [ステップ負荷](/guide/glossary#step-load) | 人数を段階的に増やす試験 | 少しずつ人を増やして様子を見る | `--stage 30s:100 …` |
| [スループット](/guide/glossary#throughput) | 1 秒にさばける件数 | 1 分間に作れるラーメンの杯数 | 件数 / 秒 が頭打ちになる |
| [閾値](/guide/glossary#threshold)(合格の基準) | ここを超えたら不合格、と決めた線 | 「待ち時間 1 秒まで」の張り紙 | `p(95)<1000` |

## 6. 設計書ではここに書く

- **[性能方式 4.1 速さの目標](/design/architecture/07-performance#s4-1)・[4.4 負荷試験](/design/architecture/07-performance#s4-4)**: 見込む流量(平常時・ピーク)、保つ数字(成功率・p95)、試験のやり方、入口のレート制限をどう扱うか。
- **[D-PERF-05 4.1 流量の計算](/design/detail/D-PERF-05-load-test#s4-1)・[4.4 比べ方と記録](/design/detail/D-PERF-05-load-test#s4-4)**: 何人 × 何秒に 1 回で何件になるかの計算、合格の基準、結果の記録の形。
- **[性能方式 4.2 入口でためて減らす](/design/architecture/07-performance#s4-2)**: キャッシュを前提にした流量の見積もり。

## 7. レビューで聞く質問

- 「見込む流量(平常時とピーク)は何件 / 秒ですか。その根拠は何ですか。」
- 「負荷試験の合格の基準は何ですか。失敗の割合を見ていますか(応答時間だけになっていませんか)。」
- 「アプリの限界を測るとき、入口のレート制限や WAF に先に当たっていませんか。どう避けましたか。」
- 「限界(件数が頭打ちで待ち時間が延び始める点)は、どこでしたか。ピークの何倍の余裕がありますか。」
- 「限界に達したとき、いちばん細い所(CPU・DB の接続・入口の接続)はどこでしたか。」

## 8. 片付け

負荷試験は設定を変えていないので、片付けは要りません。試験が終わったら数字が落ち着くのを待ちます。

::: code-group

```bash [Mac / Linux / WSL]
docker stats --no-stream --format '{{.Name}} {{.CPUPerc}}' | grep lab-storefront   # CPU が下がっていればよい
```

```powershell [PowerShell]
docker stats --no-stream --format '{{.Name}} {{.CPUPerc}}' | Select-String 'lab-storefront'   # CPU が下がっていればよい
```

:::
