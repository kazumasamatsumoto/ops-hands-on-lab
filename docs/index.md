---
layout: home

hero:
  name: 体験ラボ
  text: 作って、動かして、守るために必要なこと
  tagline: 架空のネットストア「サンプルストア」を自分の PC で動かし、壊し、測ってから、設計書の言葉と結びつけます。構成は SAP Commerce Cloud(CCv2)でヘッドレスのお店を動かすときの形に寄せています。
  actions:
    - theme: brand
      text: はじめに
      link: /guide/about
    - theme: alt
      text: 必要なこと一覧
      link: /guide/checklist
    - theme: alt
      text: 演習を始める
      link: /exercises/01-fe-ssr-vs-csr

features:
  - title: はじめに
    details: このラボが何のためにあるか。「なぜ必要か分からない」「何をしているか分からない」「単語が分からない」の 3 つのつまずきに、触る → 仕組みを知る → 一覧で穴を知る → 書く の順で答えます。
    link: /guide/about
    linkText: このラボについて
  - title: 開発・運用に必要なこと一覧
    details: アプリを作って動かし続けるために要ることを、10 の分野に分けて 1 行ずつ並べました。「無いとどんな事故が起きるか」と「ラボのどこで見られるか」つきです。
    link: /guide/checklist
    linkText: 一覧を見る
  - title: 演習(触って覚える)
    details: 1 演習 1 ページ、全 21 本。SSR、CMS 駆動の描画、キャッシュ、エンドポイントと IP フィルタ、SLO、負荷試験、バックアップ、WAF などを、自分の手で起こして確かめます。
    link: /exercises/01-fe-ssr-vs-csr
    linkText: 最初の演習へ
  - title: 仕組み(部品ごとの説明)
    details: cdn-waf・ingress・storefront・api・OAuth・worker・Solr・観測・manifest などが、どういう仕組みで動いているかを、1 リクエストの流れ・設定の各行・確かめるコマンド・CCv2 ではどこに当たるかまで説明します。
    link: /how-it-works/00-overview
    linkText: 仕組みを読む
  - title: ラボの設計書
    details: このラボ自身の方式設計書 11 本と詳細設計書 12 本です。書いてある値はすべて実物の設定ファイルと同じで、ファイルへのリンクが付いています。
    link: /design/architecture/00-overall
    linkText: 全体方式から読む
  - title: 地図と対応表
    details: ラボの部品と設計書の対応(地図)、ラボの部品と CCv2 の対応、SIer でなじみのある言葉とこのラボの言葉の対応表、用語集。
    link: /guide/map
    linkText: 地図を見る
  - title: 準備と起動
    details: Docker だけで動く軽量版と、Kubernetes(kind)で動く本格版の起動手順です。
    link: /guide/setup
    linkText: 準備する
---
