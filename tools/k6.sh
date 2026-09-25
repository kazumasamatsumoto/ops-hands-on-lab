#!/usr/bin/env bash
# k6(負荷をかける道具)を Docker で動かします。PC に k6 を入れる必要はありません。
#
#   使い方: tools/k6.sh browse.js      普通の利用者(一覧 → 詳細)を数人ぶん
#           tools/k6.sh ramp.js        段階的に負荷を上げる試験
#
# 既定では edge(http://edge:8080)を通します。edge には「IP ごとに 1 秒 20 回まで」のレート制限があるため、
# 強い負荷をかけると 429 が返ります(それ自体が演習の見どころです)。
# アプリそのものの性能を測りたいときは、api に直接かけます:
#   BASE_URL=http://api:3001 tools/k6.sh ramp.js
set -euo pipefail
cd "$(dirname "$0")/.."

script="${1:?スクリプト名を指定してください(例: browse.js)}"
shift || true
docker run --rm -i \
  --network lab_default \
  -e BASE_URL="${BASE_URL:-http://edge:8080}" \
  grafana/k6:1.8.1 run "$@" - < "tools/k6/${script}"
