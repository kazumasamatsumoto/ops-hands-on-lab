import { expect, Page } from '@playwright/test';

/** ログイン画面から会員名とパスワードを入れてログインし、注文履歴に移るまで待ちます。 */
export async function login(page: Page, username: string, password = 'password'): Promise<void> {
  await page.goto('/login');
  await expect(page.getByRole('heading', { name: 'ログイン' })).toBeVisible();
  await page.getByLabel('会員名').fill(username);
  await page.getByLabel('パスワード').fill(password);
  await page.getByRole('button', { name: 'ログイン' }).click();
  await expect(page).toHaveURL(/\/me\/orders$/);
}
