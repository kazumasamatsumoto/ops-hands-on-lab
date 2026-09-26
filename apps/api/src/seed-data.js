// 見本データです。架空のネットストア「サンプルストア」の商品・会員・注文・CMS(画面の部品)。
// ここは「中身」だけで、DB に入れる処理は db.js にあります。
'use strict';

// 商品の分類(カテゴリ)。code は URL などに使う英字、name は画面に出す名前です。
const CATEGORIES = [
  ['stationery', '文房具', '毎日の書く・貼る・まとめるを支える道具です。'],
  ['kitchen', 'キッチン', '食卓とお弁当まわりの道具です。'],
  ['living', '生活雑貨', '部屋で使う身の回りの物です。'],
  ['digital', 'デジタル小物', 'パソコンやスマホのまわりで使う小物です。'],
];

// 商品 30 件。[名前, 分類, 価格(円・税込), 短い説明, 素材, 大きさ]
// 商品コードは 100001 から順に振ります(CCv2 の商品コードのように、画面の URL にも出ます: /p/100001)。
const PRODUCTS = [
  ['ノート A5 方眼', 'stationery', 330, '5mm 方眼で図も文字も書きやすいノートです。', '紙', 'A5'],
  ['ノート B5 横罫', 'stationery', 280, '授業や会議のメモに使いやすい横罫ノートです。', '紙', 'B5'],
  ['ゲルインクボールペン 0.5 黒', 'stationery', 165, 'なめらかに書ける黒のボールペンです。', '樹脂', '長さ 14cm'],
  ['ゲルインクボールペン 0.5 赤', 'stationery', 165, '添削や強調に使う赤のボールペンです。', '樹脂', '長さ 14cm'],
  ['シャープペンシル 0.3', 'stationery', 550, '細かい字を書く人向けの 0.3mm 芯です。', '金属・樹脂', '長さ 14cm'],
  ['消しゴム 小', 'stationery', 110, '筆箱に入れやすい小さな消しゴムです。', '樹脂', '4cm'],
  ['ふせん 75mm 角', 'stationery', 220, '貼ってはがせる正方形のふせんです。', '紙', '75mm 角'],
  ['クリアファイル 10 枚', 'stationery', 330, '書類をまとめる透明なファイルの 10 枚組です。', '樹脂', 'A4'],
  ['ホチキス 小型', 'stationery', 770, '20 枚までとじられる小型のホチキスです。', '金属', '手のひら大'],
  ['はさみ 事務用', 'stationery', 660, '紙もテープも切りやすい事務用のはさみです。', '金属・樹脂', '長さ 17cm'],
  ['マグカップ 白', 'kitchen', 990, '毎日使いやすい白いマグカップです。', '陶器', '300ml'],
  ['マグカップ 紺', 'kitchen', 990, '落ち着いた紺色のマグカップです。', '陶器', '300ml'],
  ['ステンレス水筒 500ml', 'kitchen', 2480, '温かさと冷たさを保つ水筒です。', 'ステンレス', '500ml'],
  ['お弁当箱 2 段', 'kitchen', 1650, 'おかずとご飯を分けて入れられる 2 段のお弁当箱です。', '樹脂', '600ml'],
  ['保存容器 3 個組', 'kitchen', 1100, '作り置きに便利なふた付き容器の 3 個組です。', '樹脂', '大・中・小'],
  ['木のカトラリーセット', 'kitchen', 1320, 'スプーン・フォーク・箸の木製セットです。', '木', '3 本組'],
  ['ふきん 5 枚組', 'kitchen', 550, '吸水性のよい綿のふきんです。', '綿', '30cm 角'],
  ['ハンドタオル 無地', 'living', 440, 'かばんに入れやすい無地のハンドタオルです。', '綿', '25cm 角'],
  ['バスタオル 厚手', 'living', 1980, 'ふんわり厚手のバスタオルです。', '綿', '60cm × 120cm'],
  ['エコバッグ 折りたたみ', 'living', 880, '小さくたためる買い物袋です。', 'ポリエステル', '容量 20L'],
  ['卓上ライト LED', 'living', 3980, '明るさを 3 段階で変えられる机のライトです。', '金属・樹脂', '高さ 40cm'],
  ['壁掛け時計 シンプル', 'living', 2750, '数字が読みやすい壁掛け時計です。', '木・ガラス', '直径 30cm'],
  ['スリッパ 洗える', 'living', 1210, '洗濯機で洗えるスリッパです。', 'ポリエステル', '23〜25cm'],
  ['収納ボックス 布製', 'living', 1540, '棚にぴったり入る布の収納箱です。', '布', '幅 38cm'],
  ['USB 充電ケーブル 1m', 'digital', 990, 'USB-C の充電・通信ケーブルです。', '樹脂・金属', '1m'],
  ['スマホスタンド', 'digital', 1100, '角度を変えられるスマホ立てです。', 'アルミ', '手のひら大'],
  ['ワイヤレスマウス', 'digital', 2200, '電池で 1 年もつ静かなマウスです。', '樹脂', '手のひら大'],
  ['キーボードカバー', 'digital', 770, 'ほこりと飲み物からキーボードを守るカバーです。', 'シリコン', '汎用'],
  ['ケーブルまとめバンド 10 本', 'digital', 330, '机の下のケーブルをまとめるバンドです。', 'シリコン', '10 本組'],
  ['ノート PC スタンド', 'digital', 3300, '画面を目の高さに上げるスタンドです。', 'アルミ', '15 インチまで'],
];

const USERS = [
  ['alice', 'アリス'],
  ['bob', 'ボブ'],
  ['carol', 'キャロル'],
];

// 見本の注文。[会員名, [[商品の番号(1〜30), 個数], ...], 状態, 何日前]
const ORDERS = [
  ['alice', [[1, 2], [3, 5]], 'SHIPPED', 30],
  ['alice', [[11, 1]], 'SHIPPED', 12],
  ['alice', [[21, 1], [25, 2]], 'PROCESSING', 1],
  ['bob', [[13, 1]], 'SHIPPED', 20],
  ['bob', [[27, 1], [29, 3]], 'PROCESSING', 2],
  ['carol', [[19, 2]], 'SHIPPED', 15],
  ['carol', [[5, 1], [6, 3], [7, 2]], 'SHIPPED', 7],
  ['carol', [[30, 1]], 'PROCESSING', 0],
];

const STATUS_DISPLAY = { SHIPPED: '発送済み', PROCESSING: '準備中' };

const productCode = (n) => String(100000 + n); // 1 → "100001"

// ---------- CMS(画面の部品) ----------
// ヘッドレスでは、画面の「どこに・何を置くか」を API が JSON で返し、storefront はそれを並べるだけです。
// ページ(page)の中にスロット(slot = 置き場所)があり、スロットの中に部品(component)が入ります。
// たとえ: ページ = 新聞の 1 面、スロット = 紙面の枠、部品 = 枠に入れる記事や広告。

const NAV_LINKS = [
  { name: 'ホーム', url: '/' },
  ...CATEGORIES.map(([code, name]) => ({ name, url: `/search?q=${encodeURIComponent(name)}`, categoryCode: code })),
  { name: '注文履歴', url: '/my-account/orders' },
];

// [uid, typeCode, name, 属性]
const COMPONENTS = [
  ['SearchBoxComponent', 'SearchBoxComponent', '検索ボックス', { placeholder: '商品名で探す(例: ペン)' }],
  ['MainNavigationComponent', 'NavigationComponent', 'メインメニュー', { links: NAV_LINKS }],
  [
    'HomepageSplashBanner',
    'SimpleBannerComponent',
    'トップのバナー',
    {
      headline: '秋の文房具フェア',
      content: 'ノートとペンを新しくして、気持ちよく書き始めましょう。',
      media: { url: '/medias/banner-homepage.svg', altText: '秋の文房具フェア' },
      urlLink: `/search?q=${encodeURIComponent('文房具')}`,
    },
  ],
  // CMSParagraphComponent の content は HTML の断片として扱われます(storefront が Angular のサニタイズを通して描く)。
  // 見本の値は HTML の札を使わないただの文字です。
  [
    'HomepageWelcomeParagraph',
    'CMSParagraphComponent',
    'トップのごあいさつ',
    { content: 'サンプルストアは、架空の会社「サンプル株式会社」が運営する練習用のネットストアです。実在の商品は売っていません。' },
  ],
  [
    'HomepageNewArrivalsCarousel',
    'ProductCarouselComponent',
    '新着商品',
    { title: '新着商品', productCodes: [21, 13, 27, 30, 1, 11, 25, 19].map(productCode).join(' ') },
  ],
  [
    'HomepageKitchenCarousel',
    'ProductCarouselComponent',
    'キッチンのおすすめ',
    { title: 'キッチンのおすすめ', productCodes: [11, 12, 13, 14, 15, 16].map(productCode).join(' ') },
  ],
  ['FooterParagraph', 'CMSParagraphComponent', 'フッター', { content: '© サンプル株式会社(体験ラボ用の架空の会社です)' }],
  ['ProductDetailsComponent', 'ProductDetailsComponent', '商品詳細の本体', {}],
  // 以下の 3 つは、表示する商品や分類に合わせて、返すときに中身を埋めます(cms.js)。
  ['ProductRelatedCarousel', 'ProductCarouselComponent', '同じ分類の商品', { title: '同じ分類の商品', productCodes: '' }],
  ['CategoryBanner', 'SimpleBannerComponent', '分類のバナー', { headline: '', content: '', media: { url: '', altText: '' }, urlLink: '' }],
  ['CategoryProductCarousel', 'ProductCarouselComponent', '分類の商品一覧', { title: '', productCodes: '' }],
];

const HEADER = [
  ['SearchBoxSlot', 'SearchBox', ['SearchBoxComponent']],
  ['NavigationBarSlot', 'NavigationBar', ['MainNavigationComponent']],
];
const FOOTER = [['FooterSlot', 'Footer', ['FooterParagraph']]];

// [uid, label, pageType, name, template, title, スロット [[slotId, position, [部品 uid...]]]]
const PAGES = [
  [
    'homepage',
    'homepage',
    'ContentPage',
    'トップページ',
    'LandingPageTemplate',
    'サンプルストア',
    [
      ...HEADER,
      ['Section1Slot-Homepage', 'Section1', ['HomepageSplashBanner']],
      ['Section2Slot-Homepage', 'Section2', ['HomepageWelcomeParagraph']],
      ['Section3Slot-Homepage', 'Section3', ['HomepageNewArrivalsCarousel']],
      ['Section4Slot-Homepage', 'Section4', ['HomepageKitchenCarousel']],
      ...FOOTER,
    ],
  ],
  [
    'productDetails',
    null,
    'ProductPage',
    '商品詳細ページ',
    'ProductDetailsPageTemplate',
    '商品詳細',
    [
      ...HEADER,
      ['SummarySlot-ProductDetails', 'Summary', ['ProductDetailsComponent']],
      ['CrossSellingSlot-ProductDetails', 'CrossSelling', ['ProductRelatedCarousel']],
      ...FOOTER,
    ],
  ],
  [
    'productList',
    null,
    'CategoryPage',
    '分類ページ',
    'ProductListPageTemplate',
    '分類',
    [
      ...HEADER,
      ['Section1Slot-ProductList', 'Section1', ['CategoryBanner']],
      ['ProductListSlot-ProductList', 'ProductList', ['CategoryProductCarousel']],
      ...FOOTER,
    ],
  ],
];

module.exports = { CATEGORIES, PRODUCTS, USERS, ORDERS, STATUS_DISPLAY, COMPONENTS, PAGES, productCode };
