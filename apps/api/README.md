# api(サンプルストアの API)

商品・ログイン・注文を返す API です。Node.js 24 + Express 5 + PostgreSQL。
**わざと壊すスイッチ(カオス)** が付いていて、遅延・エラー・メモリ不足・認可の穴・SQL インジェクションの穴を、演習の中で起こせます。

## エンドポイント

| メソッドとパス | 中身 | ログインが必要か |
|---|---|---|
| `GET /api/products` | 商品の一覧(`?q=` で名前を検索) | 不要 |
| `GET /api/products/:id` | 商品 1 件。無ければ 404 | 不要 |
| `POST /api/login` | `{"username","password"}` を受け、JWT(有効 15 分)を返す | 不要 |
| `GET /api/me/orders` | 自分の注文の一覧 | 必要(`Authorization: Bearer <JWT>`) |
| `GET /api/orders/:orderId` | 注文 1 件。自分の注文でなければ 404 | 必要 |
| `GET /healthz` | 生きているか(プロセスが動いていれば 200) | 不要 |
| `GET /readyz` | 準備できているか(DB に届けば 200、届かなければ 503) | 不要 |
| `GET /metrics` | Prometheus 用の指標(`http_requests_total`、`http_request_duration_seconds`、`lab_chaos_setting` など) | 不要(edge が外から見えないようにしている) |
| `GET /admin/chaos` | カオススイッチの今の値 | 不要(edge が社内 IP 以外を 403 にする) |
| `POST /admin/chaos` | カオススイッチを変える(`{"latencyMs":1000}` のように一部だけ送れる) | 同上 |

見本の会員は `alice` / `bob` / `carol`(パスワードはどれも `password`)。商品は 30 件、注文は各会員に 2〜3 件あります(起動時に作ります)。

## カオススイッチ(わざと壊す)

| スイッチ | 環境変数 | 何が起きるか | 使う演習 |
|---|---|---|---|
| `latencyMs` | `CHAOS_LATENCY_MS` | 全 API に遅延を足す | 障害-1(API が遅い → SSR が逃げる) |
| `errorRate` | `CHAOS_ERROR_RATE` | 0〜1 の割合で 500 を返す | SRE-2(エラーバジェットとアラート) |
| `leakMb` | `CHAOS_LEAK_MB` | リクエストのたびにメモリを溜め、最後は落ちる | 障害-2(メモリ不足で再起動を繰り返す) |
| `idorBug` | `CHAOS_IDOR_BUG` | 注文の持ち主を確かめない(他人の注文が見える) | BE-1(API と認可の事故) |
| `sqliBug` | `CHAOS_SQLI_BUG` | 検索語を文字列連結で SQL に入れる(SQL インジェクションの穴) | セキュリティ-1(WAF が攻撃を止める) |

変え方(軽量版): リポジトリ直下で `tools/chaos.sh` を使います。本格版は `k8s/chaos.sh` です。
スイッチは api を再起動すると、環境変数の値(既定はすべて「壊さない」)に戻ります。

## そのほかの環境変数

| 環境変数 | 既定 | 中身 |
|---|---|---|
| `PORT` | 3001 | 待ち受けるポート |
| `JWT_SECRET` | ラボ用の固定値(compose で指定) | JWT の署名の鍵。**本番では必ずシークレットの置き場所から渡す** |
| `PGHOST` / `PGPORT` / `PGDATABASE` / `PGUSER` / `PGPASSWORD` | compose で指定 | PostgreSQL の接続先 |
| `PG_POOL_MAX` | 10 | DB への接続の数の上限 |
| `LOG_LEVEL` | info | ログの細かさ(JSON で標準出力) |

## ファイル

- `src/server.js` … 画面の入口(ルートの定義、ログイン、注文の認可)
- `src/db.js` … DB の接続、表の作成、見本データ(DB が止まってもプロセスが落ちないよう、接続の 'error' を拾っています)
- `src/chaos.js` … カオススイッチ
- `src/metrics.js` … Prometheus の指標

関係する設計書: [BE 方式](../../docs/design/architecture/02-backend.md)、[D-BE 注文 API と認可](../../docs/design/detail/D-BE-orders-api.md)。
