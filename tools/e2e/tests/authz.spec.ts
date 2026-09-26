// シナリオ 2: 他人の注文が見えない(認可)
// bob でログインし、alice の注文(00001001)の URL を開きます。エラーになり、中身(合計)が出ないことを確かめます。
// tools/chaos.sh set idorBug=true にすると、このテストが落ちます(= テストが効いている)。
import { expect, test } from '@playwright/test';
import { login } from './helpers';

test('bob は alice の注文を見られない', async ({ page }) => {
  await page.goto('/');
  await login(page, 'bob');
  // URL を直接開きます(トークンはタブの sessionStorage にあるので、読み直してもログインは続きます)
  await page.goto('/my-account/orders/00001001');
  await expect(page.getByRole('heading', { name: '注文 00001001' })).toBeVisible();
  await expect(page.getByText('注文を表示できませんでした')).toBeVisible();
  await expect(page.getByRole('row', { name: /合計/ })).toHaveCount(0);
});
