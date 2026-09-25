---
title: QA-1 E2E テストと画面比較
---

# QA-1 E2E テストと画面比較

::: info この演習について
- 所要時間: 約 25 分(web の作り直し 2 回を含む)
- 使うもの: 軽量版(docker compose)。`tools/e2e.sh`(Playwright を Docker で動かす。初回はイメージの取得に数分)
- 関係する設計書: [QA 方式 4.2 E2E テスト](/design/architecture/06-qa#s4-2)・[QA 方式 4.3 画面比較](/design/architecture/06-qa#s4-3)・[D-QA-04 E2E テスト](/design/detail/D-QA-04-e2e)
:::

## 1. この設計書はなぜ必要か

リリースのたびに人の手で全画面を確かめるのは、回数が増えるほど無理になります。そして人の目は「いつもと同じだろう」と思った所を見落とします。

> **よくある事故**: 金曜の夕方、商品詳細の見た目を少し整えるだけの修正をリリースしました。担当者は直した画面だけを確かめました。
> ところが、同じ CSS をログイン画面も使っていて、「ログイン」ボタンが画面の外に押し出されていました。
> 土日の 2 日間、新しくログインできたお客様は 1 人もいませんでした。機能のテスト(ボタンを押したら API が呼ばれるか)は、全部合格していたのです。

お客様が必ず通る道(導線)を機械に毎回なぞらせ(E2E テスト)、見た目の変化も機械に見張らせる(画面比較)。何をどこまで確かめるかを、QA の方式設計書で決めます。

## 2. 何をやっているのか

`tools/e2e/` に Playwright(ブラウザを自動で操作する道具)のテストを 3 種類置いてあります。`tools/e2e.sh` が Docker の中でブラウザを動かし、利用者と同じ入口(edge)を通って操作します。

| ファイル | シナリオ | 確かめる物 |
| --- | --- | --- |
| `tests/journey.spec.ts` | トップ → 商品一覧 → 商品詳細 → ログイン(alice)→ 注文履歴 → 注文の詳細 | 見出し、商品名と価格、商品詳細が SSR で出ていること(`X-Render-Mode`)、注文の合計 |
| `tests/authz.spec.ts` | bob でログインし、alice の注文の URL を直接開く | 「見つかりませんでした」と出て、中身が出ないこと |
| `tests/visual.spec.ts` | トップ・商品一覧・商品詳細の画面を撮る | 基準画像との違いが 50 画素以内(画面下の描画モードの表示は隠して比べる) |

演習では、①ふつうに流して全部通る、②CSS を 1 行変えて画面比較だけが落ちる、③認可の穴を開けて認可のテストが落ちる、④元に戻して全部通る、の順に見ます。

たとえ: **E2E テストは「毎朝の開店前に、店員がお客様役になって入口からレジまで一周する」** ことです。
**画面比較は「昨日の売り場の写真と今日の売り場を重ねて、違う所に赤い印を付ける」** ことです。人の目では気づかない小さなずれも、写真を重ねれば一目で分かります。

## 3. まず触ってみる

1. **ふつうに流す**。

   ```bash
   tools/e2e.sh
   ```

   詳しい報告は `tools/e2e/playwright-report/index.html` をブラウザで開くと見られます。

2. **CSS を 1 行だけ変える**。商品詳細の価格の文字を大きくします(「見た目を少し整えるだけ」のつもりの修正のまね)。

   ```bash
   cp apps/web/src/styles.css /tmp/styles.css.bak
   sed -i.tmp 's/^\.price\.large { font-size: 1\.4rem;/.price.large { font-size: 2.4rem;/' apps/web/src/styles.css && rm apps/web/src/styles.css.tmp
   diff /tmp/styles.css.bak apps/web/src/styles.css
   docker compose up -d --build web
   docker compose ps web        # (healthy) を待つ
   sleep 31                     # edge のキャッシュ(30 秒)が切れるのを待つ
   tools/e2e.sh
   ```

3. **差分の画像を見る**。失敗の報告に出てくる `product-detail-diff.png`(`tools/e2e/test-results/` の下)を開くと、違う所が赤く塗られています。
   報告の HTML(`tools/e2e/playwright-report/index.html`)では、基準・今回・差分をスライダーで見比べられます。

4. **CSS を元に戻す**。

   ```bash
   cp /tmp/styles.css.bak apps/web/src/styles.css && rm /tmp/styles.css.bak
   docker compose up -d --build web
   docker compose ps web        # (healthy) を待つ
   ```

5. **認可の穴を開けて、認可のテストだけ流す**。

   ```bash
   tools/chaos.sh set idorBug=true
   tools/e2e.sh tests/authz.spec.ts
   tools/chaos.sh reset
   ```

6. **全部が通ることを確かめる**。

   ```bash
   sleep 31
   tools/e2e.sh
   ```

7. **テストの書き方を読む**。`tools/e2e/tests/journey.spec.ts` を開き、画面の部品を「見出し」「リンク」「ボタン」といった **役割と文字** で探していること、固定の秒数では待たず「見えるまで待つ」書き方になっていることを確かめます。

## 4. 何が見えたら成功か

**手順 1**: 5 本とも通ります(2 秒ほどで終わります)。

```text
Running 5 tests using 1 worker
  ✓  1 [chromium] › tests/authz.spec.ts:7:5 › bob は alice の注文を見られない (300ms)
  ✓  2 [chromium] › tests/journey.spec.ts:6:5 › 一覧 → 詳細 → ログイン → 注文履歴 が最後まで進める (426ms)
  ✓  3 [chromium] › tests/visual.spec.ts:13:7 › 画面比較: top (169ms)
  ✓  4 [chromium] › tests/visual.spec.ts:13:7 › 画面比較: product-list (255ms)
  ✓  5 [chromium] › tests/visual.spec.ts:13:7 › 画面比較: product-detail (146ms)
  5 passed (1.6s)
```

**手順 2**: 導線のテスト(journey)は **通ってしまいます**。価格の文字「330 円」はちゃんと出ているからです。落ちるのは画面比較だけです。

```text
  ✓  2 [chromium] › tests/journey.spec.ts:6:5 › 一覧 → 詳細 → ログイン → 注文履歴 が最後まで進める (458ms)
  ✘  5 [chromium] › tests/visual.spec.ts:13:7 › 画面比較: product-detail (439ms)
    Error: expect(page).toHaveScreenshot(expected) failed
      3017 pixels (ratio 0.01 of all image pixels) are different.
    Expected: tests/visual.spec.ts-snapshots/product-detail-chromium-linux.png
    Received: test-results/visual-画面比較-product-detail-chromium/product-detail-actual.png
    Diff:     test-results/visual-画面比較-product-detail-chromium/product-detail-diff.png
```

**手順 3**: 差分の画像では、価格の「330 円」が 2 つ重なって赤く表示され、その下の在庫・説明・商品番号の行が下にずれたことも赤い線で分かります。

::: tip 許す違いの決め方でテストの効き目が変わる
最初は「画面の 1% までの違いは許す」という設定で試しました。すると、この変更(3,017 画素 = 画面の約 0.3%)は **見逃されて合格** しました。
1280×800 の画面の 1% は約 1 万画素もあるからです。今の設定(`tools/e2e/playwright.config.ts`)は「50 画素まで」にしています。
「どこまでの違いを許すか」も、設計書に書いてレビューする値です。
:::

**手順 5**: 認可の穴を開けると、bob の画面に alice の注文が表示されてしまい、「見つかりませんでした」が出ないので落ちます。

```text
  ✘  1 [chromium] › tests/authz.spec.ts:7:5 › bob は alice の注文を見られない (10.4s)
    Error: expect(locator).toBeVisible() failed
    Locator: getByText('見つかりませんでした')
    Expected: visible
    Timeout: 10000ms
    Error: element(s) not found
```

失敗したときの画面(`test-failed-1.png`)と操作の記録(`trace.zip`)も自動で残ります。

**手順 6**: 戻したら、また 5 本とも通ります。

```text
  5 passed (1.8s)
```

## 5. ここで覚える言葉

| 言葉 | 一言でいうと | たとえ | この演習で見たもの |
| --- | --- | --- | --- |
| E2E テスト | 利用者と同じ操作を、入口から最後まで機械になぞらせる | 開店前に店員がお客様役で一周する | `journey.spec.ts` の 6 つの段階 |
| 回帰テスト(リグレッションテスト) | 前は動いていた物が、変更で壊れていないかを確かめる | 模様替えのあと、全部の扉が開くか確かめる | CSS 変更後に 5 本を流し直した |
| 画面比較(ビジュアルリグレッション) | 基準の画像と今の画像を重ねて違いを探す | 昨日と今日の売り場の写真を重ねる | `3017 pixels ... are different` |
| 基準画像(スナップショット) | 「これが正しい見た目」として保存した画像 | 見本の写真 | `tests/visual.spec.ts-snapshots/*.png` |
| しきい値 | どこまでの違いを許すか | 写真の「ぶれ」をどこまで許すか | 1% では見逃し、50 画素で検出 |
| Playwright | ブラウザを自動で操作するテストの道具 | 疲れないお客様役のロボット | `tools/e2e.sh` |
| フレーキー(不安定)なテスト | 同じ条件なのに通ったり落ちたりするテスト | 日によって答えが変わる検査 | 固定の秒数で待たない書き方で防ぐ |

## 6. 設計書ではここに書く

- **[QA 方式 4.1 テストの種類](/design/architecture/06-qa#s4-1)**: 「正常に動くこと」だけでなく「**見えてはいけない物が見えないこと**(他人の注文など)」も E2E に入れる、と書きます。
- **[QA 方式 4.2 E2E テスト](/design/architecture/06-qa#s4-2)**: どの導線を自動で流すか(買い物の最後まで)、いつ流すか(変更のたび・リリース前)、落ちたらリリースしない。
- **[QA 方式 4.3 画面比較](/design/architecture/06-qa#s4-3)**: 比べる画面、画面の大きさ、隠す部分、**許す違い(50 画素)**、基準画像を撮り直すときの承認の流れ。
- **[D-QA-04 E2E テスト](/design/detail/D-QA-04-e2e)**(一般のカタログでは D-QA-04): シナリオごとの手順と確かめる物の表、使う見本データ、「わざと壊したら落ちること」の確認結果。

## 7. レビューで聞く質問

- 「お客様が買い物を終えるまでの導線は、E2E テストに入っていますか。どこで終わっていますか。」
- 「『他人の注文が見えない』のような、見えてはいけない物を確かめるテストはありますか。」
- 「わざと壊したとき(API のエラー、認可の抜け、SSR の不具合)に、本当にテストが落ちることを確かめましたか。」
- 「画面比較で許す違いはいくつですか。その値で、ボタン 1 つの位置ずれを見つけられますか。」
- 「基準画像を撮り直すのは誰で、誰が承認しますか。」
- 「テストの中で、固定の秒数(3 秒待つ、など)で待っている所はありませんか。」

## 8. 片付け

```bash
tools/chaos.sh reset                                   # idorBug を false に戻す
grep -n 'price.large' apps/web/src/styles.css          # font-size: 1.4rem に戻っていればよい
docker compose ps web                                  # (healthy) ならよい
rm -rf tools/e2e/test-results tools/e2e/playwright-report   # 報告を消す(残しておいてもかまいません)
```

`tools/e2e/node_modules`・`test-results`・`playwright-report` は `.gitignore` でリポジトリに入らないようにしてあります。基準画像(`tests/visual.spec.ts-snapshots/`)はリポジトリに入れて管理します。
