// シナリオ 3: 画面比較(見た目の崩れを機械で見つける)
// 初回(または --update-snapshots)で撮った画像を基準として保存し、次からは基準と比べます。
// 毎回変わりうる部分は隠して(mask)から比べます:
//   - 画面下の「描画モード」の表示
//   - 在庫の数と「在庫なし」の印(worker の定期ジョブ stockImportJob が 1 分ごとに少しずつ変えるため。「在庫なし」の印は消してから撮る)
import { expect, test } from '@playwright/test';
import { settleImages } from './helpers';

const pages = [
  { name: 'top', path: '/', heading: '秋の文房具フェア' },
  { name: 'search', path: '/search?q=' + encodeURIComponent('ノート'), heading: '商品を探す' },
  { name: 'product-detail', path: '/p/100001', heading: 'ノート A5 方眼' },
];

for (const p of pages) {
  test(`画面比較: ${p.name}`, async ({ page }) => {
    await page.goto(p.path);
    await expect(page.getByRole('heading', { level: 1, name: p.heading })).toBeVisible();
    await settleImages(page);
    // 「在庫なし」の印は、あるか無いかで行の高さ(並び)まで変わるので、隠す(mask)だけでは比べられません。
    // 比べる前に印そのものを消して(display: none)、在庫がどう変わっても同じ並びで撮ります。
    await page.addStyleTag({ content: '.badge.out { display: none !important; }' });
    await expect(page).toHaveScreenshot(`${p.name}.png`, {
      fullPage: true,
      mask: [page.getByTestId('render-mode'), page.getByText(/^\s*在庫:/), page.getByText('在庫なし')],
    });
  });
}
