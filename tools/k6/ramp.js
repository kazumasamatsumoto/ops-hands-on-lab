// 段階的に負荷を上げる試験(ステップ負荷)。どこで遅くなるか・どこで 429 や 500 が出るかを見ます。
//   実行: tools/k6.sh ramp.js
//   cdn-waf・ingress を通さずアプリだけ測る: API_URL=http://api:3001 tools/k6.sh ramp.js
//   api ではなく画面(サーバーで描画する商品詳細)を測る: tools/k6.sh ramp.js -e TARGET=page
//     (storefront だけ測るなら WWW_URL=http://storefront:4000 tools/k6.sh ramp.js -e TARGET=page)
//
// 見どころ:
//   - cdn-waf 経由だと、同じ IP から 1 秒 20 回を超えると 429(レート制限)が返ります。
//   - cdn-waf のキャッシュが効いていると、ほとんどが HIT になり api まで届きません(EDGE_CACHE=off と比べる)。
//   - Grafana の「サンプルストア SLO」で p95 と成功率の変化を同時に見てください。
import http from 'k6/http';
import { check, sleep } from 'k6';

const WWW = __ENV.WWW_URL || 'http://www.lab.localhost:18080';
const API = __ENV.API_URL || 'http://api.lab.localhost:18080';
// api = 商品 1 件の API(GET /occ/v2/samplestore/products/{code})、page = 商品詳細の画面(GET /p/{code}。storefront がサーバーで描画する)
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
  const code = String(100001 + Math.floor(Math.random() * 30));
  const res =
    TARGET === 'page'
      ? http.get(`${WWW}/p/${code}`, { tags: { name: 'page_product' } })
      : http.get(`${API}/occ/v2/samplestore/products/${code}`, { tags: { name: 'api_product' } });
  check(res, {
    '200(成功)': (r) => r.status === 200,
    '429 ではない(レート制限に当たっていない)': (r) => r.status !== 429,
    '5xx ではない': (r) => r.status < 500,
  });
  sleep(0.5);
}
