// 普通の利用者のまね: トップ → 検索 → 商品詳細 を、考える時間(sleep)をはさみながら見て回ります。
// ブラウザと同じように、画面(www)の HTML と、ブラウザが呼ぶ api(OCC)の両方を取ります。
//   実行: tools/k6.sh browse.js
//   人数や時間を変える: tools/k6.sh browse.js -e VUS=10 -e DURATION=5m
//   画面(HTML)を見ずに api だけにする: tools/k6.sh browse.js -e PAGES=0
import http from 'k6/http';
import { check, sleep } from 'k6';

const WWW = __ENV.WWW_URL || 'http://www.lab.localhost:18080';
const API = __ENV.API_URL || 'http://api.lab.localhost:18080';
const OCC = `${API}/occ/v2/samplestore`;
const WITH_PAGES = __ENV.PAGES !== '0';
const WORDS = ['ノート', 'ペン', 'マグ', 'タオル', 'ケーブル', ''];

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
  if (WITH_PAGES) {
    const home = http.get(`${WWW}/`, { tags: { name: 'page_home' } });
    check(home, { 'トップ画面が 200': (r) => r.status === 200 });
  }
  const cms = http.get(`${OCC}/cms/pages?pageType=ContentPage&pageLabelOrId=homepage`, { tags: { name: 'api_cms_home' } });
  check(cms, { 'CMS API が 200': (r) => r.status === 200 });
  sleep(1);

  const word = WORDS[Math.floor(Math.random() * WORDS.length)];
  const search = http.get(`${OCC}/products/search?query=${encodeURIComponent(word)}&pageSize=12`, {
    tags: { name: 'api_search' },
  });
  check(search, { '検索 API が 200': (r) => r.status === 200 });
  sleep(1);

  const code = String(100001 + Math.floor(Math.random() * 30));
  const detail = http.get(`${OCC}/products/${code}?fields=FULL`, { tags: { name: 'api_product' } });
  check(detail, { '商品 API が 200': (r) => r.status === 200 });
  if (WITH_PAGES) {
    const page = http.get(`${WWW}/p/${code}`, { tags: { name: 'page_product' } });
    check(page, { '商品詳細の画面が 200': (r) => r.status === 200 });
  }
  sleep(1 + Math.random() * 2);
}
