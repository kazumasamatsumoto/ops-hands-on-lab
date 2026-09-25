// シナリオ 3: 画面比較(見た目の崩れを機械で見つける)
// 初回(または --update-snapshots)で撮った画像を基準として保存し、次からは基準と比べます。
// 毎回変わりうる部分(画面下の「描画モード」の表示)は隠してから比べます。
import { expect, test } from '@playwright/test';

const pages = [
  { name: 'top', path: '/', heading: 'サンプルストアへようこそ' },
  { name: 'product-list', path: '/products', heading: '商品一覧' },
  { name: 'product-detail', path: '/products/1', heading: 'ノート A5 方眼' },
];

for (const p of pages) {
  test(`画面比較: ${p.name}`, async ({ page }) => {
    await page.goto(p.path);
    await expect(page.getByRole('heading', { name: p.heading })).toBeVisible();
    await expect(page).toHaveScreenshot(`${p.name}.png`, {
      fullPage: true,
      mask: [page.getByTestId('render-mode')],
    });
  });
}
