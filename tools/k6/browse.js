// 普通の利用者のまね: 商品一覧 → 商品詳細 を、考える時間(sleep)をはさみながら見て回ります。
//   実行: tools/k6.sh browse.js
//   人数や時間を変える: tools/k6.sh browse.js -e VUS=10 -e DURATION=5m
//   画面(HTML)を見ずに API だけにする: tools/k6.sh browse.js -e PAGES=0
import http from 'k6/http';
import { check, sleep } from 'k6';

const BASE_URL = __ENV.BASE_URL || 'http://edge:8080';
const WITH_PAGES = __ENV.PAGES !== '0';

export const options = {
  vus: Number(__ENV.VUS || 5), // 同時に動く利用者の数(VU = 仮想の利用者)
  duration: __ENV.DURATION || '2m',
  // 合格の基準(しきい値)。満たさないと k6 は失敗として終わります。
  thresholds: {
    http_req_failed: ['rate<0.01'], // 失敗は 1% 未満
    http_req_duration: ['p(95)<500'], // 95% のリクエストが 0.5 秒以内
  },
};

export default function () {
  const list = http.get(`${BASE_URL}/api/products`, { tags: { name: 'api_products' } });
  check(list, { '一覧 API が 200': (r) => r.status === 200 });
  sleep(1);

  const id = 1 + Math.floor(Math.random() * 30);
  const detail = http.get(`${BASE_URL}/api/products/${id}`, { tags: { name: 'api_product_detail' } });
  check(detail, { '詳細 API が 200': (r) => r.status === 200 });

  if (WITH_PAGES) {
    const page = http.get(`${BASE_URL}/products/${id}`, { tags: { name: 'page_product_detail' } });
    check(page, { '詳細画面が 200': (r) => r.status === 200 });
  }
  sleep(1 + Math.random() * 2);
}
