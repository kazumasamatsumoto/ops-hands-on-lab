// Playwright の設定です。tools/e2e.sh が Docker(mcr.microsoft.com/playwright)の中で動かします。
//
// - 相手は利用者と同じ URL(http://www.lab.localhost:18080)。cdn-waf → ingress → storefront / api を通ります。
//   tools/e2e.sh は、テストのコンテナを cdn-waf と同じネットワークの部屋(--network container:...)に入れます。
//   ブラウザは *.localhost を必ず自分自身(127.0.0.1)として引くので、そこで待っている cdn-waf に届く、というしくみです。
// - cdn-waf には「IP ごとに 1 秒 20 回まで」、ingress には「ログインは 1 秒 1 回まで」の制限があるので、テストは 1 本ずつ順番に流します(workers: 1)。
// - 画面比較の基準画像は tests/*-snapshots/ に保存し、リポジトリで管理します。
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 45_000,
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
    baseURL: process.env.BASE_URL ?? 'http://www.lab.localhost:18080',
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
