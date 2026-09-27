---
title: FE-3 遅延読み込みと JS の予算
---

# FE-3 遅延読み込みと JS の予算

::: info この演習について
- 所要時間: 約 20 分(ビルド 1 回 20 秒ほど × 3 回)
- 使うもの: 軽量版(docker compose)。Docker でのビルド、ブラウザの開発者ツール
- 仕組みはこちら: [仕組み-4 storefront の SSR](/how-it-works/04-storefront-ssr)
- 関係する設計書: [FE 方式](/design/architecture/01-frontend)・[性能方式](/design/architecture/07-performance)
- 用語集: [遅延読み込み](/guide/glossary#lazy-loading)・[チャンク](/guide/glossary#chunk)・[JS の予算(budgets)](/guide/glossary#budgets)
:::

## 1. この設計書はなぜ必要か

画面の JavaScript(JS)は、機能を足すたびに少しずつ太ります。1 回 1 回は小さくても、誰も量っていなければ気づきません。

> **よくある事故**: 半年間、毎月のリリースで「便利なライブラリ」を 1 つずつ足してきました。
> ある日、営業から「スマホで開くと最初の画面まで 6 秒かかる。お客様がどんどん帰っている」と言われます。
> 調べると、最初に読み込む JS が 3 倍になっていました。どのリリースで太ったのかも、もう分かりません。

「最初に読み込む JS はここまで」という **予算** を決め、超えたらビルド(部品を組み上げる作業)そのものを失敗させる。
そして、すぐには要らない画面は **遅延読み込み** にして、最初の JS から外す。この 2 つを方式設計書で決めておきます。

## 2. 何をやっているのか

storefront は、注文履歴(`/my-account/orders`)の部品を「その画面を開いたときに初めて読み込む別ファイル(チャンク)」にしています(`apps/web/src/app/app.routes.ts` の `loadChildren`)。
また `apps/web/angular.json` の `budgets` に「最初に読み込む JS と CSS の合計は 400kB で警告、450kB でビルド失敗」と書いてあります。
演習では、①ビルドの結果で大きさを見る、②予算をわざと下げてビルドが落ちるのを見る、③遅延読み込みをやめると最初の JS が増えるのを見る、④ブラウザで注文履歴を開いた瞬間にチャンクが届くのを見る、の順に進みます。

たとえ: **遅延読み込みは「旅行の荷物のうち、現地で必要になった物だけ後から宅配便で送ってもらう」** ことです。最初に持つ荷物(最初の JS)が軽いほど、早く出発(表示)できます。
**予算は「機内持ち込みは 7kg まで」の決まり** です。量りに載せて超えていたら、その場で搭乗(リリース)できません。

::: tip CCv2 では
Composable Storefront の案件でも、画面の機能(部品)を足すほど JS は太ります。CCv2 のビルドは storefront の `package.json` の `build`(SSR なら `build:ssr`)を動かし、その中身はふつう `ng build` なので、
`angular.json` の budgets で失敗すれば、Cloud Portal のビルドも失敗します(= 太った版は配られない)。予算は「ビルドの関所」として働きます。
:::

## 3. まず触ってみる

1. **いまの大きさを量る**。storefront のイメージの「ビルドの段」だけを動かします(動いているお店は止まりません)。

   ```bash
   docker build --target build --progress=plain --no-cache-filter build apps/web 2>&1 | grep -A8 'Initial chunk files'
   ```

   `Initial`(最初に読む物)と `Lazy`(後から読む物)に分かれて表示されます。
   実際の表示は各行の頭に `#10 5.352` のようなビルドの段の番号と経過秒が付きます(下の「何が見えたら成功か」では省いています)。後ろに `server.mjs` などサーバー用の一覧も続きますが、ここではブラウザ用(最初の一覧)だけを見ます。
   `--no-cache-filter build` は「前に同じ中身でビルドしたことがあっても、ビルドの段をやり直す」指定です。これが無いと、2 回目以降はビルドが省かれ(`CACHED`)、何も表示されません。

2. **予算をわざと下げて、ビルドを落とす**。`apps/web/angular.json` の `"maximumError": "450kB"` を `"300kB"` に書き換えます(エディタで直しても、次のコマンドでも同じです)。

   ```bash
   cp apps/web/angular.json /tmp/angular.json.bak
   sed -i.tmp 's/"maximumError": "450kB"/"maximumError": "300kB"/' apps/web/angular.json && rm apps/web/angular.json.tmp
   docker build --target build --progress=plain apps/web 2>&1 | grep -E 'Initial total|ERROR'
   ```

   終わったら、すぐに元に戻します。

   ```bash
   cp /tmp/angular.json.bak apps/web/angular.json
   grep -n '"maximumError": "450kB"' apps/web/angular.json    # 1 行出ればよい
   ```

3. **遅延読み込みをやめてみる**。`apps/web/src/app/app.routes.ts` を次のように変えます(変える前にコピーを取ります)。

   ```bash
   cp apps/web/src/app/app.routes.ts /tmp/app.routes.ts.bak
   ```

   ```diff
    import { NotFoundPage } from './pages/not-found';
   +import { ORDER_ROUTES } from './my-account/orders.routes';
   ...
        path: 'my-account/orders',
   -    loadChildren: () => import('./my-account/orders.routes').then((m) => m.ORDER_ROUTES),
   +    children: ORDER_ROUTES,
   ```

   ```bash
   docker build --target build --progress=plain --no-cache-filter build apps/web 2>&1 | grep -A6 'Initial chunk files'
   cp /tmp/app.routes.ts.bak apps/web/src/app/app.routes.ts    # 必ず元に戻す
   ```

4. **ブラウザでチャンクが届く瞬間を見る**。http://www.lab.localhost:18080/ を開き、開発者ツール(F12、Mac は option+command+I)の「ネットワーク」タブで「JS」に絞ります。
   画面上の「注文履歴」をクリックすると、その瞬間に `chunk-` で始まる小さなファイルが 1 つ増えます(ログインしていなければ「注文履歴を見るには ログイン してください。」と出ますが、チャンクは読み込まれます)。
   開発者ツールの「コンソール」に次を貼っても、読み込んだ JS の一覧が見られます。クリックの前と後で比べます。
   Chrome で初めてコンソールに貼ると、貼り付けについての警告が出て、貼れないことがあります。そのときは、コンソールに `allow pasting`(Chrome の表示が日本語なら `貼り付けを許可`)と手で打って Enter を押してから、もう一度貼ります。

   ```js
   performance.getEntriesByType('resource').filter(e => e.name.endsWith('.js')).map(e => e.name.split('/').pop())
   ```

## 4. 何が見えたら成功か

**手順 1**: 最初に読む物は合計 約 336kB(通信では圧縮されて約 93kB)。注文履歴は 5.6kB の別ファイルです。

```text
Initial chunk files  | Names                    |  Raw size | Estimated transfer size
chunk-MLVPJDFE.js    | -                        | 309.95 kB |                85.91 kB
main-CFZS6IQK.js     | main                     |  21.53 kB |                 5.97 kB
styles-CTOKCG3W.css  | styles                   |   4.84 kB |                 1.24 kB

                     | Initial total            | 336.32 kB |                93.12 kB

Lazy chunk files     | Names                    |  Raw size | Estimated transfer size
chunk-6ORWLTRG.js    | orders-routes            |   5.61 kB |                 1.78 kB
```

(ファイル名の英数字の部分と、数 kB の大きさは、ビルドのたびや版によって変わります。)

**手順 2**: 予算 300kB を 36.32kB 超えたので、ビルドが止まりイメージが作られません。

```text
                     | Initial total            | 336.32 kB |                93.12 kB
✘ [ERROR] bundle initial exceeded maximum budget. Budget 300.00 kB was not met by 36.32 kB with a total of 336.32 kB.
ERROR: process "/bin/sh -c npx ng build --configuration production" did not complete successfully: exit code: 1
```

(実際には、この後に同じ意味のまとめの行(`ERROR: failed to build: …`)がもう 2 行続きます。)

**手順 3**: `Lazy chunk files` の欄が消え、注文履歴の部品が最初の JS(`main`)に混ざって、合計が約 4kB 増えます。

```text
Initial chunk files  | Names                    |  Raw size | Estimated transfer size
main-HBBLQ6BE.js     | main                     | 335.85 kB |                91.84 kB
styles-CTOKCG3W.css  | styles                   |   4.84 kB |                 1.24 kB

                     | Initial total            | 340.69 kB |                93.08 kB
```

この演習の注文履歴は小さいので差は 4kB ですが、グラフや地図、リッチな入力欄などの大きな部品では、ここが 100kB 単位で変わります。

**手順 4**: 注文履歴をクリックする前と後で、読み込んだ JS が 1 つ増えます。

```text
クリック前: chunk-MLVPJDFE.js, main-….js
クリック後: chunk-MLVPJDFE.js, main-….js, chunk-6ORWLTRG.js   ← orders-routes のチャンク
```

## 5. ここで覚える言葉

| 言葉 | 一言でいうと | たとえ | この演習で見たもの |
| --- | --- | --- | --- |
| バンドル | ブラウザに送るためにまとめた JS のファイル | 旅行かばんに詰めた荷物 | `main-….js`、`chunk-….js` |
| 初期読み込み(Initial) | 最初の画面を出すために必ず読む JS | 出発時に持つ荷物 | `Initial total 336.32 kB` |
| [遅延読み込み](/guide/glossary#lazy-loading) | その画面を開いたときに初めて読む | 現地で必要になった物を後から宅配 | `orders-routes` の 5.6kB のチャンク |
| [チャンク](/guide/glossary#chunk) | 分けて作った JS の 1 かたまり | 宅配便の 1 箱 | 注文履歴を開いたときに届いた `chunk-….js` |
| [JS の予算(budgets)](/guide/glossary#budgets) | 大きさの上限。超えたらビルドを落とす | 機内持ち込みは 7kg まで | `bundle initial exceeded maximum budget` |
| 転送サイズ | 通信で実際に送る大きさ(圧縮後) | 圧縮袋に入れた後の体積 | `Estimated transfer size 93.12 kB` |

## 6. 設計書ではここに書く

- **[FE 方式 4.4 遅延読み込みと JS の予算](/design/architecture/01-frontend#s4-4)**:
  「ログインが要る画面(注文履歴など)と、使う人が少ない画面は遅延読み込みにする」「大きなライブラリはトップ・商品詳細・検索から import しない」「最初に読む JS と CSS の合計は 400kB で警告、450kB でビルド失敗」「予算を上げるときは理由を書いてレビューを通す」。
- **[性能方式 4.3 最初に読む JS を抑える](/design/architecture/07-performance#s4-3)**: 予算の数字はビルドの `Initial total`(圧縮前)で測る、と測る物差しをそろえておきます。
- **[FE 方式 5 目標](/design/architecture/01-frontend#s5)**: 予算の数字そのもの。
- **[D-FE-04 商品詳細画面](/design/detail/D-FE-04-product-detail)** のような画面ごとの設計書には、その画面が最初の JS に入るか遅延読み込みかを 1 行書きます。

## 7. レビューで聞く質問

- 「この変更で、最初に読み込む JS は何 kB 増えましたか。ビルドの `Initial total` の前後の数字を貼ってください。」
- 「新しく足したライブラリは、どの画面で使いますか。その画面は遅延読み込みになっていますか。」
- 「予算(budgets)を上げていませんか。上げたなら、代わりに何をあきらめる判断ですか。」
- 「予算を超えたとき、CI(自動のビルド)は本当に失敗しますか。警告だけで通っていませんか。」
- 「遅延読み込みにした画面を開いたとき、読み込み中の表示や失敗したときの表示はありますか。」

## 8. 片付け

書き換えた 2 つのファイルが元に戻っているか確かめます(戻っていれば「元に戻っています」とだけ表示されます。違いがあると、その行が表示されます)。

```bash
diff /tmp/angular.json.bak apps/web/angular.json && diff /tmp/app.routes.ts.bak apps/web/src/app/app.routes.ts && echo 元に戻っています
rm -f /tmp/angular.json.bak /tmp/app.routes.ts.bak
```

演習のビルドはイメージに名前を付けていないので、動いている storefront には影響しません。ビルドの途中の物を消したいときは `docker builder prune` です(ほかのビルドの途中の物も消えるので注意)。
