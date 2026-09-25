// シナリオ 2: 他人の注文が見えない(認可)
// bob でログインし、alice の注文(注文番号 1)の URL を直接開きます。「見つかりません」と出て、中身が出ないことを確かめます。
// tools/chaos.sh set idorBug=true にすると、このテストが落ちます(= テストが効いている)。
import { expect, test } from '@playwright/test';
import { login } from './helpers';

test('bob は alice の注文を見られない', async ({ page }) => {
  await login(page, 'bob');
  await page.goto('/me/orders/1');
  await expect(page.getByRole('heading', { name: '注文 1' })).toBeVisible();
  await expect(page.getByText('見つかりませんでした')).toBeVisible();
  await expect(page.getByRole('row', { name: /合計/ })).toHaveCount(0);
});
