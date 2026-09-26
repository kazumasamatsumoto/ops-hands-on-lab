// シナリオ 1: 買い物の導線(トップ → 検索 → 商品詳細 → ログイン → 注文履歴 → 注文の詳細)
// 確かめるのは、利用者が頼りにする物(見出し・商品名・価格・注文の合計)です。HTML の細かい形(クラス名)には頼りません。
// あわせて、ブラウザが api(別オリジン)を呼べていること(CORS)と、CSP に止められていないことも確かめます。
import { expect, test } from '@playwright/test';
import { API_ORIGIN, collectBrowserErrors, login } from './helpers';

test('トップ → 検索 → 商品詳細 → ログイン → 注文履歴 が最後まで進める', async ({ page }) => {
  const errors = collectBrowserErrors(page);
  // ブラウザから api への呼び出し(別オリジン)を記録します
  const apiCalls: string[] = [];
  page.on('requestfinished', (req) => {
    if (req.url().startsWith(API_ORIGIN) && req.resourceType() === 'fetch') apiCalls.push(req.url());
  });

  await test.step('トップ(サーバーで描画され、CMS の部品が並ぶ)', async () => {
    // SSR が壊れて CSR に逃げていても画面は出るので、見た目だけでは気づけません。応答ヘッダも確かめます。
    const response = await page.goto('/');
    expect(response?.status()).toBe(200);
    expect(response?.headers()['x-render-mode']).toBe('ssr');
    await expect(page.getByRole('heading', { level: 1, name: '秋の文房具フェア' })).toBeVisible();
    await expect(page.locator('[data-cms-type="ProductCarouselComponent"]').first()).toBeVisible();
  });

  await test.step('検索', async () => {
    await page.getByRole('search').getByLabel('商品を探す').first().fill('ノート');
    await page.getByRole('search').getByRole('button', { name: '探す' }).first().click();
    await expect(page).toHaveURL(/\/search\?q=/);
    await expect(page.getByRole('heading', { name: '商品を探す' })).toBeVisible();
    await expect(page.getByRole('link', { name: /ノート A5 方眼/ })).toBeVisible();
  });

  await test.step('商品詳細(画面の中の移動 = ブラウザが api を別オリジンで呼ぶ)', async () => {
    await page.getByRole('link', { name: /ノート A5 方眼/ }).click();
    await expect(page).toHaveURL(/\/p\/100001$/);
    await expect(page.getByRole('heading', { level: 1, name: 'ノート A5 方眼' })).toBeVisible();
    await expect(page.getByText('￥330').first()).toBeVisible();
    expect(apiCalls.some((u) => u.includes('/occ/v2/samplestore/'))).toBe(true);
  });

  await test.step('ログインして注文履歴', async () => {
    await login(page, 'alice');
    await expect(page.getByRole('heading', { name: '注文履歴' })).toBeVisible();
    await expect(page.getByRole('link', { name: '00001001', exact: true })).toBeVisible();
  });

  await test.step('注文の詳細', async () => {
    await page.getByRole('link', { name: '00001001', exact: true }).click();
    await expect(page.getByRole('heading', { name: '注文 00001001' })).toBeVisible();
    await expect(page.getByRole('row', { name: /合計/ })).toContainText('￥1,485');
  });

  await test.step('CSP・CORS のエラーが出ていない', async () => {
    expect(errors.filter((e) => /Content Security Policy|CORS|Access-Control/i.test(e))).toEqual([]);
  });
});

test('無い商品は 404 で「ページを表示できませんでした」', async ({ page }) => {
  // 商品が無いと、CMS のページ(pageType=ProductPage)も 404 になります。SSR の応答の状態コードも 404 です。
  const response = await page.goto('/p/NO-SUCH-CODE');
  expect(response?.status()).toBe(404);
  await expect(page.getByText('ページを表示できませんでした')).toBeVisible();
});
