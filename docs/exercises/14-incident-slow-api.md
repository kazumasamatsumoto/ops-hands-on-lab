---
title: 障害-1 API が遅い → SSR が逃げる
---

# 障害-1 API が遅い → SSR が逃げる

::: info この演習について
- 所要時間: 約 20 分(アラートが鳴るまでの数分を含む)
- 使うもの: 軽量版(docker compose)。`curl`、ブラウザ、Prometheus、Grafana、pager
- 関係する設計書: [FE 方式 4.3 SSR のタイムアウトと逃げ道](/design/architecture/01-frontend#s4-3)・[障害対応方式 4.2 逃げ道を先に決める](/design/architecture/08-incident-response#s4-2)・[D-INC-03 API の応答遅延](/design/detail/D-INC-03-slow-api)
:::

## 1. この設計書はなぜ必要か

障害の多くは「完全に止まる」ではなく「**遅くなる**」から始まります。遅い部品に引きずられて、元気な部品まで止まってしまうのが一番怖いパターンです。

> **よくある事故**: 在庫を問い合わせる外部のシステムが、ある朝から 1 回 5 秒かかるようになりました。
> 商品詳細の画面はサーバーでその返事を待ってから HTML を作っていたので、画面を作る係が全員「返事待ち」でふさがり、
> 在庫と関係のないトップ画面や会社案内まで開かなくなりました。「どこまで待つか」「待ちきれなかったら何を出すか」を誰も決めていなかったのです。

「待つ上限(タイムアウト)」と「上限を超えたときの逃げ道(フォールバック)」を先に決め、さらに **気づく → 切り分ける → 影響を止める → 戻ったことを確かめる** の手順を、障害対応の設計書に書いておきます。

## 2. 何をやっているのか

サンプルストアの web は、SSR(サーバーで画面を組み立てる)を **3 秒(`SSR_TIMEOUT_MS`)であきらめ**、中身の無い HTML(CSR の殻)を返します。
画面はブラウザが続きを組み立てます(API が遅いので、そのぶん遅れて出ます)。このとき応答ヘッダは `X-Render-Mode: fallback` になり、ログに `ssr_fallback`、指標 `ssr_fallback_total` が 1 増えます。
フォールバックの割合が 5 分間で 5% を超えると、アラート `SSRFallbackRatioHigh` が鳴ります。

演習では、api の全部の返事に 4 秒の遅れを足し(`latencyMs=4000`)、この一連の動きを見ます。

たとえ: **仕出し弁当の店** です。お客様(ブラウザ)に「完成したお弁当」(SSR)を出したいのですが、おかずの仕入れ先(API)が遅れています。
3 分待っても届かなければ、「ご飯だけ先にお渡しして、おかずは届き次第お席にお持ちします」(フォールバック)に切り替えます。
お客様を店先で待たせ続けず、店員の手も空くので、ほかのお客様の注文も受けられます。

## 3. まず触ってみる

1. **api を遅くする**。

   ```bash
   tools/chaos.sh set latencyMs=4000
   ```

2. **画面と API を 1 回ずつ取って、時間とヘッダを見る**(edge の作り置きに当たらないよう、最近開いていない商品を使います)。

   ```bash
   curl -s -o /dev/null -D - -w 'status=%{http_code} total=%{time_total}s\n' http://localhost:18080/products/12 \
     | grep -iE 'x-render-mode|cache-control|x-cache|status='
   curl -s -o /dev/null -w 'api: status=%{http_code} total=%{time_total}s\n' http://localhost:18080/api/products/12
   ```

3. **ログを見る**(気づく・切り分けるときの手がかり)。

   ```bash
   docker compose logs web --no-log-prefix --since 1m | grep -E 'ssr_fallback|"url":"/products/12"' | tail -2
   ```

   Grafana(http://localhost:13000)の「サンプルストア SLO」の一番下「ログ(api・web・edge)」パネルでも同じ行が見られます。

4. **ブラウザで開く**。http://localhost:18080/products/13 を開きます。3 秒ほどで「読み込み中…」が出て、さらに数秒後に商品が表示され、画面下が「描画モード: CSR(SSR が時間切れのため、ブラウザで描画)」になります。

5. **アラートが鳴るまで、お客様のまねを続ける**(2 秒に 1 回、3 分)。別のターミナルで Prometheus の http://localhost:19090/alerts を開いておきます。

   ```bash
   for i in $(seq 1 90); do curl -s -o /dev/null "http://localhost:18080/products/$((i%30+1))" & sleep 2; done; wait
   ```

   Prometheus の「Query」で次を見ます。

   ```text
   job:ssr_fallback:ratio_rate5m
   ssr_fallback_total
   ```

6. **逃げ道が無かったら、をまねる**。SSR を 10 秒まで待つ設定にすると、お客様は API と同じだけ待たされます。

   ```bash
   SSR_TIMEOUT_MS=10000 docker compose up -d web
   docker compose ps web        # (healthy) を待つ
   curl -s -o /dev/null -w 'status=%{http_code} mode=%header{x-render-mode} total=%{time_total}s\n' http://localhost:18080/products/14
   docker compose up -d web     # 既定の 3000 に戻す
   ```

7. **影響を止めて、戻ったことを確かめる**。本番なら「遅い部品を直す・切り離す」ですが、ここではスイッチを戻します。

   ```bash
   tools/chaos.sh reset
   curl -s -o /dev/null -w 'status=%{http_code} mode=%header{x-render-mode} total=%{time_total}s\n' http://localhost:18080/products/16
   ```

## 4. 何が見えたら成功か

**手順 2**: API は 4 秒かかるのに、画面は **ちょうど 3 秒** で返ってきます(`fallback`)。空の HTML は作り置きされないよう `no-store` が付いています。

```text
X-Render-Mode: fallback
Cache-Control: no-store
X-Cache-Status: MISS
status=200 total=3.007663s
api: status=200 total=4.009700s
```

**手順 3**: 「3 秒であきらめた」ことがログに残ります。

```text
{"service":"web","level":"warn","event":"ssr_fallback","url":"/products/12","route":"/products/:id","timeoutMs":3000}
{"service":"web","level":"info","msg":"request","method":"GET","url":"/products/12","route":"/products/:id","status":200,"durationMs":3001.8,"renderMode":"csr","fallback":true}
```

**手順 4**: ブラウザでは、約 3 秒で最初の応答が届き(`responseStart` 3,022ms)、その後ブラウザが API を呼んで商品「ステンレス水筒 500ml」を表示しました。画面下の表示は「描画モード: CSR(SSR が時間切れのため、ブラウザで描画)」です。

**手順 5**: フォールバック率が 5% を超えて 1 分続くと鳴り、pager に届きます。

```text
+ 10s ratio=0.987 SSRFallbackRatioHigh=pending
...
+ 60s ratio=0.987 SSRFallbackRatioHigh=firing

pager: firing SSRFallbackRatioHigh | web: SSR のフォールバック率が 5% を超えています | 直近 5 分のフォールバック率: 98.75%。API の遅延(latencyMs)を疑ってください。
```

(直前に負荷試験([性能-1](./12-perf-load-test)・[性能-2](./13-perf-scale-out))をしていると、5 分の窓の中に大量の「普通の SSR」が残っていて、最初は割合が 1% 未満に見えます。窓が進むと上がり、ループが終わってから 2〜3 分で鳴ります。すぐに見たいときは、負荷試験のあと 5 分空けてから手順 1 を始めてください。)

**手順 6**: 逃げ道を 10 秒に延ばすと、画面は SSR のまま 4.2 秒かかりました。1 人なら「少し遅い」で済みますが、大勢が来ると、画面を作る係が全員 4 秒ずつふさがります。

```text
SSR_TIMEOUT_MS=10000: status=200 mode=ssr total=4.168215s
SSR_TIMEOUT_MS=3000:  status=200 mode=fallback total=3.061495s
```

**手順 7**: 戻すと、すぐに SSR で 0.03 秒に戻ります。

```text
reset: status=200 mode=ssr total=0.030172s
```

### 一次対応の流れ(この演習で実際にたどった順)

| 段階 | やったこと | 見た物 |
| --- | --- | --- |
| 気づく | アラート `SSRFallbackRatioHigh` が pager に届いた | 「API の遅延を疑ってください」という説明文 |
| 切り分ける | 画面と API の時間を別々に測った。web のログに `ssr_fallback` | 画面 3.0 秒 / API 4.0 秒 → 遅いのは API 側 |
| 影響を止める | (本番なら)遅い部品を切り離す・台数を増やす・直前のリリースを戻す | ここではスイッチを戻した |
| 戻ったことを確かめる | `X-Render-Mode: ssr` と時間 | 0.03 秒、アラートが数分で resolved |

## 5. ここで覚える言葉

| 言葉 | 一言でいうと | たとえ | この演習で見たもの |
| --- | --- | --- | --- |
| タイムアウト | 待つ時間の上限 | 「3 分待っても届かなければ」の決まり | `SSR_TIMEOUT_MS=3000`、ちょうど 3.0 秒で応答 |
| フォールバック | 本来のやり方をあきらめたときの逃げ道 | ご飯だけ先にお渡しする | `X-Render-Mode: fallback` |
| 連鎖障害 | 1 つの遅れ・故障が、ほかの部品まで巻き込むこと | 仕入れの遅れで店全体が止まる | 10 秒待つ設定だと、画面の係がふさがる |
| 一次対応 | 原因を直す前に、まず被害を止める対応 | 応急手当 | 気づく → 切り分ける → 止める → 確かめる |
| 手順書(ランブック) | 障害のときに誰でも同じ手順を踏めるように書いた紙 | 火事のときの避難手順 | [D-INC-03](/design/detail/D-INC-03-slow-api) |
| 構造化ログ | 1 行を項目付き(JSON)で書いたログ | 記入欄の決まった報告書 | `"event":"ssr_fallback","timeoutMs":3000` |

## 6. 設計書ではここに書く

- **[FE 方式 4.3 SSR のタイムアウトと逃げ道](/design/architecture/01-frontend#s4-3)**: 「SSR は 3 秒であきらめ、CSR の殻を返す」「殻は `no-store` で作り置きさせない」「3 秒の根拠(API の p95 × 余裕)」。
- **[障害対応方式 4.2 逃げ道を先に決める](/design/architecture/08-incident-response#s4-2)**: 部品ごとに「遅い・止まったときに、画面はどうなるか」の表。
- **[障害対応方式 4.3 気づき方と一次対応](/design/architecture/08-incident-response#s4-3)**: どのアラートで気づき、最初の 15 分で何をするか。
- **[SRE 方式 4.4 SSR のアラート](/design/architecture/05-sre#s4-4)・[4.7 ログ](/design/architecture/05-sre#s4-7)**: `SSRFallbackRatioHigh` の条件(5 分で 5% 超が 1 分)と、ログの項目。
- **[D-INC-03 API の応答遅延](/design/detail/D-INC-03-slow-api)**(一般のカタログでは D-INC-03): [4.1 気づく](/design/detail/D-INC-03-slow-api#s4-1)・[4.2 切り分ける](/design/detail/D-INC-03-slow-api#s4-2)・[4.3 影響を止める](/design/detail/D-INC-03-slow-api#s4-3)・[4.4 戻ったことを確かめる](/design/detail/D-INC-03-slow-api#s4-4) のそれぞれに、上の表のコマンドと「見る物」を書きます。

## 7. レビューで聞く質問

- 「この画面がサーバーで呼ぶ API が 10 秒返事をしなかったら、お客様には何が見えますか。何秒で見えますか。」
- 「タイムアウトの秒数の根拠は何ですか。呼ぶ先の API の p95 と比べてどうですか。」
- 「逃げ道(フォールバック)に切り替わったことに、誰がどの指標やアラートで気づきますか。」
- 「障害のとき、遅いのがどの部品かを切り分けるコマンドや画面は、手順書に書いてありますか。」
- 「逃げ道の画面は、キャッシュに残ってしまいませんか。」

## 8. 片付け

```bash
tools/chaos.sh reset                                     # latencyMs を 0 に戻す(手順 7 で済んでいれば不要)
docker compose up -d web                                 # SSR_TIMEOUT_MS を 3000 に戻す(手順 6 で済んでいれば不要)
docker compose exec -T web printenv SSR_TIMEOUT_MS       # 3000 ならよい
```

アラート `SSRFallbackRatioHigh` は、5 分の窓からフォールバックが消えると自然に解決します。
