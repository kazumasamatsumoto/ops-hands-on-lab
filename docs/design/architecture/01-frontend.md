# FE 方式設計書(ラボ)

版: 1.0 / 親: [全体方式](/design/architecture/00-overall) / 対象: web(Angular 21 SSR)

::: tip 3 行まとめ(この文書で決めたこと)
- 画面は毎回サーバーで作る(SSR)。比べるために `RENDER_MODE=csr` でブラウザ描画(CSR)にも切り替えられる。
- SSR は 3000ms で打ち切り、間に合わなければ空の HTML を返してブラウザに任せる(真っ白にしない)。
- 最初に読む JS・CSS は 450kB を超えたらビルドを失敗させる。注文履歴は後から読み込む。
:::

## 0. 位置づけ {#s0}
全体方式の「利用者の通り道は edge の 1 か所」「設定は環境変数」を受けて、画面の作り方を決めます。
配下: [D-FE-04 商品詳細画面](/design/detail/D-FE-04-product-detail)、[D-FE-22 SSR サーバー](/design/detail/D-FE-22-ssr-server)。

## 1. 目的と範囲 {#s1}
- **含む**: 画面の一覧、描画方式(SSR / CSR)、SSR で守る書き方、SSR の待ち時間と逃げ道、JS の予算と遅延読み込み、ログインの印の置き場所、API の呼び先。
- **含まない**: 画面のデザイン、多言語。

画面は 6 つです: `/`(トップ)、`/products`(一覧、`?q=` で検索)、`/products/:id`(詳細)、`/login`、`/me/orders`(注文履歴)、`/me/orders/:orderId`(注文の詳細)。

## 2. 前提 {#s2}
| 前提 | 内容 |
| --- | --- |
| 部品 | Angular 21(スタンドアロン)、`@angular/ssr`。Express のサーバー(ポート 4000)で配る |
| API | サーバーで描画するときは `http://api:3001` を直接呼ぶ。ブラウザからは同じオリジンの `/api`(edge が振り分ける) |
| Host の確認 | Angular SSR は知らない Host ヘッダを断るので、`localhost`・`127.0.0.1`・`web`・`edge` などを許可する |

## 3. 全体像 {#s3}
```text
ブラウザ ─▶ edge ─▶ web(server.ts)
                     ├─ RENDER_MODE=csr → 空の HTML(殻)を返す → ブラウザが API を呼んで描く
                     └─ RENDER_MODE=ssr → Angular がサーバーで描く(api:3001 を呼ぶ)
                           ├─ 3000ms 以内 → 中身入りの HTML(X-Render-Mode: ssr)
                           ├─ 間に合わない → 空の HTML(X-Render-Mode: fallback)
                           └─ 例外 → 500 の画面(ssr_errors_total が増える)
```

## 4. 決定事項 {#s4}
### 4.1 描画方式 {#s4-1}
| 項目 | 内容 |
| --- | --- |
| 決定 | すべての画面をリクエストのたびにサーバーで描く(`RenderMode.Server`)。環境変数 `RENDER_MODE=csr` で CSR に切り替えられる |
| 理由 | 商品や在庫は変わるので、ビルド時の事前描画はしない。SSR にすると最初の表示が速く、検索エンジンにも中身が見える |
| 却下した案 | CSR だけ: 最初の HTML が空で、JS が動くまで何も見えない。事前描画(ビルド時): 在庫が古くなる |
| 実物 | [app.routes.server.ts](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/apps/web/src/app/app.routes.server.ts)・[server.ts](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/apps/web/src/server.ts#L26-L29) |

### 4.2 SSR で壊れない書き方 {#s4-2}
| 項目 | 内容 |
| --- | --- |
| 決定 | サーバーで動くコードでは `window`・`document`・`sessionStorage` を直接触らない。触るときは `isPlatformBrowser()` で確かめるか、`afterNextRender()` の中で触る |
| 理由 | サーバー(Node.js)には `window` が無く、「window is not defined」で描画が止まり、SSR が 500 になる。開発者の PC(ブラウザ)では動くので気づきにくい |
| 却下した案 | 見つけたら直す: 1 か所でも入ると全画面が 500 になる。規約とレビューで入口で止める |
| 実物 | わざと壊した例: [app.ts](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/apps/web/src/app/app.ts#L19-L25)(`SSR_WINDOW_BUG=true` のときだけ動く) |

### 4.3 SSR のタイムアウトと逃げ道 {#s4-3}
| 項目 | 内容 |
| --- | --- |
| 決定 | SSR は `SSR_TIMEOUT_MS`(既定 3000)で打ち切り、CSR の空の HTML を返す(フォールバック)。そのとき `Cache-Control: no-store` を付けて edge にためさせず、ログに `ssr_fallback` を出し、`ssr_fallback_total` を 1 増やす |
| 理由 | API が遅いと SSR も遅くなり、サーバーの手がふさがって全体が止まる。空の HTML でも、ブラウザが後から画面を作れば利用者は買い物を続けられる |
| 却下した案 | 待ち続ける: 利用者は真っ白な画面で待たされ、web も巻き込まれて落ちる。すぐ 500 を返す: 画面を出せたはずの人まで止める |
| 実物 | [server.ts](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/apps/web/src/server.ts#L183-L225)。詳細は [D-FE-22](/design/detail/D-FE-22-ssr-server) |

### 4.4 遅延読み込みと JS の予算 {#s4-4}
| 項目 | 内容 |
| --- | --- |
| 決定 | 注文履歴(`/me/orders` 以下)は `loadChildren` で後から読む。最初に読む JS・CSS の合計(initial)は 400kB で警告、450kB でビルド失敗。部品 1 つの CSS は 4kB で警告、8kB で失敗 |
| 理由 | 使う人の少ない画面の部品を、全員が最初に読まないようにする。重くなったことに、作った時点で気づく |
| 却下した案 | 予算なし: ライブラリを 1 つ足すたびに少しずつ重くなり、誰も気づかない |
| 実物 | [app.routes.ts](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/apps/web/src/app/app.routes.ts#L13-L18)・[angular.json](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/apps/web/angular.json#L76-L87) |

### 4.5 ログインの印の置き場所 {#s4-5}
| 項目 | 内容 |
| --- | --- |
| 決定 | JWT はメモリに持ち、ブラウザでは `sessionStorage` にも控える(タブを閉じると消える)。`localStorage` には置かない。サーバーでは保存しない。注文のような本人だけのデータは、サーバーからの申し送り(TransferState)に入れない |
| 理由 | `localStorage` はずっと残り、盗まれたときの被害が大きい。サーバーのメモリは全員で共有なので、置くと他人の印が混ざる |
| 却下した案 | Cookie に入れる: edge のキャッシュと WAF の扱いが複雑になる(ラボでは Cookie を使わない) |
| 実物 | [auth.service.ts](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/apps/web/src/app/core/auth.service.ts#L4-L11) |

## 5. 目標 {#s5}
| 項目 | 目標 | 測る場所 |
| --- | --- | --- |
| SSR の打ち切り | 3000ms | `ssr_render_duration_seconds`(ヒストグラム) |
| フォールバック率 | 5 分間で 5% 以下(超えたら警告) | `job:ssr_fallback:ratio_rate5m`。計算式 = フォールバック回数 ÷ SSR を試みた回数 |
| SSR のエラー | 0 件(1 件でも 1 分続けば警告) | `job:ssr_errors:rate5m` |
| 最初に読む JS・CSS | 450kB 以下(ビルドで強制) | `ng build` の結果 |

## 6. 配下の詳細設計書 {#s6}
- [D-FE-04 商品詳細画面](/design/detail/D-FE-04-product-detail)
- [D-FE-22 SSR サーバー(server.ts)](/design/detail/D-FE-22-ssr-server)

## 7. 未決事項 {#s7}
| # | 内容 |
| --- | --- |
| 1 | SSR の打ち切り時間を画面ごとに変えるか(今は全画面 3000ms) |
| 2 | 対応ブラウザと画面幅の一覧(ラボでは決めていない) |

## 8. レビュー観点 {#s8}
- [ ] サーバーで動くコードで `window`・`document` を直接触っていないか
- [ ] SSR の打ち切り時間と、そのとき返す物(空の HTML、キャッシュさせない印)が決まっているか
- [ ] JS の予算がビルドに組み込まれていて、超えたら失敗するか
- [ ] ログインの印を `localStorage` やサーバーの共有メモリに置いていないか
- [ ] 本人だけのデータを、キャッシュや申し送りに載せていないか

## この設計を体験する演習 {#exercises}
- [FE-1 SSR と CSR を見比べる](/exercises/01-fe-ssr-vs-csr)
- [FE-2 SSR で壊れる書き方](/exercises/02-fe-ssr-rules)
- [FE-3 遅延読み込みと JS の予算](/exercises/03-fe-lazy-loading)
- [障害-1 API が遅い → SSR が逃げる](/exercises/14-incident-slow-api)
