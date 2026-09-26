#!/usr/bin/env bash
# k6(負荷をかける道具)を Docker で動かします。PC に k6 を入れる必要はありません。
#
#   使い方: tools/k6.sh smoke.js       主な URL を 1 回ずつ確かめる(煙が出ないかの確認 = スモークテスト)
#           tools/k6.sh browse.js      普通の利用者(トップ → 検索 → 商品詳細)を数人ぶん
#           tools/k6.sh ramp.js        段階的に負荷を上げる試験
#
# 既定では、利用者と同じ URL(http://www.lab.localhost:18080 と http://api.lab.localhost:18080)で、cdn-waf を通します。
# k6 はコンテナの中で動くので、--add-host で 3 つのホスト名を cdn-waf の IP(172.30.89.10)に向けています。
# cdn-waf には「IP ごとに 1 秒 20 回まで」のレート制限があるため、強い負荷をかけると 429 が返ります(それ自体が演習の見どころです)。
# アプリそのものの性能を測りたいときは、cdn-waf と ingress を通さず直接かけます:
#   API_URL=http://api:3001 tools/k6.sh ramp.js
#   WWW_URL=http://storefront:4000 tools/k6.sh ramp.js -e TARGET=page
set -euo pipefail
cd "$(dirname "$0")/.."

script="${1:?スクリプト名を指定してください(例: browse.js)}"
shift || true
# 本格版(kind)に向けるときは、ネットワークと cdn-waf の IP を変えます:
#   LAB_DOCKER_NETWORK=lab-kind CDN_WAF_IP=172.30.91.10 tools/k6.sh browse.js
CDN_WAF_IP="${CDN_WAF_IP:-172.30.89.10}"
docker run --rm -i \
  --network "${LAB_DOCKER_NETWORK:-lab_default}" \
  --add-host "www.lab.localhost:${CDN_WAF_IP}" \
  --add-host "api.lab.localhost:${CDN_WAF_IP}" \
  --add-host "backoffice.lab.localhost:${CDN_WAF_IP}" \
  -e WWW_URL="${WWW_URL:-http://www.lab.localhost:18080}" \
  -e API_URL="${API_URL:-http://api.lab.localhost:18080}" \
  grafana/k6:1.8.1 run "$@" - < "tools/k6/${script}"
