// GET /medias/{code}.svg — 商品画像とバナー画像。
// 本物の写真の代わりに、商品名と分類の色で簡単な絵(SVG)をその場で作って返します(リポジトリに画像を置かないため)。
//
// 画像は変わらないので「1 日(86400 秒)まで手元や CDN に取っておいてよい」と Cache-Control で伝えます。
// cdn-waf のキャッシュの演習で、画像が 2 回目から速くなる(HIT)のを見るのに使います。
// (CCv2 では、画像などのメディアも api aspect の /medias/ から配り、CDN でキャッシュします)
'use strict';

const { pool } = require('../db');
const { sendError } = require('../http-common');

const COLORS = {
  stationery: ['#dbeafe', '#1d4ed8'],
  kitchen: ['#fef3c7', '#b45309'],
  living: ['#dcfce7', '#15803d'],
  digital: ['#ede9fe', '#6d28d9'],
  homepage: ['#ffe4e6', '#be123c'],
};

const xml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]);

// 長い名前は 9 文字ずつに折り返します(最大 3 行)。
function lines(text, width = 9) {
  const chars = [...text];
  const out = [];
  for (let i = 0; i < chars.length && out.length < 3; i += width) out.push(chars.slice(i, i + width).join(''));
  return out;
}

// 分類ごとの簡単な図形(ノート・カップ・家・画面)。
const ICONS = {
  stationery: '<rect x="150" y="70" width="100" height="130" rx="8"/><line x1="170" y1="100" x2="230" y2="100"/><line x1="170" y1="125" x2="230" y2="125"/><line x1="170" y1="150" x2="215" y2="150"/>',
  kitchen: '<path d="M150 90 h90 v80 a30 30 0 0 1 -30 30 h-30 a30 30 0 0 1 -30 -30 z"/><path d="M240 110 h15 a20 20 0 0 1 0 40 h-15"/>',
  living: '<path d="M140 140 L200 80 L260 140"/><rect x="155" y="140" width="90" height="65"/>',
  digital: '<rect x="135" y="80" width="130" height="85" rx="6"/><line x1="170" y1="195" x2="230" y2="195"/><line x1="200" y1="165" x2="200" y2="195"/>',
};

function productSvg(p) {
  const [bg, fg] = COLORS[p.category_code] ?? COLORS.homepage;
  const text = lines(p.name)
    .map((l, i) => `<text x="200" y="${262 + i * 34}" font-size="28" text-anchor="middle" fill="${fg}">${xml(l)}</text>`)
    .join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400" viewBox="0 0 400 400" role="img" aria-label="${xml(p.name)}">
<rect width="400" height="400" fill="${bg}"/>
<g fill="none" stroke="${fg}" stroke-width="8" stroke-linecap="round" stroke-linejoin="round">${ICONS[p.category_code] ?? ''}</g>
<g font-family="sans-serif" font-weight="bold">${text}</g>
<text x="200" y="385" font-family="monospace" font-size="16" text-anchor="middle" fill="${fg}" opacity="0.7">${xml(p.code)}</text>
</svg>`;
}

function bannerSvg(key, title) {
  const [bg, fg] = COLORS[key] ?? COLORS.homepage;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="400" viewBox="0 0 1200 400" role="img" aria-label="${xml(title)}">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${bg}"/><stop offset="1" stop-color="#ffffff"/></linearGradient></defs>
<rect width="1200" height="400" fill="url(#g)"/>
<circle cx="1020" cy="120" r="160" fill="${fg}" opacity="0.12"/><circle cx="1100" cy="330" r="110" fill="${fg}" opacity="0.08"/>
<text x="80" y="190" font-family="sans-serif" font-size="64" font-weight="bold" fill="${fg}">${xml(title)}</text>
<text x="80" y="260" font-family="sans-serif" font-size="28" fill="${fg}" opacity="0.8">SAMPLE STORE</text>
</svg>`;
}

function send(res, svg) {
  res.set('Content-Type', 'image/svg+xml; charset=utf-8');
  res.set('Cache-Control', 'public, max-age=86400');
  // SVG の中でスクリプトが動かないようにします(SVG は画像でもあり、文書でもあるため)。
  res.set('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'");
  res.set('X-Content-Type-Options', 'nosniff');
  res.send(svg);
}

async function mediaHandler(req, res) {
  const m = String(req.params.file).match(/^([A-Za-z0-9-]{1,40})\.svg$/);
  if (!m) return sendError(res, 404, 'UnknownIdentifierError', '画像が見つかりません');
  const code = m[1];
  if (code === 'banner-homepage') return send(res, bannerSvg('homepage', 'サンプルストア'));
  if (code.startsWith('banner-')) {
    const { rows } = await pool.query('SELECT code, name FROM categories WHERE code = $1', [code.slice(7)]);
    if (rows.length === 0) return sendError(res, 404, 'UnknownIdentifierError', '画像が見つかりません');
    return send(res, bannerSvg(rows[0].code, rows[0].name));
  }
  const { rows } = await pool.query('SELECT code, name, category_code FROM products WHERE code = $1', [code]);
  if (rows.length === 0) return sendError(res, 404, 'UnknownIdentifierError', '画像が見つかりません');
  return send(res, productSvg(rows[0]));
}

module.exports = { mediaHandler };
