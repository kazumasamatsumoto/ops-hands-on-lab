// GET /occ/v2/samplestore/cms/pages — 画面の「設計図」を JSON で返します。ヘッドレスの核心です。
//
// storefront は、この JSON を見て「Section1 の枠にバナー、Section3 の枠に商品の横並び…」と部品を並べます。
// 画面の並びや文言を変えたいとき、storefront を作り直さなくても、ここ(DB の CMS データ)を変えるだけで済みます。
// (CCv2 では、この CMS データを Backoffice や SmartEdit で編集します)
//
// 返す形:
//   { uid, name, template, title, typeCode,
//     contentSlots: { contentSlot: [ { slotId, position, components: { component: [ { uid, typeCode, name, ...属性 } ] } } ] } }
'use strict';

const { pool } = require('../db');
const { sendError } = require('../http-common');
const { findProduct, findCategory, productCodesInCategory } = require('./products-repo');

async function loadPage(where, params) {
  const page = await pool.query(`SELECT uid, label, page_type, name, template, title FROM cms_pages WHERE ${where}`, params);
  if (page.rows.length === 0) return null;
  const p = page.rows[0];
  const { rows } = await pool.query(
    `SELECT s.slot_id, s.position, c.uid, c.type_code, c.name, c.attrs, c.updated_at
       FROM cms_slots s
       LEFT JOIN cms_slot_components sc ON sc.page_uid = s.page_uid AND sc.slot_id = s.slot_id
       LEFT JOIN cms_components c ON c.uid = sc.component_uid
      WHERE s.page_uid = $1
      ORDER BY s.sort, sc.sort`,
    [p.uid],
  );
  const slots = [];
  const bySlot = new Map();
  for (const r of rows) {
    let slot = bySlot.get(r.slot_id);
    if (!slot) {
      slot = { slotId: r.slot_id, position: r.position, components: { component: [] } };
      bySlot.set(r.slot_id, slot);
      slots.push(slot);
    }
    if (r.uid) {
      slot.components.component.push({
        uid: r.uid,
        typeCode: r.type_code,
        name: r.name,
        modifiedTime: r.updated_at.toISOString(),
        ...r.attrs,
      });
    }
  }
  return {
    uid: p.uid,
    ...(p.label ? { label: p.label } : {}),
    typeCode: p.page_type,
    name: p.name,
    template: p.template,
    title: p.title,
    contentSlots: { contentSlot: slots },
  };
}

// ページの中の部品を uid で探して、属性を上書きします(商品や分類に合わせて中身を埋めるため)。
function fill(page, uid, attrs) {
  for (const slot of page.contentSlots.contentSlot) {
    for (const c of slot.components.component) {
      if (c.uid === uid) Object.assign(c, attrs);
    }
  }
}

async function cmsPagesHandler(req, res) {
  const pageType = String(req.query.pageType ?? 'ContentPage');
  if (pageType === 'ContentPage') {
    const label = String(req.query.pageLabelOrId ?? 'homepage');
    // 「/」もトップページとして扱います。
    const key = label === '/' ? 'homepage' : label;
    const page = await loadPage("page_type = 'ContentPage' AND (label = $1 OR uid = $1)", [key]);
    if (!page) return sendError(res, 404, 'CMSItemNotFoundError', `ページが見つかりません: ${label}`);
    return res.json(page);
  }
  if (pageType === 'ProductPage') {
    const code = String(req.query.code ?? '');
    const product = code ? await findProduct(code) : null;
    if (!product) return sendError(res, 404, 'UnknownIdentifierError', `商品が見つかりません: ${code}`);
    const page = await loadPage("page_type = 'ProductPage'", []);
    page.title = `${product.name} | サンプルストア`;
    const related = await productCodesInCategory(product.category_code, { exclude: product.code, limit: 8 });
    fill(page, 'ProductRelatedCarousel', { productCodes: related.join(' ') });
    return res.json(page);
  }
  if (pageType === 'CategoryPage') {
    const code = String(req.query.code ?? '');
    const category = code ? await findCategory(code) : null;
    if (!category) return sendError(res, 404, 'UnknownIdentifierError', `分類が見つかりません: ${code}`);
    const page = await loadPage("page_type = 'CategoryPage'", []);
    page.title = `${category.name} | サンプルストア`;
    fill(page, 'CategoryBanner', {
      headline: category.name,
      content: category.description,
      media: { url: `/medias/banner-${category.code}.svg`, altText: category.name },
      urlLink: `/search?q=${encodeURIComponent(category.name)}`,
    });
    const codes = await productCodesInCategory(category.code);
    fill(page, 'CategoryProductCarousel', { title: `${category.name}の商品`, productCodes: codes.join(' ') });
    return res.json(page);
  }
  return sendError(res, 400, 'ValidationError', 'pageType は ContentPage・ProductPage・CategoryPage のどれかです');
}

module.exports = { cmsPagesHandler };
