#!/usr/bin/env bash
# データベースのバックアップ(丸ごと書き出し)を取ります。
#   使い方: tools/backup.sh
#   できる物: backups/store-年月日-時分秒.sql
#
# db コンテナの中の pg_dump を使います。--clean を付けているので、
# 復元するときは「今あるテーブルを消してから作り直す」形になります。
set -euo pipefail
cd "$(dirname "$0")/.."

mkdir -p backups
file="backups/store-$(date +%Y%m%d-%H%M%S).sql"
docker compose exec -T db pg_dump -U store -d store --clean --if-exists --no-owner > "$file"
echo "バックアップを取りました: $file ($(wc -c < "$file" | tr -d ' ') バイト)"
