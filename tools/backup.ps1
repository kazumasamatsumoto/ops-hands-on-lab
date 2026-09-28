#Requires -Version 7.0
# データベースのバックアップ(丸ごと書き出し)を取ります(PowerShell 7 版。Mac / Linux / WSL は tools/backup.sh)。
#   使い方: tools/backup.ps1
#   できる物: backups/store-年月日-時分秒.sql
#
# db コンテナの中の pg_dump を使います。--clean を付けているので、
# 復元するときは「今あるテーブルを消してから作り直す」形になります。
#
# PowerShell の「> ファイル」は文字コードや改行を変えてしまうことがあるので、
# いったんコンテナの中(/tmp/backup.sql)に書き出してから、docker compose cp でそのまま取り出します。
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

# リポジトリの一番上に移動します(終わったら元の場所に戻します)。
Push-Location (Join-Path $PSScriptRoot '..')
try {
  New-Item -ItemType Directory -Path 'backups' -Force | Out-Null
  $file = "backups/store-$(Get-Date -Format 'yyyyMMdd-HHmmss').sql"

  # 1. コンテナの中で書き出す(pg_dump が失敗したら docker compose exec の終了コードも 0 以外になります)
  & docker compose exec -T db sh -c 'pg_dump -U store -d store --clean --if-exists --no-owner > /tmp/backup.sql'
  if ($LASTEXITCODE -ne 0) {
    throw "pg_dump が失敗しました(終了コード $LASTEXITCODE)。ラボは起動していますか(docker compose ps)。"
  }
  # 2. そのまま(バイト単位で)手元に取り出す(--progress quiet: 「Copying ...」の進み具合は出さない)
  & docker compose --progress quiet cp db:/tmp/backup.sql $file
  if ($LASTEXITCODE -ne 0) {
    throw "バックアップの取り出し(docker compose cp)に失敗しました(終了コード $LASTEXITCODE)。"
  }
  # 3. コンテナの中の一時ファイルは消しておく(消せなくても支障はありません)
  & docker compose exec -T db rm -f /tmp/backup.sql 2>$null | Out-Null

  $bytes = (Get-Item -LiteralPath $file).Length
  "バックアップを取りました: $file ($bytes バイト)"
} finally {
  Pop-Location
}
