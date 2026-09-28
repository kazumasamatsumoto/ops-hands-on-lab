---
title: ヘッドレス-1 CMS の JSON が画面になるまで
---

# ヘッドレス-1 CMS の JSON が画面になるまで

::: info この演習について
- 所要時間: 約 25 分
- 使うもの: 軽量版(docker compose)。`curl`(PowerShell は `curl.exe`)、ブラウザ、`psql`(未知の部品を試すとき)
- 仕組みはこちら: [仕組み-5 ヘッドレスと CMS 駆動の描画](/how-it-works/05-headless-cms)・[仕組み-4 storefront の SSR](/how-it-works/04-storefront-ssr)・[仕組み-6 api(OCC・fields・CORS)](/how-it-works/06-api-occ)
- 関係する設計書: [FE 方式](/design/architecture/01-frontend)・[D-FE-05 CMS 駆動の描画(ヘッドレス)](/design/detail/D-FE-05-headless-cms)
- 用語集: [ヘッドレス](/guide/glossary#headless)・[CMS 駆動の描画](/guide/glossary#cms-driven-rendering)・[スロット](/guide/glossary#slot)・[typeCode](/guide/glossary#typecode)・[JS Storefront](/guide/glossary#js-storefront)
:::

## 1. この設計書はなぜ必要か

ヘッドレス(画面と中身を分けた作り)では、「トップに何を、どの順で出すか」がコードではなく **データ(CMS の JSON)** で決まります。この作りを知らないと、「文言を変えたいだけなのに、なぜエンジニアの作業が要るのか(要らないのか)」が分からず、業務とエンジニアの役割分担を決められません。

> **よくある事故**: 「トップのバナーの文言を変えたい」という依頼のたびに、エンジニアがコードを直して再リリースしていました。
> 本当は CMS のデータを変えるだけで済む作りだったのに、誰もその仕組みを理解していなかったので、簡単な文言変更に毎回半日かかっていました。
> 逆に、新しい種類の部品を CMS に足したとき、storefront 側の対応を忘れて、その部品だけ画面から消えた(でもエラーにはならなかった)こともありました。

「画面はどこまでがデータで決まり、どこからがコードか」「知らない部品が来たらどうするか」を、FE の方式設計書で決めます。

## 2. 何をやっているのか

storefront は、画面ごとに api の **CMS のページ(JSON)** を取り、その中の「枠(スロット)」と「部品(component)の種類(typeCode)」を見て、対応する Angular の部品を当てはめて並べます。
「どの typeCode を、どの Angular 部品で描くか」の対応表は、アプリで **ただ 1 か所**(`apps/web/src/app/cms/cms-mapping.ts`)にあります。表に無い typeCode が来たら、その部品だけ描かず、ログに警告を出します(画面全体は落としません)。

だから、backoffice でバナーの文言を変えると、storefront を作り直さなくても画面の文が変わります(データが変わるだけ)。
一方、新しい種類の部品を CMS に足すには、storefront に Angular 部品を作って対応表に 1 行足す(= コードの変更)が要ります。

演習では、①CMS の JSON を見る、②同じ並びが画面(SSR の HTML)の印になっているのを見る、③backoffice で文言を変えて画面が変わるのを見る、④storefront が知らない部品を足して警告が出るのを見る、⑤SSR とブラウザで同じ JSON がどう使われるかを見る、の順に進みます。

たとえ: **舞台の進行台本** です。CMS の JSON は「1 幕: 看板、2 幕: 説明、3 幕: おすすめ商品…」という台本(どの枠に何を置くか)です。
storefront(舞台係)は台本を読んで、看板や道具(Angular 部品)を並べるだけです。台本を書き換えれば(backoffice)、舞台係を替えなくても出し物が変わります。
でも、台本に「新しい仕掛け」と書かれても、その道具を舞台係が持っていなければ(対応表に無い)、その幕は飛ばして「そんな道具は知りません」とメモを残します。

::: tip CCv2 では
これがヘッドレス(Composable Storefront)の核心です。api の `/cms/pages` は OCC の CMS の API に当たり、typeCode ごとの部品の対応表は、
CCv2 の `cmsComponents`(typeCode ごとに Angular 部品を登録する所)の簡略版です。backoffice での文言変更は、CCv2 の SmartEdit(画面を見ながら CMS を編集する道具)での編集に当たります。
「知らない typeCode は描かずにログ」も同じ考え方です。
:::

## 3. まず触ってみる

1. **CMS の JSON を見る**。トップページの「枠(position)」と「部品(typeCode)」だけを抜き出します。

   ::: code-group

   ```bash [Mac / Linux / WSL]
   A=http://api.lab.localhost:18080
   curl -s "$A/occ/v2/samplestore/cms/pages?pageType=ContentPage&pageLabelOrId=homepage" \
     | python3 -c 'import sys,json;p=json.load(sys.stdin);print("template:",p["template"]);[print(" ",s["position"],[c["typeCode"] for c in s["components"]["component"]]) for s in p["contentSlots"]["contentSlot"]]'
   ```

   ```powershell [PowerShell]
   $A = 'http://api.lab.localhost:18080'
   $p = curl.exe -s "$A/occ/v2/samplestore/cms/pages?pageType=ContentPage&pageLabelOrId=homepage" | ConvertFrom-Json
   "template: $($p.template)"
   foreach ($s in $p.contentSlots.contentSlot) { "  $($s.position) [$($s.components.component.typeCode -join ', ')]" }
   ```

   :::

   PowerShell の `ConvertFrom-Json` は、JSON を「`.` でたどれる物」に変えます。`$p.contentSlots.contentSlot` が枠の一覧、`$p.contentSlots.contentSlot[2].components.component` が 3 番目の枠に置いてある部品(`typeCode` や `uid`)です。
   加工せずに JSON をそのまま見たいときは `curl.exe -s "$A/occ/v2/samplestore/cms/pages?pageType=ContentPage&pageLabelOrId=homepage"` と打ちます(bash も同じで、`| python3 …` を外します)。

2. **同じ並びが、画面(SSR の HTML)の印になっているのを見る**。JS を動かさなくても(= `curl`)、部品の種類が HTML に印として入っています。

   ::: code-group

   ```bash [Mac / Linux / WSL]
   curl -s "http://www.lab.localhost:18080/?t=cms" | grep -oE 'data-slot="[^"]*"|data-cms-type="[^"]*"'
   ```

   ```powershell [PowerShell]
   curl.exe -s "http://www.lab.localhost:18080/?t=cms" | Select-String -Pattern 'data-slot="[^"]*"|data-cms-type="[^"]*"' -AllMatches | ForEach-Object { $_.Matches.Value }
   ```

   :::

3. **無いページは 404**。

   ::: code-group

   ```bash [Mac / Linux / WSL]
   curl -s -o /dev/null -w '%{http_code}\n' "$A/occ/v2/samplestore/cms/pages?pageType=ContentPage&pageLabelOrId=nothing"
   ```

   ```powershell [PowerShell]
   curl.exe -s -o NUL -w '%{http_code}\n' "$A/occ/v2/samplestore/cms/pages?pageType=ContentPage&pageLabelOrId=nothing"
   ```

   :::

4. **対応表を読む**。`apps/web/src/app/cms/cms-mapping.ts` を開くと、typeCode → Angular 部品の対応が 1 か所にまとまっています(コメントに、知らない typeCode の扱いも書いてあります)。

5. **backoffice で文言を変えて、画面が変わるのを見る**。反映をすぐ見るため、キャッシュを切っておきます。

   ::: code-group

   ```bash [Mac / Linux / WSL]
   EDGE_CACHE=off docker compose up -d cdn-waf; docker compose ps cdn-waf   # (healthy) を待つ
   ```

   ```powershell [PowerShell]
   $env:EDGE_CACHE = 'off'; docker compose up -d cdn-waf; docker compose ps cdn-waf   # (healthy) を待つ
   ```

   :::

   ブラウザで http://backoffice.lab.localhost:18080/backoffice/ を開き、`admin` / `admin` でログインし、「トップページのバナー」の見出しを変えて保存します。次を打つと、JSON と画面の両方が変わっています。

   ::: code-group

   ```bash [Mac / Linux / WSL]
   curl -s "$A/occ/v2/samplestore/cms/pages?pageType=ContentPage&pageLabelOrId=homepage" \
     | python3 -c 'import sys,json;p=json.load(sys.stdin);[print("JSON の見出し:",c["headline"]) for s in p["contentSlots"]["contentSlot"] for c in s["components"]["component"] if c["typeCode"]=="SimpleBannerComponent"]'
   curl -s "http://www.lab.localhost:18080/?t=after" | grep -o '<h1[^>]*>[^<]*</h1>' | head -1
   ```

   ```powershell [PowerShell]
   $p = curl.exe -s "$A/occ/v2/samplestore/cms/pages?pageType=ContentPage&pageLabelOrId=homepage" | ConvertFrom-Json
   $p.contentSlots.contentSlot.components.component | Where-Object typeCode -eq 'SimpleBannerComponent' | ForEach-Object { "JSON の見出し: $($_.headline)" }
   curl.exe -s "http://www.lab.localhost:18080/?t=after" | Select-String -Pattern '<h1[^>]*>[^<]*</h1>' -AllMatches | ForEach-Object { $_.Matches.Value } | Select-Object -First 1
   ```

   :::

6. **storefront が知らない部品を足して、警告が出るのを見る**。CMS のデータに、対応表に無い typeCode(`MysteryWidgetComponent`)の部品を 1 つ足します(DB を直接いじる、演習用の操作)。

   ::: code-group

   ```bash [Mac / Linux / WSL]
   docker compose exec -T db psql -U store -d store <<'SQL'
   INSERT INTO cms_components (uid, type_code, name, attrs)
     VALUES ('LabMysteryWidget', 'MysteryWidgetComponent', '未知の部品(演習用)', '{"note":"storefront が知らない typeCode"}'::jsonb)
     ON CONFLICT (uid) DO NOTHING;
   INSERT INTO cms_slot_components (page_uid, slot_id, sort, component_uid)
     VALUES ('homepage', 'Section2Slot-Homepage', 99, 'LabMysteryWidget')
     ON CONFLICT DO NOTHING;
   SQL
   curl -s -o /dev/null "http://www.lab.localhost:18080/?t=mystery"
   docker compose logs storefront --no-log-prefix --since 20s | grep cms_unknown_component | tail -1
   curl -s "http://www.lab.localhost:18080/?t=mystery2" | grep -oE 'data-cms-type="[^"]*"' | sort | uniq -c   # 知っている部品は描かれている
   ```

   ```powershell [PowerShell]
   docker compose exec -T db psql -U store -d store `
     -c "INSERT INTO cms_components (uid, type_code, name, attrs) VALUES ('LabMysteryWidget', 'MysteryWidgetComponent', '未知の部品(演習用)', jsonb_build_object('note', 'storefront が知らない typeCode')) ON CONFLICT (uid) DO NOTHING;" `
     -c "INSERT INTO cms_slot_components (page_uid, slot_id, sort, component_uid) VALUES ('homepage', 'Section2Slot-Homepage', 99, 'LabMysteryWidget') ON CONFLICT DO NOTHING;"
   curl.exe -s -o NUL "http://www.lab.localhost:18080/?t=mystery"
   docker compose logs storefront --no-log-prefix --since 20s | Select-String cms_unknown_component | Select-Object -Last 1
   curl.exe -s "http://www.lab.localhost:18080/?t=mystery2" | Select-String -Pattern 'data-cms-type="[^"]*"' -AllMatches | ForEach-Object { $_.Matches.Value } | Group-Object | Select-Object Count, Name   # 知っている部品は描かれている
   ```

   :::

   PowerShell では、SQL をファイルから流し込む(`<<'SQL'`)代わりに `-c` を 2 つ並べています(JSON の `{"note":…}` は、二重引用符を書かずに済む `jsonb_build_object` で作っています)。最後の行は `Count` と `Name` の 2 列の表で出ます。

   確かめたら、足した部品を消します。

   ::: code-group

   ```bash [Mac / Linux / WSL]
   docker compose exec -T db psql -U store -d store -c "DELETE FROM cms_slot_components WHERE component_uid='LabMysteryWidget'; DELETE FROM cms_components WHERE uid='LabMysteryWidget';"
   ```

   ```powershell [PowerShell]
   docker compose exec -T db psql -U store -d store -c "DELETE FROM cms_slot_components WHERE component_uid='LabMysteryWidget'; DELETE FROM cms_components WHERE uid='LabMysteryWidget';"
   ```

   :::

7. **SSR とブラウザで、同じ JSON がどう使われるかを見る**(ブラウザ)。お店のトップ http://www.lab.localhost:18080/ を開き、開発者ツール(F12)の「コンソール」に次を貼ります。
   Chrome で初めてコンソールに貼ると、貼り付けについての警告が出て、貼れないことがあります。そのときは、コンソールに `allow pasting`(Chrome の表示が日本語なら `貼り付けを許可`)と手で打って Enter を押してから、もう一度貼ります。

   ```js
   const cmsCalls = performance.getEntriesByType('resource').filter(e => e.name.includes('/cms/pages')).length;
   const hasState = !!document.querySelector('script[id*="state"]');
   const j = await fetch('http://api.lab.localhost:18080/occ/v2/samplestore/cms/pages?pageType=ContentPage&pageLabelOrId=homepage').then(r=>r.json());
   ({ 最初の表示でのCMS取得回数: cmsCalls, 申し送りのデータがある: hasState, ブラウザで取ったJSONのtemplate: j.template })
   ```

## 4. 何が見えたら成功か

**手順 1**: 枠ごとに、どの部品が置いてあるかが分かります。

```text
template: LandingPageTemplate
  SearchBox ['SearchBoxComponent']
  NavigationBar ['NavigationComponent']
  Section1 ['SimpleBannerComponent']
  Section2 ['CMSParagraphComponent']
  Section3 ['ProductCarouselComponent']
  Section4 ['ProductCarouselComponent']
  Footer ['CMSParagraphComponent']
```

**手順 2**: JSON の枠と部品の並びが、そのまま HTML の印(`data-slot`・`data-cms-type`)になっています。JS を動かさなくても(SSR)、この並びで届いています。

```text
data-slot="SearchBox"
data-cms-type="SearchBoxComponent"
data-slot="NavigationBar"
data-cms-type="NavigationComponent"
data-slot="Section1"
data-cms-type="SimpleBannerComponent"
...
data-slot="Footer"
data-cms-type="CMSParagraphComponent"
```

**手順 3**: 無いページは 404。

**手順 5**: backoffice で保存すると、JSON の `headline` が変わり、画面の `<h1>` も変わります。storefront は作り直していません(データが変わっただけ)。

```text
JSON の見出し: 冬のノート祭り
<h1>冬のノート祭り</h1>
```

**手順 6**: 知らない部品は描かれず、警告のログが出ます。**画面は落ちず、知っている部品は全部描かれています**。

```text
{"time":"...","service":"storefront","level":"warn","event":"cms_unknown_component","url":"http://www.lab.localhost/?t=mystery","typeCode":"MysteryWidgetComponent","uid":"LabMysteryWidget","pageUid":"homepage","slotId":"Section2Slot-Homepage"}
   2 data-cms-type="CMSParagraphComponent"
   1 data-cms-type="NavigationComponent"
   2 data-cms-type="ProductCarouselComponent"
   1 data-cms-type="SearchBoxComponent"
   1 data-cms-type="SimpleBannerComponent"
```

(`MysteryWidgetComponent` は `data-cms-type` に出てきません = 描かれていません。)
これが「CMS 担当が新しい部品を置いた日に、storefront の対応がまだでもサイトが止まらない」という設計です。新しい部品を出すには、storefront に Angular 部品を作って対応表に 1 行足します。

**手順 7**: 最初の表示では、ブラウザは CMS を **0 回** しか取りに行っていません(SSR がサーバーで取った JSON を、HTML に埋め込んで申し送っているため。TransferState)。それでも、ブラウザから直接 api を呼べば、同じ JSON が返ります。

```text
{ 最初の表示でのCMS取得回数: 0, 申し送りのデータがある: true, ブラウザで取ったJSONのtemplate: "LandingPageTemplate" }
```

同じ設計図(JSON)を、SSR は「サーバーで取って HTML に焼き込み」、ブラウザは「必要なときに api から取る」の 2 通りで使えるのが、ヘッドレスの利点です。

## 5. ここで覚える言葉

| 言葉 | 一言でいうと | たとえ | この演習で見たもの |
| --- | --- | --- | --- |
| [ヘッドレス](/guide/glossary#headless) | 画面(見た目)と中身(データ・API)を分けた作り | 舞台係と台本を分ける | 画面が CMS の JSON で決まる |
| [CMS 駆動の描画](/guide/glossary#cms-driven-rendering) | 画面の中身を CMS の JSON が決める | 台本どおりに舞台を組む | JSON の並び = HTML の印 |
| [スロット](/guide/glossary#slot) | 部品を置く枠(位置) | 舞台の各幕の場所 | Section1・Section2… |
| [typeCode](/guide/glossary#typecode) | 部品の種類を表す文字列 | 道具の種類名 | SimpleBannerComponent |
| 対応表(1 か所) | typeCode → Angular 部品の一覧 | 道具箱の目録 | `cms-mapping.ts` |
| 知らない部品を飛ばす | 対応表に無い部品は描かず、ログに残す | 知らない道具の幕は飛ばしてメモ | `cms_unknown_component` |
| [JS Storefront](/guide/glossary#js-storefront) | CMS 駆動で SSR する画面のアプリ | 台本どおりに動く舞台係 | storefront |

## 6. 設計書ではここに書く

- **[FE 方式 4.6 CMS 駆動の描画(ヘッドレス)](/design/architecture/01-frontend#s4-6)**: 画面の中身を CMS の JSON で決めること、対応表を 1 か所に持つこと、知らない部品の扱い。
- **[D-FE-05 4.2 ページと枠(スロット)](/design/detail/D-FE-05-headless-cms#s4-2)・[4.3 部品の種類と対応表](/design/detail/D-FE-05-headless-cms#s4-3)・[4.4 知らない部品の扱い](/design/detail/D-FE-05-headless-cms#s4-4)**: スロットと typeCode の一覧、対応表、未知の部品のログ。
- **[D-FE-05 4.5 申し送り(TransferState)と二重取りの防止](/design/detail/D-FE-05-headless-cms#s4-5)・[4.6 変更が画面に出るまで](/design/detail/D-FE-05-headless-cms#s4-6)**: SSR で取った JSON をブラウザに申し送ること、CMS の変更がキャッシュ越しに画面に出るまで。

## 7. レビューで聞く質問

- 「画面のどこまでが CMS のデータで決まり、どこからがコードですか。文言変更にエンジニアの作業は要りますか。」
- 「typeCode と Angular 部品の対応表は、1 か所にまとまっていますか。散らばっていませんか。」
- 「対応表に無い typeCode が来たら、どうなりますか。画面全体が落ちませんか。ログに残りますか。」
- 「新しい種類の部品を出すには、何の作業(CMS のデータ / storefront のコード)が要りますか。」
- 「CMS を変えてから画面に出るまで、どれくらいかかりますか(キャッシュの影響)。急いで反映する手はありますか。」

## 8. 片付け

足した部品を消し、バナーの見出しを元に戻し、キャッシュを戻します。

::: code-group

```bash [Mac / Linux / WSL]
docker compose exec -T db psql -U store -d store -c "DELETE FROM cms_slot_components WHERE component_uid='LabMysteryWidget'; DELETE FROM cms_components WHERE uid='LabMysteryWidget';"
docker compose up -d cdn-waf                          # EDGE_CACHE を付けずに起動 = on
docker compose exec -T cdn-waf printenv EDGE_CACHE    # on ならよい
```

```powershell [PowerShell]
docker compose exec -T db psql -U store -d store -c "DELETE FROM cms_slot_components WHERE component_uid='LabMysteryWidget'; DELETE FROM cms_components WHERE uid='LabMysteryWidget';"
Remove-Item Env:EDGE_CACHE -ErrorAction SilentlyContinue   # 手順 5 で入れた環境変数を消す
docker compose up -d cdn-waf                          # EDGE_CACHE を付けずに起動 = on
docker compose exec -T cdn-waf printenv EDGE_CACHE    # on ならよい
```

:::

手順 5 で変えたバナーの見出しは、backoffice で元(「秋の文房具フェア」)に戻すか、まっさらにしたいときは `docker compose down -v` です。
