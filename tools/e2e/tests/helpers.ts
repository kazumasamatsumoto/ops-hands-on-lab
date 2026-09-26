import { expect, Page } from '@playwright/test';

/** api の外向きの住所(ブラウザが別オリジンとして呼ぶ先) */
export const API_ORIGIN = 'http://api.lab.localhost:18080';

/** ログイン画面から会員名とパスワードを入れてログインし、注文履歴に移るまで待ちます。 */
export async function login(page: Page, username: string, password = 'password'): Promise<void> {
  await page.getByRole('link', { name: 'ログイン' }).click();
  await expect(page.getByRole('heading', { name: 'ログイン' })).toBeVisible();
  await page.getByLabel('会員名').fill(username);
  await page.getByLabel('パスワード').fill(password);
  await page.getByRole('button', { name: 'ログイン' }).click();
  await expect(page).toHaveURL(/\/my-account\/orders$/);
}

/**
 * ブラウザのコンソールに出た「CSP で止められた」「CORS で読めなかった」などのエラーを集めます。
 * 画面は出ていても、裏で api の呼び出しが止められていることがあるので、テストの最後に「0 件」を確かめます。
 */
export function collectBrowserErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  page.on('pageerror', (err) => errors.push(err.message));
  return errors;
}

/** 遅延読み込み(loading="lazy")の画像も含めて、画面の画像が全部読み終わるまで待ちます(画面比較の前に使う)。 */
export async function settleImages(page: Page): Promise<void> {
  await page.evaluate(async () => {
    window.scrollTo(0, document.body.scrollHeight);
    await new Promise((r) => setTimeout(r, 200));
    window.scrollTo(0, 0);
  });
  await page.waitForLoadState('networkidle');
  await page.waitForFunction(() => Array.from(document.images).every((img) => img.complete));
}
