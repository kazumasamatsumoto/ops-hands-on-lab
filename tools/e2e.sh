#!/usr/bin/env bash
# E2E テスト(Playwright)を Docker で動かします。PC に Node.js やブラウザを入れる必要はありません。
#
#   使い方: tools/e2e.sh                        全部のテスト(買い物の導線・他人の注文・画面比較)
#           tools/e2e.sh tests/journey.spec.ts  1 つのファイルだけ
#           tools/e2e.sh --update-snapshots     画面比較の基準画像を撮り直す(見た目を意図して変えたときだけ。レビューで承認してから)
#
# 先に docker compose up -d でラボを起動してください。
# テストのコンテナは cdn-waf と「同じネットワークの部屋」(--network container:lab-cdn-waf-1)に入ります。
# ブラウザは *.localhost の名前を必ず自分自身(127.0.0.1)として引くので、コンテナの中の 127.0.0.1:18080 = cdn-waf に届きます。
# こうすると、テストもホスト PC のブラウザと同じ URL(http://www.lab.localhost:18080)で動きます。
# 結果の詳しい報告は tools/e2e/playwright-report/index.html に出ます(失敗したときの画面や差分の画像もここで見られます)。
set -euo pipefail
cd "$(dirname "$0")/e2e"

# テストの道具(@playwright/test)と Docker イメージの版は、必ず同じ番号にそろえます(package.json と合わせる)。
IMAGE="mcr.microsoft.com/playwright:v1.63.0-noble"
CDN_WAF="$(docker compose -p lab ps -q cdn-waf)"
if [ -z "$CDN_WAF" ]; then
  echo "cdn-waf が動いていません。先に docker compose up -d を実行してください。" >&2
  exit 1
fi

docker run --rm --init --ipc=host \
  --network "container:${CDN_WAF}" \
  --user "$(id -u):$(id -g)" \
  -e HOME=/tmp -e NPM_CONFIG_UPDATE_NOTIFIER=false \
  -e BASE_URL="${BASE_URL:-http://www.lab.localhost:18080}" \
  -v "$PWD":/work -w /work \
  "$IMAGE" \
  sh -c 'npm ci --no-audit --no-fund --loglevel=error && npx playwright test "$@"' -- "$@"
