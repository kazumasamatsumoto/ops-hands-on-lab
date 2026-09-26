---
title: 障害-1 API が遅い → SSR が逃げる
---

# 障害-1 API が遅い → SSR が逃げる

::: info この演習について
- 所要時間: 約 20 分
- 使うもの: 軽量版(docker compose)。`curl`、ブラウザ、`tools/chaos.sh`、Prometheus(http://localhost:19090)、pager(http://localhost:19094)
- 仕組みはこちら: [仕組み-4 storefront の SSR](/how-it-works/04-storefront-ssr)・[仕組み-11 観測(指標・ログ・トレース)](/how-it-works/11-observability)
- 関係する設計書: [障害対応方式](/design/architecture/08-incident-response)・[D-INC-03 API の応答遅延](/design/detail/D-INC-03-slow-api)・[FE 方式](/design/architecture/01-frontend)
- 用語集: [フォールバック](/guide/glossary#fallback)・[タイムアウト](/guide/glossary#timeout)・[一次対応](/guide/glossary#first-response)・[ランブック](/guide/glossary#runbook)
:::

## 1. この設計書はなぜ必要か

奥の部品(api)が遅くなると、その遅さが画面(storefront)にそのまま伝わり、待たされた画面組み立てが全部の台をふさいで、お店全体が止まります。
「遅くなったら、どう逃げるか」を先に決めていないと、1 か所の遅さがお店全体を巻き込みます。

> **よくある事故**: 在庫の連携先が遅くなっただけなのに、お店の全画面が真っ白になりました。
> 画面を作るサーバーが、遅い api の返事を待ち続け、待っている間に次のお客様の画面も作れなくなり、全員が待たされたのです。
> 「遅い 1 か所を待ち続けない」設計になっていませんでした。

「奥が遅いとき、どこで諦めて、何を返すか」を、障害対応と FE の方式設計書で決めます。

## 2. 何をやっているのか

storefront は、SSR(サーバーで画面を組み立てる)を **3 秒(`SSR_TIMEOUT_MS`)であきらめ**、中身の無い HTML(CSR の殻)を返します。
画面はブラウザが続きを組み立てます(api が遅いので、そのぶん遅れて出ます)。このとき応答ヘッダは `X-Render-Mode: fallback` になり、ログに `ssr_fallback`、指標 `ssr_fallback_total` が 1 増えます。
フォールバックの割合が 5 分間で 5% を超えると、アラート `SSRFallbackRatioHigh` が鳴ります。

演習では、api の全部の返事に 4 秒の遅れを足し(`latencyMs=4000`)、この一連の動きを見ます。

たとえ: **仕出し弁当の店** です。お客様(ブラウザ)に「完成したお弁当」(SSR)を出したいのですが、おかずの仕入れ先(api)が遅れています。
3 秒待っても届かなければ、「ご飯だけ先にお渡しして、おかずは届き次第お席にお持ちします」(フォールバック)に切り替えます。
お客様を店先で待たせ続けず、店員の手も空くので、ほかのお客様の注文も受けられます。

::: tip CCv2 では
JS Storefront も、api(OCC)が遅いときに SSR を諦めて CSR に切り替える仕組みを持ちます。「奥の 1 か所を待ち続けない」ための逃げ道(タイムアウト)は、
どの構成でも設計します。一次対応では「遅いのは storefront か api か」を、画面と api の時間を別々に測って切り分けます。
:::

## 3. まず触ってみる

1. **api を遅くする**。

   ```bash
   tools/chaos.sh set latencyMs=4000
   ```

2. **画面と api を 1 回ずつ取って、時間とヘッダを見る**(cdn-waf の作り置きに当たらないよう、`?t=` を付けて別 URL にします)。

   ```bash
   curl -s -o /dev/null -D - -w 'status=%{http_code} total=%{time_total}s\n' http://www.lab.localhost:18080/p/100012 \
     | grep -iE 'x-render-mode|cache-control|x-cache|status='
   curl -s -o /dev/null -w 'api: status=%{http_code} total=%{time_total}s\n' "http://api.lab.localhost:18080/occ/v2/samplestore/products/100012?t=1"
   ```

3. **ログを見る**(気づく・切り分けるときの手がかり)。

   ```bash
   docker compose logs storefront --no-log-prefix --since 1m | grep -E 'ssr_fallback|"url":"/p/100012"' | tail -2
   ```

   Grafana(http://localhost:13000)の「サンプルストア SLO」の一番下「ログ」のパネルでも同じ行が見られます。

4. **ブラウザで開く**。http://www.lab.localhost:18080/p/100013 を開きます。3 秒ほどで「読み込み中…」が出て、さらに 8 秒ほど後(ブラウザが api を 4 秒ずつ 2 段階で呼ぶため)に商品が表示され、画面下が「描画モード: CSR(SSR が時間切れのため、ブラウザで描画)」になります。

5. **アラートが鳴るまで、お客様のまねを続ける**(2 秒に 1 回、数分)。別のターミナルで Prometheus の http://localhost:19090/alerts を開いておきます。

   ```bash
   for i in $(seq 1 120); do curl -s -o /dev/null "http://www.lab.localhost:18080/p/$((100001 + i % 30))?t=$i" & sleep 2; done; wait
   ```

   Prometheus の「Query」で次を見ます。

   ```text
   job:ssr_fallback:ratio_rate5m
   ssr_fallback_total
   ```

6. **逃げ道が無かったら、をまねる**。SSR を 10 秒まで待つ設定にすると、お客様は api と同じだけ待たされます。

   ```bash
   SSR_TIMEOUT_MS=10000 docker compose up -d storefront
   docker compose ps storefront        # (healthy) を待つ
   curl -s -o /dev/null -w 'status=%{http_code} mode=%header{x-render-mode} total=%{time_total}s\n' "http://www.lab.localhost:18080/p/100014?t=a"
   docker compose up -d storefront     # 既定の 3000 に戻す
   ```

7. **影響を止めて、戻ったことを確かめる**。本番なら「遅い部品を直す・切り離す」ですが、ここではスイッチを戻します。

   ```bash
   tools/chaos.sh reset
   curl -s -o /dev/null -w 'status=%{http_code} mode=%header{x-render-mode} total=%{time_total}s\n' "http://www.lab.localhost:18080/p/100016?t=c"
   ```

## 4. 何が見えたら成功か

**手順 2**: api は 4 秒かかるのに、画面は **ちょうど 3 秒** で返ってきます(`fallback`)。空の HTML は作り置きされないよう `no-store` が付いています。

```text
X-Render-Mode: fallback
Cache-Control: no-store
X-Cache-Status: MISS
status=200 total=3.013797s
api: status=200 total=4.020010s
```

**手順 3**: 「3 秒であきらめた」ことがログに残ります。

```text
{"time":"...","service":"storefront","level":"warn","event":"ssr_fallback","url":"/p/100012","route":"/p/:code","timeoutMs":3000}
{"time":"...","service":"storefront","level":"info","msg":"request","method":"GET","url":"/p/100012","route":"/p/:code","status":200,"durationMs":3003.5,"renderMode":"csr","fallback":true,"reqId":"..."}
```

**手順 4**: ブラウザでは、約 3 秒で最初の応答が届き(`responseStart` 約 3,037ms)、その後ブラウザが api を呼んで商品「ステンレス水筒 500ml」を表示しました(開いてから約 11 秒)。api の呼び出しはどれも約 4 秒かかり、CMS の設計図 → 商品の中身 の順に待つので 2 回ぶん待たされます。画面下は「描画モード: CSR(SSR が時間切れのため、ブラウザで描画)」です。

**手順 5**: フォールバック率が 5% を超えて 1 分続くと鳴り、pager に届きます(実測。直前に普通の SSR がたくさん残っていると、5 分の窓が進むまで割合が上がりません)。

```text
+211s ratio=0.125 SSRFallbackRatioHigh=pending
+232s ratio=0.979 SSRFallbackRatioHigh=pending
+272s SSRFallbackRatioHigh storefront firing

pager: firing SSRFallbackRatioHigh | storefront: SSR のフォールバック率が 5% を超えています | 直近 5 分のフォールバック率: 98.72%。API の遅延(latencyMs)を疑ってください。
```

**手順 6**: 逃げ道を 10 秒に延ばすと、画面は SSR のまま 8.3 秒かかりました。1 人なら「遅い」で済みますが、大勢が来ると、画面を作る係が全員 8 秒ずつふさがります。

```text
SSR_TIMEOUT_MS=10000: status=200 mode=ssr total=8.272881s
SSR_TIMEOUT_MS=3000:  status=200 mode=fallback total=3.040774s
```

**手順 7**: 戻すと、すぐに SSR で 0.05 秒に戻ります。

```text
reset: status=200 mode=ssr total=0.053170s
```

### 一次対応の流れ(この演習で実際にたどった順)

| 段階 | やったこと | 見た物 |
| --- | --- | --- |
| 気づく | アラート `SSRFallbackRatioHigh` が pager に届いた | 「API の遅延を疑ってください」という説明文 |
| 切り分ける | 画面と api の時間を別々に測った。storefront のログに `ssr_fallback` | 画面 3.0 秒 / api 4.0 秒 → 遅いのは api 側 |
| 影響を止める | (本番なら)遅い部品を切り離す・台数を増やす・直前のリリースを戻す | ここではスイッチを戻した |
| 戻ったことを確かめる | `X-Render-Mode: ssr` と時間 | 0.05 秒、アラートが数分で resolved |

## 5. ここで覚える言葉

| 言葉 | 一言でいうと | たとえ | この演習で見たもの |
| --- | --- | --- | --- |
| [フォールバック](/guide/glossary#fallback) | 本来のやり方が間に合わないとき、別のやり方に切り替える | ご飯だけ先に出す | `X-Render-Mode: fallback` |
| [タイムアウト](/guide/glossary#timeout) | ここまで待って駄目なら諦める、という時間 | 「3 分待って来なければ次へ」 | `SSR_TIMEOUT_MS=3000` |
| [一次対応](/guide/glossary#first-response) | 直す前に、まず影響を止める動き | 火を消す前に、まず人を逃がす | 気づく → 切り分ける → 止める |
| [ランブック](/guide/glossary#runbook) | 障害のときの手順書 | 火災時の避難経路図 | 上の「一次対応の流れ」の表 |
| 切り分け | 遅い・壊れているのがどこかを絞る | どのブレーカーが落ちたか探す | 画面と api の時間を別々に測る |

## 6. 設計書ではここに書く

- **[障害対応方式 4.2 逃げ道を先に決める](/design/architecture/08-incident-response#s4-2)・[4.3 気づき方と一次対応](/design/architecture/08-incident-response#s4-3)**: 奥が遅いときの逃げ道、気づく手段(アラート)、一次対応の順番。
- **[FE 方式 4.3 SSR のタイムアウトと逃げ道](/design/architecture/01-frontend#s4-3)**: SSR を何秒で諦めるか、諦めたら何を返すか。
- **[D-INC-03 4.1〜4.4](/design/detail/D-INC-03-slow-api#s4)**: 気づく・切り分ける・止める・戻ったことを確かめる、それぞれの具体的なコマンド。

## 7. レビューで聞く質問

- 「奥の部品(api)が遅くなったとき、画面はどこで諦めますか。何秒ですか。諦めたら何を返しますか。」
- 「api が遅いことに、誰がどの指標・アラートで気づきますか。」
- 「遅いのが画面か api か、どうやって切り分けますか。手順はありますか。」
- 「1 か所の遅さが、全部の画面組み立てをふさぐ作りになっていませんか。」
- 「影響を止める手(切り離す・台数を増やす・戻す)は、事前に決めてありますか。」

## 8. 片付け

```bash
tools/chaos.sh reset
docker compose up -d storefront                                                     # SSR_TIMEOUT_MS を既定の 3000 に
curl -s -o /dev/null -w '%{http_code} %header{x-render-mode}\n' "http://www.lab.localhost:18080/p/100001?t=z"   # 200 ssr ならよい
```

アラートは、遅延を止めてから数分で自然に `resolved` になります。
