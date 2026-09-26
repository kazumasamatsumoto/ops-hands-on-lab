---
title: 性能-2 台数を増やして耐える
---

# 性能-2 台数を増やして耐える

::: info この演習について
- 所要時間: 約 20 分(本格版もやるなら +15 分)
- 使うもの: 軽量版(docker compose)。`tools/k6.sh`、`docker stats`。本格版(kind)があれば比べられます
- 仕組みはこちら: [仕組み-3 Kubernetes の基本](/how-it-works/03-kubernetes-basics)・[仕組み-4 storefront の SSR](/how-it-works/04-storefront-ssr)
- 関係する設計書: [性能方式](/design/architecture/07-performance)・[インフラ方式](/design/architecture/03-infrastructure)
- 用語集: [スケールアウト](/guide/glossary#scale-out)・[容量計画](/guide/glossary#capacity-planning)・[レプリカ](/guide/glossary#replica)・[HPA](/guide/glossary#hpa)
:::

## 1. この設計書はなぜ必要か

1 台では限界がある([性能-1](./12-perf-load-test))と分かったとき、次は「台数を増やせば耐えるのか」を確かめます。増やしても効かない作りだと、いくらお金をかけても速くなりません。

> **よくある事故**: 遅いので台数を 3 倍にしたのに、ほとんど速くなりませんでした。
> 調べると、各台が「そのお客様の状態」を自分のメモリに持っていて、同じお客様が同じ台にしか行けない作りでした。
> 台を増やしても、1 人のお客様をさばくのは相変わらず 1 台だけだったのです。

「台数を増やせば線形に近く効くか(状態を台に持っていないか)」を、性能・インフラの方式設計書で決めます。

## 2. 何をやっているのか

軽量版では `docker compose up -d --scale storefront=3` で storefront を 3 台に増やせます。ingress は「storefront」という名前で振り分けるので、Docker が 3 台の住所を返し、ingress が順番に配ります。
同じ負荷(400 人、1 分半)を、storefront 1 台のときと 3 台のときでかけ、待ち時間と件数を比べます。入口の作り置き(キャッシュ)とレート制限は、試験の間だけ切ります(storefront の力を測るため)。

たとえ: **スーパーのレジを 1 台から 3 台に増やす** ことです。行列は短くなります。ただし、レジ係が「このお客様のポイントカードは私が預かっている」という働き方(台ごとに状態を持つ)だと、別のレジに並べません。
サンプルストアの storefront は、ログインの印をブラウザ側(sessionStorage)に持つので、どの台に当たってもかまいません。

::: tip CCv2 では
CCv2 では、aspect の台数は manifest.json ではなく、Cloud Portal の環境ごとの設定で決まります(本番の台数は SAP が見積もって管理します)。このラボでは manifest.json の環境(d1/s1/p1)で決め、本番(p1)は storefront・api を 2 台ずつにしています。
台数を増やしても効くのは、状態をアプリの外(ブラウザ・DB)に持っているからです。負荷に応じて自動で台数を変える仕組み(HPA)は、CPU の使用量を集める部品が別に要ります(このラボの本格版には入れていません。理由は `k8s/README.md`)。
:::

## 3. まず触ってみる

1. **試験のために、入口のキャッシュとレート制限を外す**(試験が終わったら必ず戻します)。

   ```bash
   EDGE_CACHE=off EDGE_GLOBAL_RATE=10000r/s docker compose up -d cdn-waf
   docker compose ps cdn-waf        # (healthy) を待つ
   ```

2. **storefront 1 台のまま、400 人で 1 分半かける**(20 秒で 400 人まで増やし、60 秒続け、10 秒で片付け)。

   ```bash
   tools/k6.sh ramp.js -e TARGET=page --stage 20s:400 --stage 60s:400 --stage 10s:0 2>&1 \
     | grep -E 'http_req_duration\.\.|http_req_failed|http_reqs\.'
   ```

3. **storefront を 3 台に増やす**。

   ```bash
   docker compose up -d --scale storefront=3 --no-recreate storefront
   docker compose ps storefront
   ```

   3 台とも `(healthy)` になったら、10 秒ほど待ちます(ingress が名前を調べ直すのを待つため)。

4. **同じ負荷をもう一度かける**。

   ```bash
   tools/k6.sh ramp.js -e TARGET=page --stage 20s:400 --stage 60s:400 --stage 10s:0 2>&1 \
     | grep -E 'http_req_duration\.\.|http_req_failed|http_reqs\.'
   ```

5. **3 台に均等に配られたか数える**。

   ```bash
   for c in 1 2 3; do printf 'lab-storefront-%s: ' $c; docker logs lab-storefront-$c --since 2m 2>&1 | grep -c '"route":"/p/:code"'; done
   ```

### 本格版では

本格版(kind)では、台数を 1 行で変えられます。詳しくは `k8s/README.md`([準備と起動](/guide/setup))を見てください。

```bash
kubectl -n lab get pods -l app.kubernetes.io/name=storefront -w    # 別のターミナルで、Pod が増える様子を見る
kubectl -n lab scale deploy/storefront --replicas=4                # 4 台に増やす
kubectl -n lab scale deploy/storefront --replicas=2                # 元の 2 台に戻す(k8s/up.sh でも戻る)
```

## 4. 何が見えたら成功か

**手順 2 と 4 の比較**(同じ 400 人・同じ時間。実測。この PC は Docker に CPU 10 個ぶん)

| | storefront 1 台 | storefront 3 台 |
| --- | --- | --- |
| 件数 / 秒 | 139 | 224 |
| 真ん中の人の待ち時間(med) | 2.21 秒 | 0.84 秒 |
| p95 | 2.45 秒 | 2.25 秒 |
| 失敗 | 0% | 0% |

```text
storefront 1 台:
    http_req_duration..............: avg=1.9s med=2.21s max=2.82s p(90)=2.37s p(95)=2.45s
    http_req_failed................: 0.00%  0 out of 12606
    http_reqs......................: 12606  139.277538/s

storefront 3 台:
    http_req_duration..............: avg=993ms med=836ms max=2.7s p(90)=2.04s p(95)=2.25s
    http_req_failed................: 0.00%  0 out of 20221
    http_reqs......................: 20221  223.582121/s
```

真ん中の人の待ち時間は 2.21 → 0.84 秒と、大きく縮みました。件数も 1.6 倍に増えています。

::: warning p95(遅い側)は、回によって良くも悪くもなります
別の日にもう一度測ったときは、真ん中の待ち時間は 2.25 → 0.60 秒と縮みましたが、**p95 は 2.52 → 2.89 秒と悪くなりました**。
このラボでは 3 台の storefront が **同じ 1 台の PC の CPU を取り合う** ため、多くの人は速くなっても、いちばん遅い側の人は縮まないことがあるからです。
本番で台数を増やすときは、別のマシン(Kubernetes ならノード)に分けて置くので、この取り合いは起きにくくなります。
「台数を増やせば全部が速くなる」とは限らないこと、**真ん中の値と p95 は分けて見る** ことを覚えておいてください。
:::
3 倍ぴったりにならないのは試験の作りのためです。400 人それぞれが「リクエスト → 0.5 秒考える → リクエスト」を繰り返すので、件数は **400 ÷(0.5 秒 + 待ち時間)** より多くはなりません。
待ち時間が縮むと、次は「お客様の数」の方が先に頭打ちになります。**もっと件数を出すには、客役(VU)を増やす** 必要があります。

**手順 5**: 3 台に、ほぼ 3 分の 1 ずつ配られています。

```text
lab-storefront-1: 6721
lab-storefront-2: 6778
lab-storefront-3: 6725
```

::: warning 台数を増やしたら、次の細い所が見える
3 台にして負荷をかけ直すと、今度は cdn-waf の CPU が上がり(1 台で 3 台分の通信をさばくため)、そこが次のいちばん細い所になりました。
「台数を増やすと、ボトルネックが別の場所に移る」ことも、負荷試験で見つかります。1 か所直すたびに測り直すのが基本です。
:::

::: tip 台数を増やすと、指標の集め方も見直す
軽量版の Prometheus は `storefront:4000` という名前で指標を集めるので、3 台にすると毎回どれか 1 台の数字しか取れません(3 台の合計になりません)。
本格版(Kubernetes)では、Prometheus が Pod を 1 つずつ見つけて集めます。台数を増やす設計では、監視の設計も一緒に見直します。
:::

## 5. ここで覚える言葉

| 言葉 | 一言でいうと | たとえ | この演習で見たもの |
| --- | --- | --- | --- |
| [スケールアウト](/guide/glossary#scale-out) | 台数を増やして耐える | レジを増やす | `--scale storefront=3` |
| [レプリカ](/guide/glossary#replica) | 同じアプリを何台並べるか | 同じレジを何台開けるか | 1 台 → 3 台 |
| 状態を外に持つ | お客様の状態をアプリのメモリに持たない | ポイントカードはお客様が持つ | ログインの印は sessionStorage |
| ボトルネック(いちばん細い所) | 全体の速さを決めている 1 か所 | 行列のいちばん狭い通路 | 3 台にすると cdn-waf の CPU |
| [容量計画](/guide/glossary#capacity-planning) | 何台あれば見込みの人数に耐えるかを決める | 混雑日に何台レジを開けるか決める | 1 台と 3 台の比較 |
| [HPA](/guide/glossary#hpa) | 負荷に応じて台数を自動で増減する仕組み | 混んできたら自動でレジを増やす | 本格版でも未導入(理由は README) |

## 6. 設計書ではここに書く

- **[性能方式 4.5 台数を増やす](/design/architecture/07-performance#s4-5)**: 何台で見込みの流量に耐えるか、台数を増やして線形に近く効くことの確認。
- **[インフラ方式 4.1 2 つの版で同じイメージを使う](/design/architecture/03-infrastructure#s4-1)**: 状態をアプリに持たない(どの台に当たってもよい)こと。
- **[D-INF-01 4.3 本格版の Pod](/design/detail/D-INF-01-compose-and-k8s#s4-3)**: 環境ごとの台数。

## 7. レビューで聞く質問

- 「台数を増やすと、待ち時間や件数は台数に近く比例して改善しますか。しないなら、どこに状態を持っていますか。」
- 「お客様の状態(ログイン・カート)は、アプリのメモリに持っていませんか。どの台に当たっても同じに動きますか。」
- 「台数を増やしたとき、次に細くなる所(入口・DB の接続)はどこですか。そこも測りましたか。」
- 「本番は何台ですか。ピークの何倍まで耐える見積もりですか。」
- 「台数を増やしたとき、指標は全台の合計として取れますか。」

## 8. 片付け

台数を 1 台に戻し、入口の設定も戻します。

```bash
docker compose up -d --scale storefront=1 storefront
docker compose up -d cdn-waf        # EDGE_CACHE・EDGE_GLOBAL_RATE を付けずに起動 = 既定に戻る
docker compose ps storefront cdn-waf
docker compose exec -T cdn-waf printenv EDGE_CACHE EDGE_GLOBAL_RATE   # on / 20r/s ならよい
```
