---
title: QA-1 E2E テストと画面比較
---

# QA-1 E2E テストと画面比較

::: info この演習について
- 所要時間: 約 25 分
- 使うもの: 軽量版(docker compose)。`tools/e2e.sh`(Docker で Playwright を動かす)、`tools/chaos.sh`
- 仕組みはこちら: [仕組み-4 storefront の SSR](/how-it-works/04-storefront-ssr)・[仕組み-6 api(OCC・fields・CORS)](/how-it-works/06-api-occ)
- 関係する設計書: [QA 方式](/design/architecture/06-qa)・[D-QA-04 E2E テスト](/design/detail/D-QA-04-e2e)
- 用語集: [E2E テスト](/guide/glossary#e2e-test)・[Playwright](/guide/glossary#playwright)・[画面比較](/guide/glossary#visual-regression)・[回帰テスト](/guide/glossary#regression-test)
:::

## 1. この設計書はなぜ必要か

部品を 1 つずつ試して「動く」ことと、お客様が最初から最後まで「買える」ことは別です。つなぎ目で壊れることが多く、しかも見た目の崩れは人の目で毎回は見つけられません。

> **よくある事故**: 決済のボタンの色を変える小さな修正で、ボタンが画面の外にはみ出してしまいました。
> 単体の試験は全部通り、担当者も自分の PC では気づきませんでした。特定の画面幅のお客様だけが「買えない」状態になり、
> 週明けまで誰も気づきませんでした。

「主要な導線を最後まで通す(E2E)」「昨日の画面と今日の画面を機械で重ねて違いを見つける(画面比較)」を、QA の方式設計書で決めます。

## 2. 何をやっているのか

`tools/e2e/` に Playwright(ブラウザを自動で操作する道具)のテストを置いてあります。`tools/e2e.sh` が Docker の中でブラウザを動かし、利用者と同じ入口(cdn-waf)を通って操作します。

| ファイル | シナリオ | 確かめる物 |
| --- | --- | --- |
| `tests/journey.spec.ts` | トップ → 検索 → 商品詳細 → ログイン(alice)→ 注文履歴 → 注文の詳細 / 無い商品の 404 | 見出し・商品名・価格・SSR で出ていること・注文の合計 |
| `tests/authz.spec.ts` | bob でログインし、alice の注文の URL を直接開く | 「注文を表示できませんでした」と出て、中身が出ないこと |
| `tests/visual.spec.ts` | トップ・検索結果・商品詳細の画面を撮る | 基準画像との違いが 50 画素以内(毎回変わる部分は隠す) |

演習では、①ふつうに流して全部通る、②CSS を 1 行変えて画面比較だけが落ちる、③認可の穴を開けて認可のテストが落ちる、④元に戻して全部通る、の順に見ます。

たとえ: **E2E テストは「毎朝の開店前に、店員がお客様役になって入口からレジまで一周する」** ことです。
**画面比較は「昨日の売り場の写真と今日の売り場を重ねて、違う所に赤い印を付ける」** ことです。人の目では気づかない小さなずれも、写真を重ねれば一目で分かります。

::: tip CCv2 では
CCv2 の JS Storefront も、同じように Playwright などで E2E と画面比較を組みます。「他人の注文が見えないこと」を試験に必ず入れるのは、OCC を拡張した API の認可漏れ([BE-1](./04-be-api-and-authz))を出す前に見つけるためです。
:::

## 3. まず触ってみる

前提: トップのバナーの見出しが元の「秋の文房具フェア」のままであること(テストはこの文言と見た目を基準にしています。[ヘッドレス-1](./21-headless-cms) で変えたままだと、journey と top の画面比較が落ちます)。

1. **ふつうに流す**。

   ```bash
   tools/e2e.sh
   ```

   詳しい報告は `tools/e2e/playwright-report/index.html` をブラウザで開くと見られます。

2. **CSS を 1 行だけ変える**。商品詳細の価格の文字を大きくします(「見た目を少し整えるだけ」のつもりの修正のまね)。cdn-waf のキャッシュを避けるため、変更後に切ってから流します。

   ```bash
   cp apps/web/src/styles.css /tmp/styles.css.bak
   sed -i.tmp 's/^\.price\.large { font-size: 1\.4rem;/.price.large { font-size: 2.4rem;/' apps/web/src/styles.css && rm apps/web/src/styles.css.tmp
   diff /tmp/styles.css.bak apps/web/src/styles.css
   docker compose up -d --build storefront
   docker compose ps storefront        # (healthy) を待つ
   EDGE_CACHE=off docker compose up -d cdn-waf; docker compose ps cdn-waf   # 画面比較がキャッシュに当たらないように
   tools/e2e.sh
   ```

3. **差分の画像を見る**。失敗の報告に出てくる `product-detail-diff.png`(`tools/e2e/test-results/` の下)を開くと、違う所が赤く塗られています。
   報告の HTML では、基準・今回・差分をスライダーで見比べられます。

4. **CSS とキャッシュを元に戻す**。

   ```bash
   cp /tmp/styles.css.bak apps/web/src/styles.css && rm /tmp/styles.css.bak
   docker compose up -d --build storefront
   docker compose up -d cdn-waf        # EDGE_CACHE を付けずに起動 = on
   docker compose ps storefront cdn-waf   # 両方 (healthy) を待つ
   ```

5. **認可の穴を開けて、認可のテストだけ流す**。

   ```bash
   tools/chaos.sh set idorBug=true
   tools/e2e.sh tests/authz.spec.ts
   tools/chaos.sh reset
   ```

6. **全部が通ることを確かめる**。

   ```bash
   tools/e2e.sh
   ```

7. **テストの書き方を読む**。`tools/e2e/tests/journey.spec.ts` を開き、画面の部品を「見出し」「リンク」「ボタン」といった **役割と文字** で探していること、固定の秒数では待たず「見えるまで待つ」書き方になっていることを確かめます。

## 4. 何が見えたら成功か

**手順 1**: 6 本とも通ります(数秒で終わります)。

```text
  ✓  1 [chromium] › tests/authz.spec.ts:7:5 › bob は alice の注文を見られない (386ms)
  ✓  2 [chromium] › tests/journey.spec.ts:7:5 › トップ → 検索 → 商品詳細 → ログイン → 注文履歴 が最後まで進める (556ms)
  ✓  3 [chromium] › tests/journey.spec.ts:57:5 › 無い商品は 404 で「ページを表示できませんでした」 (110ms)
  ✓  4 [chromium] › tests/visual.spec.ts:16:7 › 画面比較: top (871ms)
  ✓  5 [chromium] › tests/visual.spec.ts:16:7 › 画面比較: search (680ms)
  ✓  6 [chromium] › tests/visual.spec.ts:16:7 › 画面比較: product-detail (740ms)
  6 passed
```

**手順 2**: 導線のテスト(journey)は **通ってしまいます**。価格「￥330」はちゃんと出ているからです。落ちるのは画面比較(product-detail)だけです。

```text
  ✓  2 [chromium] › tests/journey.spec.ts:7:5 › … が最後まで進める
  ✓  4 [chromium] › tests/visual.spec.ts:16:7 › 画面比較: top
  ✘  6 [chromium] › tests/visual.spec.ts:16:7 › 画面比較: product-detail
    Error: expect(page).toHaveScreenshot(expected) failed
      Expected an image 1280px by 1470px, received 1280px by 1491px. 67959 pixels (ratio 0.04 of all image pixels) are different.
    Diff:     test-results/visual-画面比較-product-detail-chromium/product-detail-diff.png
  1 failed
  5 passed
```

価格の文字が大きくなったぶん、商品詳細の画面が縦に 21 画素伸び、その下の部品が全部ずれたので、違う画素が約 6.8 万個になりました。
大きい価格(`.price.large`)は商品詳細にしか使っていないので、トップ(top)と検索(search)は通ります。差分の画素数はビルドごとに少し変わります。

**手順 3**: 差分の画像では、価格の文字が大きくなった所と、そのせいで下にずれた部分が赤く表示されます。

::: tip 許す違いの決め方でテストの効き目が変わる
最初は「画面の 1% までの違いは許す」という設定で試すと、小さな変更は **見逃されて合格** します。1280×1470 の画面の 1% は 1 万 8 千画素以上もあるからです。
たとえば価格を 2.4rem ではなく 1.5rem にした場合、違いは約 1.4 万画素(画面の 0.74%)で、1% の設定なら合格してしまいます。
今の設定(`tools/e2e/playwright.config.ts`)は「50 画素まで」にしています。「どこまでの違いを許すか」も、設計書に書いてレビューする値です。
:::

**手順 5**: 認可の穴を開けると、bob の画面に alice の注文が表示されてしまい、「注文を表示できませんでした」が出ないので落ちます。

```text
  ✘  1 [chromium] › tests/authz.spec.ts:7:5 › bob は alice の注文を見られない
    Error: expect(locator).toBeVisible() failed
    Locator: getByText('注文を表示できませんでした')
    Expected: visible
    Error: element(s) not found
```

失敗したときの画面(`test-failed-1.png`)と操作の記録(`trace.zip`)も自動で残ります。

**手順 6**: 戻したら、また 6 本とも通ります。

::: warning 画面比較は「毎回変わる部分」をそろえる
在庫の数は worker の定期ジョブ(`stockImportJob`)が 1 分ごとに少し動かすので、基準画像とずれます。`visual.spec.ts` では、在庫の表示を隠し(mask)、「在庫なし」の印は撮る前に消して(並びが変わらないように)から比べています。
「毎回変わる部分をどうそろえるか」を決めておかないと、画面比較が理由もなく落ちる(不安定なテスト)ようになります。
:::

## 5. ここで覚える言葉

| 言葉 | 一言でいうと | たとえ | この演習で見たもの |
| --- | --- | --- | --- |
| [E2E テスト](/guide/glossary#e2e-test) | 入口から出口まで通しで試す | 開店前の一周点検 | journey.spec.ts |
| [Playwright](/guide/glossary#playwright) | ブラウザを自動で操作する道具 | 決まった手順で動くロボット店員 | `tools/e2e.sh` |
| [画面比較](/guide/glossary#visual-regression) | 基準画像と今の画面を機械で重ねる | 昨日と今日の売り場の写真を重ねる | `67959 pixels (ratio 0.04 of all image pixels) are different` |
| [回帰テスト](/guide/glossary#regression-test) | 前に直した所が、また壊れていないかを確かめる | 直した箇所の再点検 | 認可の穴が戻っていないか(authz) |
| 役割で探す | ボタン・見出しといった役割と文字で部品を探す | 「レジ」と書かれた窓口を探す | `getByRole('heading', ...)` |
| 不安定なテスト(flaky) | 理由もなく落ちたり通ったりするテスト | 気分屋の点検員 | 在庫の変化を隠して防ぐ |

## 6. 設計書ではここに書く

- **[QA 方式 4.2 E2E テスト](/design/architecture/06-qa#s4-2)・[4.3 画面比較](/design/architecture/06-qa#s4-3)**: 必ず通す導線、画面比較の対象、許す違いの大きさ(何画素まで)。
- **[QA 方式 4.4 守りの確認](/design/architecture/06-qa#s4-4)**: 「2 人の会員で互いのデータを読みに行く」を試験に入れる。
- **[D-QA-04 4.1 確かめ方の決まり](/design/detail/D-QA-04-e2e#s4-1)・[4.2 画面比較の決まり](/design/detail/D-QA-04-e2e#s4-2)**: 部品の探し方(役割と文字)、待ち方(見えるまで待つ)、毎回変わる部分の隠し方。

## 7. レビューで聞く質問

- 「E2E で必ず通す導線はどれですか。決済や注文まで含みますか。」
- 「他人のデータが見えないこと(認可)は、試験に入っていますか。」
- 「画面比較で許す違いは何画素までですか。その数字はどう決めましたか。」
- 「毎回変わる部分(時刻・在庫・広告)は、どうやって比較から外していますか。」
- 「テストが理由もなく落ちる(不安定)とき、どう扱いますか。無視する運用になっていませんか。」

## 8. 片付け

CSS とキャッシュが元に戻っているか確かめます。

```bash
git status --short apps/web/src/styles.css 2>/dev/null   # 何も出なければ元通り(git で取ってきた場合)
tools/chaos.sh status                                    # idorBug が false ならよい
docker compose exec -T cdn-waf printenv EDGE_CACHE       # on ならよい
```

画面比較の基準画像を撮り直したいときは `tools/e2e.sh --update-snapshots` です(意図した見た目の変更のときだけ)。
