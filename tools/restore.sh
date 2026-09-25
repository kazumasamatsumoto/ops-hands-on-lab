#!/usr/bin/env bash
# バックアップからデータベースを元に戻します(今のデータは上書きされます)。
#   使い方: tools/restore.sh backups/store-20260101-120000.sql
#   ファイルを省くと、いちばん新しいバックアップを使います。
set -euo pipefail
cd "$(dirname "$0")/.."

file="${1:-$(ls -t backups/store-*.sql 2>/dev/null | head -n 1 || true)}"
if [ -z "$file" ] || [ ! -f "$file" ]; then
  echo "バックアップのファイルが見つかりません。先に tools/backup.sh を実行してください。" >&2
  exit 1
fi
echo "復元します: $file"
# ON_ERROR_STOP=1: 途中でエラーが出たらそこで止める(中途半端な状態で「成功」と言わないため)。
# --single-transaction: 全部成功するか、何も変えないかのどちらかにする。
docker compose exec -T db psql -U store -d store -v ON_ERROR_STOP=1 --single-transaction -q < "$file" > /dev/null
echo "復元しました。"
