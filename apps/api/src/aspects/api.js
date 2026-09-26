// ASPECT=api — 外から呼ばれる REST API(OCC 風)・OAuth の認可サーバー・画像。
// CCv2 の api aspect に当たります。storefront(ブラウザと SSR の両方)が呼ぶのはここだけです。
'use strict';

const express = require('express');
const { chaosMiddleware, mountChaosAdmin } = require('../chaos');
const { createApp, finishApp, sendError } = require('../http-common');
const { corsMiddleware } = require('../occ/cors');
const { searchHandler } = require('../occ/search');
const { cmsPagesHandler } = require('../occ/cms');
const { tokenHandler, revokeHandler, requireToken } = require('../occ/oauth');
const { listHandler, detailHandler } = require('../occ/orders');
const { mediaHandler } = require('../occ/medias');
const { findProduct } = require('../occ/products-repo');
const format = require('../occ/format');

// サイト ID(baseSiteId)。CCv2 では 1 つの api で複数のお店(サイト)を持てるので、URL にどのお店かを入れます。
const BASE_SITE = 'samplestore';

function build() {
  const app = createApp();
  app.use(corsMiddleware);
  app.use(express.json({ limit: '100kb' }));

  const occ = express.Router();
  // 遅延・エラー・メモリ漏れのスイッチは、OCC の API 全部に効きます。
  occ.use(chaosMiddleware);

  occ.get('/products/search', searchHandler);

  occ.get('/products/:code', async (req, res) => {
    const row = await findProduct(String(req.params.code));
    if (!row) return sendError(res, 404, 'UnknownIdentifierError', `商品が見つかりません: ${req.params.code}`);
    res.json(format.product(row, format.fieldsLevel(req.query.fields)));
  });

  occ.get('/cms/pages', cmsPagesHandler);

  // ログイン中の本人(画面の「アリスさん」表示などに使えます)。
  occ.get('/users/current', requireToken, (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json({ uid: req.user.uid, name: req.user.name });
  });
  occ.get('/users/current/orders', requireToken, listHandler);
  occ.get('/users/current/orders/:code', requireToken, detailHandler);

  app.use(`/occ/v2/${BASE_SITE}`, occ);

  // OAuth の認可サーバー。フォームの形(application/x-www-form-urlencoded)で受けます。
  const form = express.urlencoded({ extended: false, limit: '10kb' });
  app.post('/authorizationserver/oauth/token', form, chaosMiddleware, tokenHandler);
  app.post('/authorizationserver/oauth/revoke', form, revokeHandler);

  app.get('/medias/:file', mediaHandler);

  // /admin/* は ingress で外から届かないようにしています(社内からだけ使う想定)。
  mountChaosAdmin(app);
  finishApp(app);
  return app;
}

module.exports = { build };
