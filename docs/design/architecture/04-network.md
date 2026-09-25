# ネットワーク方式設計書(ラボ)

版: 1.0 / 親: [全体方式](/design/architecture/00-overall) / 対象: edge(nginx)の振り分け・キャッシュ・IP 制限

::: tip 3 行まとめ(この文書で決めたこと)
- 入口は edge の 1 か所。`/api/` と `/admin/` は api へ、それ以外は web へ振り分ける。
- 商品一覧・商品詳細の HTML と `GET /api/products*` を 30 秒ためる。**ログインの印(Authorization か Cookie)を持つ人の応答はためない**。
- `/admin/` は内部のネットワークからだけ通す。画面と API を同じオリジンにまとめ、CORS は開けない。
:::

## 0. 位置づけ {#s0}
全体方式の「利用者の通り道は edge の 1 か所だけ」を具体化します。守りの部分(WAF・レート制限・ヘッダ)は [セキュリティ方式](/design/architecture/10-security) が決めます。
配下: [D-NW-01 edge の経路とキャッシュ](/design/detail/D-NW-01-edge-route)。

## 1. 目的と範囲 {#s1}
- **含む**: 振り分け、キャッシュ(ためる物・ためない物・時間)、管理画面の IP 制限、CORS、タイムアウト、見守り用の口の隠し方。
- **含まない**: DNS、HTTPS の証明書、キャッシュの手動消去(現場では要る。[必要なこと一覧](/guide/checklist) 32・35)。

## 2. 前提 {#s2}
| 前提 | 内容 |
| --- | --- |
| 入口 | ホストの 18080 → edge の 8080 |
| 内部のネットワーク | Docker のネットワークを `172.30.89.0/24` に固定(ゲートウェイ `172.30.89.1`) |
| 名前の解決 | edge は Docker の DNS(`127.0.0.11`)で api・web の住所をリクエストのたびに調べる(10 秒有効)。web が未起動でも edge は起動でき、その間は 502 |

## 3. 全体像 {#s3}
| URL | 行き先 | キャッシュ | 特別な扱い |
| --- | --- | --- | --- |
| `/edge-healthz` | edge 自身 | — | 生存確認用に `ok` を返す |
| `/admin/` | api:3001 | しない | 127.0.0.1 と `172.30.89.0/24` だけ通す(`172.30.89.1` は拒否) |
| `/metrics` | web:4000 | しない | 127.0.0.1 だけ(外に見せない) |
| `/api/login` | api:3001 | しない | 1 秒 1 回(バースト 5)のレート制限 |
| `/api/products…` | api:3001 | **30 秒** | — |
| `/api/…`(その他) | api:3001 | しない | — |
| `/products`・`/products/数字` | web:4000 | **30 秒** | — |
| それ以外 | web:4000 | しない | — |

## 4. 決定事項 {#s4}
### 4.1 振り分け {#s4-1}
| 項目 | 内容 |
| --- | --- |
| 決定 | 上の表のとおり、URL の先頭で振り分ける。リクエストごとに `X-Request-Id` を付けて奥へ渡す |
| 理由 | 1 つの入口で守りと高速化をまとめる。`X-Request-Id` で edge と api のログをつなげる |
| 実物 | [default.conf.template](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/edge/default.conf.template#L99-L144) |

### 4.2 キャッシュ {#s4-2}
| 項目 | 内容 |
| --- | --- |
| 決定 | 状態 200 の応答を 30 秒ためる(`proxy_cache_valid 200 30s`)。対象は GET と HEAD だけ。ためる場所は 100MB まで、10 分使われなければ捨てる。同じ物を同時に頼まれたら、奥に取りに行くのは 1 回だけ(`proxy_cache_lock on`)。ON / OFF は環境変数 `EDGE_CACHE` の 1 か所で切り替える |
| 理由 | 商品の情報は数十秒古くても困らない。30 秒でも、1 秒に 100 回見られる画面なら奥へ行くのは 30 秒に 1 回になる |
| 却下した案 | 長くためる(10 分など): 価格や在庫の訂正がなかなか反映されない。ためない: セールの開始と同時にアプリが落ちる |
| 実物 | [default.conf.template](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/edge/default.conf.template#L23-L31)・[同 L81-L90](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/edge/default.conf.template#L81-L90) |

### 4.3 ためてはいけない物 {#s4-3}
| 項目 | 内容 |
| --- | --- |
| 決定 | `Authorization` か `Cookie` のヘッダがあるリクエストは、キャッシュを使わず(`BYPASS`)、応答もためない。アプリが `Cache-Control: no-store` を付けた応答(SSR をあきらめた空の HTML)もためない |
| 理由 | ログイン中の人専用の画面をためると、次に来た人にその人の画面を見せてしまう。空の HTML をためると、API が直ったあとも 30 秒間 空の画面が配られる |
| 却下した案 | URL だけで判断する: 同じ URL でも人によって中身が違う画面がある |
| 実物 | [default.conf.template](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/edge/default.conf.template#L33-L38) |

### 4.4 管理画面の IP 制限 {#s4-4}
| 項目 | 内容 |
| --- | --- |
| 決定 | `/admin/` は 127.0.0.1 と `172.30.89.0/24` だけを通し、それ以外は 403。ホスト PC のブラウザから来た通信が見える `172.30.89.1` は拒否する。壊すスイッチは api のコンテナの中から呼ぶ(`tools/chaos.sh`) |
| 理由 | 管理の入口を外から見えなくする(社内 IP 制限の代わり) |
| 却下した案 | パスワードだけで守る: 入口が見えていれば総当たりされる |
| 実物 | [default.conf.template](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/edge/default.conf.template#L99-L108) |

### 4.5 CORS {#s4-5}
| 項目 | 内容 |
| --- | --- |
| 決定 | 画面と API を同じオリジン(`http://localhost:18080`)から出す。api は CORS のヘッダを返さない = 別のオリジンの画面からは、ブラウザが API の応答を読ませない |
| 理由 | 開ける必要がない物は開けない。「とりあえず全部許可(`*`)」は、偽サイトから会員の API を使われる入口になる |
| 却下した案 | 別オリジンにして CORS で許可する: 許可の一覧の管理が要り、間違えると穴になる |
| 実物 | [apps/api/src/server.js](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/apps/api/src/server.js)(CORS の設定が無いこと自体が決定) |

### 4.6 タイムアウトと見守り用の口 {#s4-6}
| 項目 | 内容 |
| --- | --- |
| 決定 | 奥への接続は 3 秒、応答の読み取りは 30 秒まで待つ。web の `/metrics` は edge の外に出さない(Prometheus は web:4000 を直接見る) |
| 理由 | 奥が固まったときに edge の手まで全部ふさがらないようにする。指標には内部の情報が含まれる |
| 実物 | [default.conf.template](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/edge/default.conf.template#L71-L79) |

## 5. 目標 {#s5}
| 項目 | 目標 | 計算・根拠 |
| --- | --- | --- |
| キャッシュで奥へ行く回数 | 1 URL あたり 30 秒に 1 回 | 1 秒 100 回見られる画面なら 100 × 30 = 3,000 回 → 1 回(残りは HIT) |
| ログイン中の人の応答をためる件数 | 0 | `X-Cache-Status: BYPASS` で確かめる |
| 外から `/admin/` に届く件数 | 0(すべて 403) | `curl http://localhost:18080/admin/chaos` |

## 6. 配下の詳細設計書 {#s6}
- [D-NW-01 edge の経路とキャッシュ](/design/detail/D-NW-01-edge-route)

## 7. 未決事項 {#s7}
| # | 内容 |
| --- | --- |
| 1 | キャッシュを手で消す手順(価格の訂正時)。ラボでは 30 秒待てば消える |
| 2 | 画像などの静的ファイルを edge でもためるか(今は web が `Cache-Control` 1 年で返すだけ) |

## 8. レビュー観点 {#s8}
- [ ] 「ためてはいけない物」(ログイン中・本人だけの画面・エラーや空の画面)が列挙されているか
- [ ] キャッシュの時間に理由があるか(価格の訂正がどれだけ遅れてよいか)
- [ ] 管理の入口が外から見えないか
- [ ] CORS を `*` にしていないか
- [ ] 奥への待ち時間に上限があるか

## この設計を体験する演習 {#exercises}
- [ネットワーク-1 前段のキャッシュ](/exercises/07-nw-cache)
- [ネットワーク-2 CORS と IP 制限](/exercises/08-nw-cors-and-ip)
