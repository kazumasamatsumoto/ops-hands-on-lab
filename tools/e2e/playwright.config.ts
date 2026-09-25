// Playwright の設定です。tools/e2e.sh が Docker(mcr.microsoft.com/playwright)の中で動かします。
//
// - 相手は利用者と同じ通り道の edge(Docker のネットワークの中からは http://edge:8080)。
// - edge には「IP ごとに 1 秒 20 回まで」のレート制限があるので、テストは 1 本ずつ順番に流します(workers: 1)。
// - 画面比較の基準画像は tests/*-snapshots/ に保存し、リポジトリで管理します。
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 30_000,
  expect: {
    timeout: 10_000,
    // 画面比較: 違ってよい画素は 50 個まで。
    // 「画面全体の 1%」のような割合にすると、1280×800 の画面では 1 万画素まで見逃します(価格の文字が大きくなった程度では落ちません)。
    // 同じ Docker イメージの同じブラウザで撮るので、にじみによる違いはほぼ 0 です。
    toHaveScreenshot: { maxDiffPixels: 50, animations: 'disabled' },
  },
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
  outputDir: 'test-results',
  use: {
    baseURL: process.env.BASE_URL ?? 'http://edge:8080',
    locale: 'ja-JP',
    timezoneId: 'Asia/Tokyo',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      // 画面の大きさを固定する(撮るたびに変わらないように)
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } },
    },
  ],
});
