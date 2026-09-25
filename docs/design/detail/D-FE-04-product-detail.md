# D-FE-04 商品詳細画面

版: 1.0 / 親: [FE 方式](/design/architecture/01-frontend) / 対象: `/products/:id`

::: tip 3 行まとめ(この文書で決めたこと)
- 商品詳細は SSR で描き、`GET /api/products/:id` の結果を HTML と一緒にブラウザへ申し送る(ブラウザは同じ API を呼び直さない)。
- 表示するのは商品名・価格・在庫・説明・商品番号。読み込み中・エラー・表示の 3 つの状態を持つ。
- edge で 30 秒ためる画面なので、**人によって変わる物(ログイン名など)を中身に入れない**。
:::

## 0. 親の方式設計書 {#s0}
| 項目 | 内容 |
| --- | --- |
| 親 | [FE 方式](/design/architecture/01-frontend) |
| 引き継ぐ決定 | 4.1 描画方式(毎回 SSR)、4.3 SSR の打ち切り 3000ms、4.5 本人だけのデータは申し送らない |
| またがる層 | [ネットワーク方式 4.2](/design/architecture/04-network#s4-2)(この画面は 30 秒ためる)、[BE 方式](/design/architecture/02-backend)(商品 API) |

## 1. 目的と範囲 {#s1}
- **目的**: 利用者が商品を選ぶための情報を出す。検索エンジンにも中身を見せる。
- **含む**: 表示項目、状態、API の呼び方、SSR とキャッシュの注意。
- **含まない**: カートへの追加(ラボには無い)。

## 2. 前提 {#s2}
| 前提 | 内容 |
| --- | --- |
| URL | `/products/:id`(`:id` は商品番号。見本は 1〜30) |
| 部品 | [product-detail.ts](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/apps/web/src/app/pages/product-detail.ts)(`ProductDetailPage`) |
| ルート | [app.routes.ts](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/apps/web/src/app/app.routes.ts#L11)(最初の JS に入る。遅延読み込みしない) |

## 3. 全体像 {#s3}
```text
ブラウザ ─▶ edge(/products/数字 は 30 秒ためる)─▶ web(SSR)
  web: ProductDetailPage ─ ApiService.getProduct(id) ─▶ http://api:3001/api/products/:id
        結果を TransferState(申し送り)に入れて HTML に添える
ブラウザ: ハイドレーション。申し送りがあれば API を呼ばずに使う(1 回だけ)
```

## 4. 仕様 {#s4}
### 4.1 表示項目 {#s4-1}
| 項目 | API の項目 | 表示 | 無いとき |
| --- | --- | --- | --- |
| 商品名 | `name` | 見出し(h1) | — |
| 価格 | `price` | 3 桁区切り + 「円」 | — |
| 在庫 | `stock` | 1 以上: 「在庫: N 個」/ 0: 「在庫なし」の印 | 在庫の行を出さない |
| 説明 | `description` | 段落 | 出さない |
| 画像 | `imageUrl` | 480 × 300 | 「画像なし」の枠 |
| 商品番号 | `id` | 「商品番号: N」 | — |

### 4.2 状態 {#s4-2}
| 状態 | 表示 |
| --- | --- |
| 読み込み中 | 「読み込み中…」 |
| エラー | 「商品を表示できませんでした。」+ 状態コードごとの短い説明(404: 見つかりませんでした、429: アクセスが多すぎます、5xx: サーバーで問題が起きました) |
| 表示 | 4.1 の項目 |

実物: [product-detail.ts](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/apps/web/src/app/pages/product-detail.ts#L10-L44)・[describeError](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/apps/web/src/app/core/api.service.ts#L55-L64)

### 4.3 API の呼び方 {#s4-3}
| 項目 | 内容 |
| --- | --- |
| 呼ぶ API | `GET /api/products/:id`(ID を URL 用に変換して付ける) |
| 呼び先 | サーバーでは `http://api:3001`、ブラウザでは同じオリジンの `/api`(interceptor が付け替える) |
| 申し送り | サーバーで取った結果を `api:product:<id>` の名前で TransferState に入れる。ブラウザは最初の 1 回だけそれを使い、使ったら消す |
| 実物 | [api.service.ts](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/apps/web/src/app/core/api.service.ts#L23-L52)・[api-base.interceptor.ts](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/apps/web/src/app/core/api-base.interceptor.ts) |

### 4.4 SSR とキャッシュの注意 {#s4-4}
| 項目 | 内容 |
| --- | --- |
| キャッシュ | edge が HTML を 30 秒ためる。だから中身に人ごとの情報を入れない。ログインの印は Authorization ヘッダで送るので、この画面の HTML のリクエストには付かない |
| 打ち切り | API が遅く SSR が 3000ms を超えると、空の HTML が返る(`X-Render-Mode: fallback`)。空の HTML はためない |
| 書き方 | この部品では `window` などブラウザだけの物を触らない |

## 5. 目標と確認方法 {#s5}
| 項目 | 目標 | 確かめ方 |
| --- | --- | --- |
| SSR | HTML に商品名が入っている | `curl -s http://localhost:18080/products/1` に商品名が含まれる |
| 描画モード | `ssr` | 応答ヘッダ `X-Render-Mode: ssr`、画面の一番下の「描画モード」 |
| キャッシュ | 2 回目は `HIT` | `curl -I` を 2 回。`X-Cache-Status: MISS` → `HIT` |
| API の呼び直し | 最初の表示で `/api/products/1` をブラウザが呼ばない | ブラウザの開発者ツールのネットワーク |

## 6. 関連する文書 {#s6}
- [D-FE-22 SSR サーバー](/design/detail/D-FE-22-ssr-server)(打ち切りとフォールバック)
- [D-NW-01 edge の経路とキャッシュ](/design/detail/D-NW-01-edge-route)

## 7. 未決事項 {#s7}
| # | 内容 |
| --- | --- |
| 1 | 存在しない商品のとき、画面は「見つかりませんでした」と出すが、HTML の状態コードは 200 のまま。検索エンジン向けに 404 を返すか |
| 2 | 画像の実物(今は見本データに画像が無く、「画像なし」の枠) |

## 8. レビュー観点 {#s8}
- [ ] キャッシュされる画面に、人ごとの情報が入っていないか
- [ ] サーバーで取った結果を申し送り、ブラウザで二重に呼んでいないか
- [ ] エラーのときに真っ白にならず、次の行動が分かる文が出るか
- [ ] 値が無い項目で画面が壊れないか

## この設計を体験する演習 {#exercises}
- [FE-1 SSR と CSR を見比べる](/exercises/01-fe-ssr-vs-csr)
- [ネットワーク-1 前段のキャッシュ](/exercises/07-nw-cache)
