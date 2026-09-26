// スモークテスト: 主な URL を 1 回ずつ開き、返事が正しいかだけを確かめます(負荷はかけません)。
//   実行: tools/k6.sh smoke.js
// リリースの直後などに「煙が出ていないか(大きく壊れていないか)」を 10 秒で確かめる使い方をします。
import http from 'k6/http';
import { check } from 'k6';

const WWW = __ENV.WWW_URL || 'http://www.lab.localhost:18080';
const API = __ENV.API_URL || 'http://api.lab.localhost:18080';
const OCC = `${API}/occ/v2/samplestore`;

export const options = {
  vus: 1,
  iterations: 1,
  thresholds: {
    checks: ['rate==1'], // 1 つでも外れたら失敗
  },
};

export default function () {
  const home = http.get(`${WWW}/`);
  check(home, {
    'トップが 200': (r) => r.status === 200,
    'トップはサーバーで描画(X-Render-Mode: ssr)': (r) => r.headers['X-Render-Mode'] === 'ssr',
    'トップに CMS のバナーがある': (r) => r.body.includes('data-cms-type="SimpleBannerComponent"'),
  });
  check(http.get(`${WWW}/p/100001`), { '商品詳細が 200': (r) => r.status === 200 });
  // 404・403 が「正しい答え」のものは、expectedStatuses で失敗の数(http_req_failed)に入れないようにします。
  check(http.get(`${WWW}/p/NO-SUCH-CODE`, { responseCallback: http.expectedStatuses(404) }), { '無い商品は 404': (r) => r.status === 404 });
  check(http.get(`${WWW}/search?q=${encodeURIComponent('ノート')}`), { '検索画面が 200': (r) => r.status === 200 });

  const search = http.get(`${OCC}/products/search?query=${encodeURIComponent('ノート')}&pageSize=5`);
  check(search, {
    '検索 API が 200': (r) => r.status === 200,
    '検索 API が商品を返す': (r) => r.json('pagination.totalResults') > 0,
  });
  check(http.get(`${OCC}/products/100001`), { '商品 API が 200': (r) => r.status === 200 });
  check(http.get(`${OCC}/cms/pages?pageType=ContentPage&pageLabelOrId=homepage`), { 'CMS API が 200': (r) => r.status === 200 });
  check(http.get(`${API}/medias/100001.svg`), { '商品画像が 200': (r) => r.status === 200 });

  const token = http.post(`${API}/authorizationserver/oauth/token`, {
    grant_type: 'password',
    client_id: 'storefront',
    username: 'alice',
    password: 'password',
  });
  check(token, { 'トークンが取れる': (r) => r.status === 200 && !!r.json('access_token') });
  const orders = http.get(`${OCC}/users/current/orders`, {
    headers: { Authorization: `Bearer ${token.json('access_token')}` },
  });
  check(orders, { '注文の一覧が取れる': (r) => r.status === 200 && r.json('orders').length > 0 });
  check(http.get(`${API}/admin/chaos`, { responseCallback: http.expectedStatuses(403) }), { '/admin/ は外から 403': (r) => r.status === 403 });
}
