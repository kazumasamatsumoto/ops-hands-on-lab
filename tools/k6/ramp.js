// 段階的に負荷を上げる試験(ステップ負荷)。どこで遅くなるか・どこで 429 や 500 が出るかを見ます。
//   実行: tools/k6.sh ramp.js
//   edge を通さずアプリだけ測る: BASE_URL=http://api:3001 tools/k6.sh ramp.js
//   API ではなく画面(サーバーで描画する商品詳細)を測る: tools/k6.sh ramp.js -e TARGET=page
//     (edge を通さず web だけ測るなら BASE_URL=http://web:4000 tools/k6.sh ramp.js -e TARGET=page)
//
// 見どころ:
//   - edge 経由だと、同じ IP から 1 秒 20 回を超えると 429(レート制限)が返ります。
//   - Grafana の「サンプルストア SLO」で p95 と成功率の変化を同時に見てください。
import http from 'k6/http';
import { check, sleep } from 'k6';

const BASE_URL = __ENV.BASE_URL || 'http://edge:8080';
// api = 商品詳細の API(GET /api/products/:id)、page = 商品詳細の画面(GET /products/:id。web がサーバーで描画する)
const TARGET = __ENV.TARGET === 'page' ? 'page' : 'api';

export const options = {
  stages: [
    { duration: '30s', target: 5 }, // 30 秒かけて 5 人まで増やす
    { duration: '1m', target: 5 }, // 5 人のまま 1 分
    { duration: '30s', target: 20 }, // 20 人まで増やす
    { duration: '1m', target: 20 },
    { duration: '30s', target: 50 }, // 50 人まで増やす
    { duration: '1m', target: 50 },
    { duration: '30s', target: 0 }, // 片付け
  ],
  thresholds: {
    http_req_duration: ['p(95)<1000'],
  },
};

export default function () {
  const id = 1 + Math.floor(Math.random() * 30);
  const res =
    TARGET === 'page'
      ? http.get(`${BASE_URL}/products/${id}`, { tags: { name: 'page_product_detail' } })
      : http.get(`${BASE_URL}/api/products/${id}`, { tags: { name: 'api_product_detail' } });
  check(res, {
    '200(成功)': (r) => r.status === 200,
    '429 ではない(レート制限に当たっていない)': (r) => r.status !== 429,
    '5xx ではない': (r) => r.status < 500,
  });
  sleep(0.5);
}
