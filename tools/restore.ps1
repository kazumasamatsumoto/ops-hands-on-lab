#Requires -Version 7.0
# バックアップからデータベースを元に戻します(今のデータは上書きされます)。PowerShell 7 版(Mac / Linux / WSL は tools/restore.sh)。
#   使い方: tools/restore.ps1 backups/store-20260101-120000.sql
#   ファイルを省くと、いちばん新しいバックアップを使います。
#
# PowerShell には bash の「< ファイル」(標準入力)が無いので、ファイルを docker compose cp でコンテナの中
# (/tmp/restore.sql)に置いてから、psql に -f で読ませます。
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

# リポジトリの一番上に移動します(終わったら元の場所に戻します)。
Push-Location (Join-Path $PSScriptRoot '..')
try {
  $file = if ($args.Count -gt 0) {
    [string]$args[0]
  } else {
    # 更新日時がいちばん新しい物(bash 版の ls -t と同じ選び方)
    $latest = Get-ChildItem -Path 'backups' -Filter 'store-*.sql' -File -ErrorAction SilentlyContinue |
      Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if ($latest) { "backups/$($latest.Name)" } else { '' }
  }
  if (-not $file -or -not (Test-Path -LiteralPath $file -PathType Leaf)) {
    [Console]::Error.WriteLine('バックアップのファイルが見つかりません。先に tools/backup.ps1 を実行してください。')
    exit 1
  }
  "復元します: $file"

  & docker compose --progress quiet cp $file db:/tmp/restore.sql
  if ($LASTEXITCODE -ne 0) {
    throw "ファイルをコンテナに置けませんでした(docker compose cp、終了コード $LASTEXITCODE)。ラボは起動していますか(docker compose ps)。"
  }
  # ON_ERROR_STOP=1: 途中でエラーが出たらそこで止める(中途半端な状態で「成功」と言わないため)。
  # --single-transaction: 全部成功するか、何も変えないかのどちらかにする指定です。
  #   psql の説明書には「-c か -f と組み合わせて使う」とあるので、-f でファイルを読ませています。
  # 画面に出る「DROP TABLE」などの通知は要らないので、標準出力は捨てます(エラーは標準エラーに出るので見えます)。
  & docker compose exec -T db psql -U store -d store -v ON_ERROR_STOP=1 --single-transaction -q -f /tmp/restore.sql | Out-Null
  $code = $LASTEXITCODE
  # コンテナの中の一時ファイルは消しておく(消せなくても支障はありません)
  & docker compose exec -T db rm -f /tmp/restore.sql 2>$null | Out-Null
  if ($code -ne 0) {
    [Console]::Error.WriteLine("復元に失敗しました(psql の終了コード $code)。全部取り消されているので、データは復元前のままです。")
    exit 1
  }
  "復元しました。"
} finally {
  Pop-Location
}
