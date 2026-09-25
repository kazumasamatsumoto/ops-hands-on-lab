// シナリオ 1: 買い物の導線(トップ → 商品一覧 → 商品詳細 → ログイン → 注文履歴 → 注文の詳細)
// 確かめるのは、利用者が頼りにする物(見出し・商品名・価格・注文の合計)です。HTML の細かい形(クラス名)には頼りません。
import { expect, test } from '@playwright/test';
import { login } from './helpers';

test('一覧 → 詳細 → ログイン → 注文履歴 が最後まで進める', async ({ page }) => {
  await test.step('トップ', async () => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'サンプルストアへようこそ' })).toBeVisible();
  });

  await test.step('商品一覧', async () => {
    await page.getByRole('navigation').getByRole('link', { name: '商品一覧' }).click();
    await expect(page.getByRole('heading', { name: '商品一覧' })).toBeVisible();
    await expect(page.getByRole('link', { name: /ノート A5 方眼/ })).toBeVisible();
  });

  await test.step('商品詳細(サーバーで描画されていること)', async () => {
    // SSR が壊れて CSR に逃げていても画面は出るので、見た目だけでは気づけません。応答ヘッダも確かめます。
    const response = await page.goto('/products/1');
    expect(response?.status()).toBe(200);
    expect(response?.headers()['x-render-mode']).toBe('ssr');
    await expect(page.getByRole('heading', { name: 'ノート A5 方眼' })).toBeVisible();
    await expect(page.getByText('330 円')).toBeVisible();
  });

  await test.step('ログインして注文履歴', async () => {
    await login(page, 'alice');
    await expect(page.getByRole('heading', { name: '注文履歴' })).toBeVisible();
    const rows = page.getByRole('row').filter({ has: page.getByRole('link') });
    await expect(rows.first()).toBeVisible();
    expect(await rows.count()).toBeGreaterThanOrEqual(1);
  });

  await test.step('注文の詳細', async () => {
    await page.getByRole('link', { name: '1', exact: true }).click();
    await expect(page.getByRole('heading', { name: '注文 1' })).toBeVisible();
    await expect(page.getByRole('row', { name: /合計/ })).toContainText('1,485 円');
  });
});
