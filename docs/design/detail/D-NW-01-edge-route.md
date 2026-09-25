# D-NW-01 edge の経路とキャッシュ

版: 1.0 / 親: [ネットワーク方式](/design/architecture/04-network) / 対象: [edge/default.conf.template](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/edge/default.conf.template)

::: tip 3 行まとめ(この文書で決めたこと)
- edge の `location` ごとに、行き先・キャッシュ・制限を 1 表にまとめる(下の 4.1)。
- キャッシュは「GET・HEAD の 200 を 30 秒」。鍵は「メソッド + ホスト + URL(`?` 以降も含む)」。Authorization か Cookie があれば使わず、ためもしない。
- 結果は応答ヘッダ `X-Cache-Status`(HIT・MISS・BYPASS・EXPIRED など)と、1 行 1 JSON のアクセスログの `cache` で見る。
:::

## 0. 親の方式設計書 {#s0}
| 項目 | 内容 |
| --- | --- |
| 親 | [ネットワーク方式](/design/architecture/04-network) |
| 引き継ぐ決定 | 4.1 振り分け、4.2 キャッシュ、4.3 ためてはいけない物、4.4 管理画面の IP 制限、4.6 タイムアウト |
| またがる層 | [セキュリティ方式](/design/architecture/10-security)(レート制限・ヘッダ・WAF。詳細は [D-SEC-01](/design/detail/D-SEC-01-waf-and-rate-limit)) |

## 1. 目的と範囲 {#s1}
- **含む**: location の一覧、キャッシュの設定値、奥へ渡すヘッダ、タイムアウト、ログの形、設定の切り替え方。
- **含まない**: WAF のルールとレート制限の値(D-SEC-01)。

## 2. 前提 {#s2}
| 前提 | 内容 |
| --- | --- |
| 設定の読み込み | 起動時に `envsubst` で `${EDGE_CACHE}`・`${EDGE_GLOBAL_RATE}`・`${EDGE_CSP}` が環境変数に置き換わる(小文字の `$host` などは nginx の変数) |
| 名前の解決 | `resolver 127.0.0.11 valid=10s`。行き先を変数に入れ、リクエストのたびに調べる |
| 待ち受け | 8080(ホストの 18080) |

## 3. 全体像 {#s3}
```text
リクエスト
  → WAF(ModSecurity)
  → 全体のレート制限(IP ごと 1 秒 20 回、burst 40)
  → location で振り分け
      = /edge-healthz      → "ok"
      /admin/              → IP 制限 → api
      = /metrics           → 127.0.0.1 のみ → web
      = /api/login         → ログインのレート制限 → api
      /api/products        → キャッシュ → api
      /api/                → api
      ~ ^/products(/数字)?/?$ → キャッシュ → web
      /                    → web
  → 全応答にセキュリティヘッダと X-Cache-Status
```

## 4. 仕様 {#s4}
### 4.1 location の一覧 {#s4-1}
| location | 行き先 | キャッシュ | 制限 | 行 |
| --- | --- | --- | --- | --- |
| `= /edge-healthz` | edge 自身(200 `ok`) | — | ログを出さない | [L92-L97](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/edge/default.conf.template#L92-L97) |
| `/admin/` | `http://api:3001` | — | allow 127.0.0.1 / deny 172.30.89.1 / allow 172.30.89.0/24 / deny all | [L99-L108](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/edge/default.conf.template#L99-L108) |
| `= /metrics` | `http://web:4000` | — | allow 127.0.0.1 / deny all | [L110-L115](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/edge/default.conf.template#L110-L115) |
| `= /api/login` | `http://api:3001` | — | login(1r/s, burst 5)+ 全体 | [L118-L123](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/edge/default.conf.template#L118-L123) |
| `/api/products` | `http://api:3001` | `store_cache` | 全体 | [L125-L129](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/edge/default.conf.template#L125-L129) |
| `/api/` | `http://api:3001` | — | 全体 | [L131-L133](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/edge/default.conf.template#L131-L133) |
| `~ ^/products(/[0-9]+)?/?$` | `http://web:4000` | `store_cache` | 全体 | [L136-L140](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/edge/default.conf.template#L136-L140) |
| `/` | `http://web:4000` | — | 全体 | [L142-L144](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/edge/default.conf.template#L142-L144) |

### 4.2 キャッシュの設定値 {#s4-2}
| 設定 | 値 | 意味 |
| --- | --- | --- |
| `proxy_cache_path` | `/tmp/nginx-cache`、`keys_zone=store_cache:10m`、`max_size=100m`、`inactive=10m` | ためる場所。鍵の帳簿 10MB、中身は 100MB まで、10 分使われなければ捨てる |
| `proxy_cache_key` | `$request_method$host$request_uri` | 同じメソッド・ホスト・URL(`?q=` も含む)なら同じ物 |
| `proxy_cache_valid` | `200 30s` | 状態 200 だけを 30 秒 |
| `proxy_cache_methods` | `GET HEAD` | 読み取りだけ |
| `proxy_cache_bypass` / `proxy_no_cache` | `$cache_disabled $has_credentials` | OFF のとき・ログインの印があるときは使わず、ためない |
| `proxy_cache_lock` | `on` | 同じ物を同時に頼まれたら、奥へは 1 回だけ |
| `EDGE_CACHE` | `on`(既定) | `on` 以外なら全部 OFF。`EDGE_CACHE=off docker compose up -d edge` で切り替え |

アプリが `Cache-Control: no-store` を付けた応答(SSR の空の HTML など)は、nginx の決まりでためない。
実物: [L23-L38](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/edge/default.conf.template#L23-L38)・[L81-L90](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/edge/default.conf.template#L81-L90)

### 4.3 X-Cache-Status の読み方 {#s4-3}
| 値 | 意味 | よく見る場面 |
| --- | --- | --- |
| `MISS` | ためた物が無く、奥へ取りに行った(今回の結果をためた) | 最初の 1 回 |
| `HIT` | ためた物を返した(奥へ行っていない) | 30 秒以内の 2 回目以降 |
| `EXPIRED` | 30 秒を過ぎていたので取り直した | 31 秒後 |
| `BYPASS` | ログインの印があるか、キャッシュが OFF なので使わなかった | Authorization 付き、`EDGE_CACHE=off`、ブラウザに別アプリの Cookie がある |
| (付かない) | キャッシュを使わない場所 | `/api/login`、`/login` など |

### 4.4 奥へ渡すヘッダとタイムアウト {#s4-4}
| 設定 | 値 |
| --- | --- |
| `Host` | 元のまま(`$host`) |
| `X-Real-IP`・`X-Forwarded-For`・`X-Forwarded-Proto` | 送り元の情報 |
| `X-Request-Id` | edge が付ける番号(api のログの `reqId` に入る) |
| `proxy_connect_timeout` | 3 秒 |
| `proxy_read_timeout` | 30 秒 |

実物: [L71-L79](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/edge/default.conf.template#L71-L79)

### 4.5 アクセスログ {#s4-5}
1 行 1 JSON。項目: `time`・`service`(`edge`)・`remote_addr`・`method`・`uri`・`status`・`bytes`・`request_time`・`upstream`・`upstream_status`・`upstream_time`・`cache`・`user_agent`。
実物: [L14-L21](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/edge/default.conf.template#L14-L21)

## 5. 目標と確認方法 {#s5}
| 項目 | 目標 | 確かめ方 |
| --- | --- | --- |
| キャッシュが効く | 2 回目が `HIT` | `curl -sI http://localhost:18080/api/products/1 \| grep -i x-cache` を 2 回 |
| ログイン中はためない | `BYPASS` | `curl -sI -H 'Authorization: Bearer x' http://localhost:18080/api/products/1` |
| 30 秒で切れる | 31 秒後に `EXPIRED` | 30 秒待ってもう一度 |
| 管理の入口 | 外から 403 | `curl -si http://localhost:18080/admin/chaos` |

## 6. 関連する文書 {#s6}
- [D-SEC-01 WAF とレート制限](/design/detail/D-SEC-01-waf-and-rate-limit)
- [D-FE-04 商品詳細画面](/design/detail/D-FE-04-product-detail)(ためられる画面)

## 7. 未決事項 {#s7}
| # | 内容 |
| --- | --- |
| 1 | キャッシュを手で消す口(価格の訂正時)を作るか |
| 2 | Cookie を持つだけで `BYPASS` になるため、ブラウザに別アプリの Cookie があると HIT が見えない。Cookie は使わないので判定から外すか |

## 8. レビュー観点 {#s8}
- [ ] キャッシュの鍵に `?` 以降が入っているか(検索結果が混ざらないか)
- [ ] ログインの印があるときに、使わない・ためないの両方になっているか
- [ ] エラーの応答(5xx)をためていないか(`proxy_cache_valid` が 200 だけか)
- [ ] 管理・見守りの口が外から閉じているか
- [ ] ログに `cache` と `upstream_time` があり、遅いのが edge か奥かを分けられるか

## この設計を体験する演習 {#exercises}
- [ネットワーク-1 前段のキャッシュ](/exercises/07-nw-cache)
- [ネットワーク-2 CORS と IP 制限](/exercises/08-nw-cors-and-ip)
