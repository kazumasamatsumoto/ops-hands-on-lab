---
title: 仕組み-9 検索と Solr(索引と DB の違い)
---

# 仕組み-9 検索と Solr(索引と DB の違い)

::: tip このページで分かること
- 検索を DB で探す(軽量版)ことと、Solr の索引で探す(本格版)ことの違い。
- 日本語を「2 文字ずつ重ねて切る」CJK バイグラムの仕組み。
- worker が 60 秒ごとに索引を作り直す流れと、そのために起きる「反映の遅れ」。
- Solr が止まったとき、何が壊れて何が動き続けるか。
:::

## 1. 一言でいうと {#s1}

検索には 2 つのやり方があります。**DB の中を 1 行ずつ探す** か、**あらかじめ作っておいた索引(インデックス)を引く** かです。
軽量版は前者(PostgreSQL の `ILIKE`)、本格版は後者(Solr)です。どちらでも、api が返す JSON の形は同じです。

**たとえ: 本の中から言葉を探す**

- DB の `ILIKE` … 本文を 1 ページ目から順にめくって探す。本が薄ければ(商品 30 件)十分速い。
- Solr の索引 … 本の最後の「索引」を引いて、何ページにあるかをすぐ見つける。本が厚くても速い。
- ただし索引は **自動では新しくならない**。本文を書き直したら、索引も作り直す係(worker)が要る。作り直すまでは、索引は古いページ番号を指したまま。

## 2. 1 リクエストの流れ {#s2}

### 2.1 検索の 1 回 {#s2-1}

```text
 GET /occ/v2/samplestore/products/search?query=ペン&pageSize=20&fields=DEFAULT
   api
   ├ SEARCH_PROVIDER=db(軽量版)
   │    SELECT … FROM products p JOIN categories c …
   │     WHERE (p.name ILIKE '%ペン%' OR p.summary ILIKE '%ペン%' OR c.name ILIKE '%ペン%')
   │     ORDER BY p.code LIMIT 20 OFFSET 0
   │    → X-Search-Provider: db
   │
   └ SEARCH_PROVIDER=solr(本格版)
        GET http://search:8983/solr/products/select?q=ペン&defType=edismax&qf=name^3 summary category_name&mm=100%&…
        (2000 ms 待っても返事が無ければあきらめる)
        → Solr が索引を引いて、当たった商品と件数を返す
        fields=FULL のときだけ、長い説明などを DB から読み足す(索引には入れていない)
        → X-Search-Provider: solr
```

### 2.2 索引を作り直す 1 回(worker の searchIndexJob) {#s2-2}

```text
 60 秒ごと(CRON_INTERVAL_SECONDS)
   worker ── SELECT 全商品 ──▶ db
   worker ── POST /update?commit=false  {"delete":{"query":"*:*"}}  ──▶ Solr   (全件削除を「予約」。まだ確定しない)
   worker ── POST /update?commit=true   [ {code,name,summary,price,stock,…} × 30 ] ──▶ Solr  (全件を入れて確定)
   確定するまでは古い索引で検索できるので、途中で検索結果が空になることはない
```

### 2.3 日本語の切り方(CJK バイグラム) {#s2-3}

日本語には単語の間に空白がありません。そこで「2 文字ずつ、1 文字ずらして重ねて切る」ことで、どこからでも探せるようにします。

```text
 索引を作るとき  「ボールペン」 → ボー / ール / ルペ / ペン  (+ 1 文字ずつ: ボ / ー / ル / ペ / ン)
 検索するとき    「ペン」       → ペン
                 → 索引の「ペン」と一致 → 当たる
 全角・半角の違い(ＡＢＣ と ABC、ｶﾀｶﾅ と カタカナ)と、英字の大文字・小文字もそろえる
```

### 2.4 Solr が止まったら {#s2-4}

```text
 検索   → Solr に届かない(つながらない・2 秒で返事が無い)→ 503 SearchUnavailableError
          エラーのログ・指標 search_requests_total{provider="solr",result="error"} が増える
 商品詳細・CMS・注文 → DB から読むので動き続ける
 worker の searchIndexJob → 失敗が続く → CronJobFailureRatioHigh / CronJobStale
```

「検索だけ壊れて、ほかは動く」のが、索引を別のサーバーに分けたときの特徴です。

## 3. 設定の読み方 {#s3}

### 3.1 検索の切り替え {#s3-1}

ファイル: [apps/api/src/occ/search.js](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/apps/api/src/occ/search.js)

```js
const PROVIDER = (process.env.SEARCH_PROVIDER ?? 'db').toLowerCase() === 'solr' ? 'solr' : 'db';
...
  const terms = text.split(/\s+/).filter(Boolean).slice(0, 5);
  const params = terms.map((t) => `%${likeEscape(t)}%`);
  const where = terms.length
    ? 'WHERE ' + terms.map((_, i) => `(p.name ILIKE $${i + 1} OR p.summary ILIKE $${i + 1} OR c.name ILIKE $${i + 1})`).join(' AND ')
    : '';
```

- `SEARCH_PROVIDER` … `db` か `solr`。api と worker で同じ値にします。
- DB の検索は、空白で区切った言葉(最大 5 個)が **全部** 含まれる物を探します(`AND`)。名前・短い説明・分類名のどれかに含まれれば当たりです。
- `$1` などの「置き場所」に値を入れて渡すので、入力が SQL の意味を変えることはありません(カオスの `sqliBug` は、ここをわざと文字列連結にします)。

```js
  } catch (err) {
    searchRequestsTotal.inc({ provider, result: 'error' });
    if (err instanceof solr.SolrUnavailableError) {
      res.status(503).json({ errors: [{ type: 'SearchUnavailableError', message: '…' }] });
      return;
    }
```

- Solr に届かないときは 503。「今は使えないが、あとで試せば直るかもしれない」という意味の状態コードです。

### 3.2 Solr への問い合わせ {#s3-2}

ファイル: [apps/api/src/solr.js](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/apps/api/src/solr.js)

```js
const SOLR_URL = (process.env.SOLR_URL ?? 'http://search:8983/solr/products').replace(/\/+$/, '');
const SOLR_TIMEOUT_MS = Number(process.env.SOLR_TIMEOUT_MS ?? 2000);
...
  const params = new URLSearchParams({
    q: text ? escapeQuery(text) : '*:*',
    defType: 'edismax',
    qf: 'name^3 summary category_name',
    mm: '100%',
    ...
  });
```

- `SOLR_URL` … Solr の「コア」(索引 1 つぶん)の住所。既定は `http://search:8983/solr/products`。
- `SOLR_TIMEOUT_MS` … 返事を待つ時間。既定 2000 ミリ秒。SSR の 3000 ミリ秒より短くして、検索で SSR 全体が時間切れにならないようにしています。
- `escapeQuery` … Solr の検索文法で特別な意味を持つ記号を無効にします(入力を「命令」として扱わせない)。
- `q: '*:*'` … 検索語が空なら全件。
- `qf: 'name^3 summary category_name'` … 探す項目。`^3` は「名前で当たったら 3 倍重く見る」(おすすめ順の並びに効く)。
- `mm: '100%'` … 言葉が複数なら全部を含む物だけ(DB の `AND` と同じ動き)。

### 3.3 索引の設計図(スキーマ) {#s3-3}

ファイル: [apps/api/solr/products/conf/schema.xml](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/apps/api/solr/products/conf/schema.xml)

```xml
  <uniqueKey>code</uniqueKey>
  <field name="name" type="text_cjk" indexed="true" stored="true"/>
  <field name="price" type="pint" indexed="true" stored="true" docValues="true"/>
  ...
    <analyzer type="index">
      <tokenizer class="solr.StandardTokenizerFactory"/>
      <filter class="solr.CJKWidthFilterFactory"/>
      <filter class="solr.LowerCaseFilterFactory"/>
      <filter class="solr.CJKBigramFilterFactory" outputUnigrams="true"/>
    </analyzer>
```

- `uniqueKey` … 文書(商品 1 件)を 1 つに決める項目。商品コードです。同じコードを入れ直すと上書きになります。
- `indexed="true"` … 探せるようにする。`stored="true"` … 結果として値を返せるようにする。
- `docValues="true"` … 並べ替え(価格順など)に使えるようにする。
- `CJKWidthFilterFactory` … 全角・半角をそろえる。`LowerCaseFilterFactory` … 英字を小文字にそろえる。
- `CJKBigramFilterFactory` … 2 文字ずつ重ねて切る。索引側は `outputUnigrams="true"` で 1 文字ずつも作り、1 文字だけの検索語(例: 紺)でも当たるようにしています。

### 3.4 索引の作り直し {#s3-4}

ファイル: [apps/api/src/aspects/worker.js](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/apps/api/src/aspects/worker.js)

```js
  async searchIndexJob() {
    if (PROVIDER !== 'solr') return { skipped: 'SEARCH_PROVIDER=db なので索引は作りません' };
    const { rows } = await pool.query(`SELECT ${COLUMNS} ${FROM} ORDER BY p.code`);
    const indexed = await solr.reindex(rows);
    return { indexed, solr: solr.SOLR_URL };
  },
```

- 軽量版(`db`)では何もせず「成功」を記録します(アラートの仕組みを両方の版で同じにするため)。
- 本格版では、DB の全商品を読んで Solr に入れ直します(全件の作り直し)。

## 4. 確かめるコマンド {#s4}

軽量版(`SEARCH_PROVIDER=db`):

::: code-group

```bash [Mac / Linux / WSL]
# どちらで探したかは応答ヘッダで分かる(%E3%83%9A%E3%83%B3 は「ペン」。URL に日本語を生のまま書くと api が 400 を返すので、この形で送ります)
curl -sI 'http://api.lab.localhost:18080/occ/v2/samplestore/products/search?query=%E3%83%9A%E3%83%B3' | grep -i x-search-provider
# → X-Search-Provider: db

# 当たった件数と商品名
curl -s 'http://api.lab.localhost:18080/occ/v2/samplestore/products/search?query=%E3%83%9A%E3%83%B3&fields=BASIC' \
  | python3 -c 'import sys,json; d=json.load(sys.stdin); print(d["pagination"]["totalResults"], [p["name"] for p in d["products"]])'

# worker の searchIndexJob は「何もせず成功」
docker compose logs worker | grep searchIndexJob | tail -1
# → …"job":"searchIndexJob","result":"success","skipped":"SEARCH_PROVIDER=db なので索引は作りません"…
```

```powershell [PowerShell]
# どちらで探したかは応答ヘッダで分かる(%E3%83%9A%E3%83%B3 は「ペン」。URL に日本語を生のまま書くと api が 400 を返すので、この形で送ります)
curl.exe -sI 'http://api.lab.localhost:18080/occ/v2/samplestore/products/search?query=%E3%83%9A%E3%83%B3' | Select-String x-search-provider
# → X-Search-Provider: db

# 当たった件数と商品名
$d = curl.exe -s 'http://api.lab.localhost:18080/occ/v2/samplestore/products/search?query=%E3%83%9A%E3%83%B3&fields=BASIC' | ConvertFrom-Json
"$($d.pagination.totalResults) $($d.products.name -join ', ')"

# worker の searchIndexJob は「何もせず成功」
docker compose logs worker | Select-String searchIndexJob | Select-Object -Last 1
# → …"job":"searchIndexJob","result":"success","skipped":"SEARCH_PROVIDER=db なので索引は作りません"…
```

:::

本格版(`SEARCH_PROVIDER=solr`):

::: code-group

```bash [Mac / Linux / WSL]
# 日本語は --data-urlencode で %E3%83… の形に直して送ります(URL に生のまま書くと api が 400 を返します)
curl -sIG --data-urlencode 'query=ペン' 'http://api.lab.localhost:18080/occ/v2/samplestore/products/search' | grep -i x-search-provider
# → X-Search-Provider: solr

# 半角カタカナの「ﾍﾟﾝ」でも「ペン」と同じ件数が当たる(索引が全角・半角をそろえるため。軽量版の ILIKE では 0 件)
for q in ペン ﾍﾟﾝ; do
  curl -sG --data-urlencode "query=$q" -d fields=BASIC 'http://api.lab.localhost:18080/occ/v2/samplestore/products/search' \
    | python3 -c 'import sys,json; print(json.load(sys.stdin)["pagination"]["totalResults"])'
done

# Solr を止める → 検索だけ 503、商品詳細は 200
kubectl -n lab scale deploy/search --replicas=0
curl -sG -o /dev/null -w '%{http_code}\n' --data-urlencode 'query=ペン' 'http://api.lab.localhost:18080/occ/v2/samplestore/products/search'   # → 503
curl -s -o /dev/null -w '%{http_code}\n' http://api.lab.localhost:18080/occ/v2/samplestore/products/100001               # → 200
kubectl -n lab scale deploy/search --replicas=1
```

```powershell [PowerShell]
# 日本語は PowerShell の側で %E3%83… の形に直してから URL に入れます(URL に生のまま書くと api が 400 を返します)
$q = [uri]::EscapeDataString('ペン')     # → %E3%83%9A%E3%83%B3
curl.exe -sI "http://api.lab.localhost:18080/occ/v2/samplestore/products/search?query=$q" | Select-String x-search-provider
# → X-Search-Provider: solr

# 半角カタカナの「ﾍﾟﾝ」でも「ペン」と同じ件数が当たる(索引が全角・半角をそろえるため。軽量版の ILIKE では 0 件)
foreach ($w in 'ペン', 'ﾍﾟﾝ') {
  (curl.exe -s "http://api.lab.localhost:18080/occ/v2/samplestore/products/search?query=$([uri]::EscapeDataString($w))&fields=BASIC" | ConvertFrom-Json).pagination.totalResults
}

# Solr を止める → 検索だけ 503、商品詳細は 200
kubectl -n lab scale deploy/search --replicas=0
curl.exe -s -o NUL -w '%{http_code}\n' "http://api.lab.localhost:18080/occ/v2/samplestore/products/search?query=$q"   # → 503
curl.exe -s -o NUL -w '%{http_code}\n' http://api.lab.localhost:18080/occ/v2/samplestore/products/100001               # → 200
kubectl -n lab scale deploy/search --replicas=1
```

:::

::: tip PowerShell
`curl.exe` に日本語の引数(`--data-urlencode 'query=ペン'` など)を直接渡すと、Windows の文字コードの都合で化けて 0 件になることがあります。上のように `[uri]::EscapeDataString('ペン')` で先に `%E3%83…` の形に直してから、URL に入れて渡してください。
:::

503 のはずが 200 のときは、Solr がまだ止まりきっていないか、30 秒以内に同じ検索をしていて cdn-waf のキャッシュが返しています(p1・s1)。数秒待ち、`query=` の言葉を変えて打ち直してください。

Solr は Deployment `search`(Service `search:8983`)として動いています([k8s/platform/search.yaml](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/k8s/platform/search.yaml))。
イメージは `solr:9.10.1-slim`、Java のヒープは `SOLR_HEAP=256m` です。コア `products` は、起動の引数 `solr-precreate products /opt/solr/server/solr/configsets/products`(公式イメージの仕組み。「コアが無ければこの設定から作ってから起動する」)で作ります。設定の `schema.xml`・`solrconfig.xml` は、`k8s/up.sh` が [apps/api/solr/products/conf/](https://github.com/kazumasamatsumoto/ops-hands-on-lab/tree/main/apps/api/solr/products/conf) から ConfigMap `solr-products-config` に入れ、1 ファイルずつ(`subPath`)つなぎます。索引は Pod の中の一時的な置き場所(`emptyDir`)にあり、Pod が作り直されると空になりますが、worker の次の `searchIndexJob`(最大 60 秒後)で戻ります。

**反映の遅れを見る(本格版)**: backoffice で商品 100001 の価格を変えます。商品 1 件の API(`/occ/v2/samplestore/products/100001`。DB から読む)は新しい価格(キャッシュがある環境では最大 30 秒後)、検索結果の価格は worker が索引を作り直すまで(最大 60 秒)古い価格です。

## 5. CCv2 / Composable Storefront ではどこに当たるか {#s5}

| ラボ | CCv2 で当たるもの |
| --- | --- |
| Solr(本格版の search) | CCv2 が用意する Solr(検索サーバー。利用者はサーバーを持たない) |
| `schema.xml` の `text_cjk` | 検索の設定(索引にする項目・言語ごとの切り方)。CCv2 では Solr の設定と、商品の索引の型の設定で決める |
| `searchIndexJob`(全件の作り直し) | 索引の CronJob(全件の作り直し = full、変わった物だけ = update)。backgroundProcessing で動く |
| `CRON_INTERVAL_SECONDS` ごとの作り直し | 索引の CronJob のトリガー(何分ごとに動かすか) |
| `SEARCH_PROVIDER=db`(軽量版) | 相当する物は無い(CCv2 の商品検索は Solr が前提) |
| `products/search` の OCC | OCC の商品検索 API(Composable Storefront の検索画面が呼ぶ) |
| 503 `SearchUnavailableError` | Solr の障害時に検索だけが失敗する、という切り分けの考え方 |

## 6. よくある誤解 {#s6}

- **「管理画面で価格を変えたら、検索結果にもすぐ出る」** → 検索結果は索引から作ります。索引を作り直すまで古い値です(ラボは最大 60 秒)。さらに CDN のキャッシュの時間も足されます。
- **「Solr が止まると、お店全体が止まる」** → 止まるのは検索だけです。商品詳細や CMS は DB から読みます。ただし「検索できないお店」は売上に直結するので、アラートで気付けるようにします。
- **「日本語の検索は、辞書(形態素解析)がないとできない」** → 2 文字ずつ重ねて切る方法(バイグラム)なら、辞書なしでどこからでも当たります。代わりに、関係の薄い物まで当たる(ノイズ)ことがあります。
- **「索引を作り直している間は、検索結果が空になる」** → 削除と追加を「確定(commit)」まで保留しているので、確定の瞬間までは古い索引で答えます。
- **「DB の LIKE 検索で本番も十分」** → 件数が増えると 1 行ずつ探すのは遅くなり、DB の負荷も上がります。検索を別サーバー(Solr)に逃がすのは、DB を守るためでもあります。

## 7. 関係する演習と設計書 {#s7}

- 演習: [性能-1 負荷試験で限界を見る](/exercises/12-perf-load-test)・[セキュリティ-1 WAF が攻撃を止める](/exercises/17-sec-waf)(`sqliBug` は検索の `query` に効く)・[SRE-2 エラーバジェットとアラート](/exercises/10-sre-burn-rate-alert)
- 設計書: [BE 方式 4.11 検索の実体(db / Solr)](/design/architecture/02-backend#s4-11)・[4.4 SQL の書き方](/design/architecture/02-backend#s4-4)・[4.7 DB への接続](/design/architecture/02-backend#s4-7)・[障害対応方式 4.1 障害の分け方](/design/architecture/08-incident-response#s4-1)・[性能方式 4.8 検索を DB から外す(Solr)](/design/architecture/07-performance#s4-8)・[DR 方式 4.6 作り直せる物(検索の索引)](/design/architecture/09-disaster-recovery#s4-6)
- 前後のページ: [仕組み-8 aspect と worker](./08-aspects-and-worker) ・ [仕組み-10 DB とバックアップ](./10-db-and-backup)
