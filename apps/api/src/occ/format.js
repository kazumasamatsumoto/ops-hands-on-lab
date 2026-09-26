// OCC 風の JSON の「形」を作るところです。DB の行 → 画面が使う形 に変換します。
//
// fields パラメータ(BASIC / DEFAULT / FULL)で、返す項目の量を変えます。
// たとえ: 出前のメニューの「並・上・特上」。特上(FULL)は中身が多いぶん、運ぶ量(バイト数)も増えます。
// 一覧のように件数が多い画面で FULL を頼むと遅くなる、というのを性能の演習で見ます。
//   BASIC   : code, name, url, price
//   DEFAULT : BASIC + summary, images, stock            (何も指定しないときはこれ)
//   FULL    : DEFAULT + description, categories, classifications, purchasable
'use strict';

const LEVELS = new Set(['BASIC', 'DEFAULT', 'FULL']);

function fieldsLevel(value) {
  const v = String(value ?? 'DEFAULT').toUpperCase();
  return LEVELS.has(v) ? v : 'DEFAULT';
}

const yen = new Intl.NumberFormat('ja-JP', { style: 'currency', currency: 'JPY' });

function price(value) {
  return { currencyIso: 'JPY', value, formattedValue: yen.format(value) };
}

// 在庫の状態。5 個以下は「残りわずか」。
function stock(level) {
  const stockLevelStatus = level <= 0 ? 'outOfStock' : level <= 5 ? 'lowStock' : 'inStock';
  return { stockLevelStatus, stockLevel: Math.max(0, level) };
}

// 画像の URL は「/medias/...」のように、ホスト名を付けずに返します。
// storefront が自分の知っている api のアドレス(API_PUBLIC_URL)を前に付けて使います(OCC と同じ考え方)。
function images(code, name) {
  const url = `/medias/${code}.svg`;
  return [
    { url, altText: name, format: 'product', imageType: 'PRIMARY' },
    { url, altText: name, format: 'thumbnail', imageType: 'PRIMARY' },
  ];
}

// row: { code, name, summary, price, stock, description?, category_code?, category_name?, classifications? }
function product(row, level) {
  const out = { code: row.code, name: row.name, url: `/p/${row.code}`, price: price(row.price) };
  if (level === 'BASIC') return out;
  Object.assign(out, { summary: row.summary, images: images(row.code, row.name), stock: stock(row.stock) });
  if (level === 'DEFAULT') return out;
  Object.assign(out, {
    description: row.description,
    categories: [{ code: row.category_code, name: row.category_name, url: `/c/${row.category_code}` }],
    classifications: row.classifications ?? [],
    purchasable: row.stock > 0,
  });
  return out;
}

module.exports = { fieldsLevel, price, stock, product };
