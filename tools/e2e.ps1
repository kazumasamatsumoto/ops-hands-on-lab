#Requires -Version 7.0
# E2E テスト(Playwright)を Docker で動かします。PC に Node.js やブラウザを入れる必要はありません。PowerShell 7 版(Mac / Linux / WSL は tools/e2e.sh)。
#
#   使い方: tools/e2e.ps1                        全部のテスト(買い物の導線・他人の注文・画面比較)
#           tools/e2e.ps1 tests/journey.spec.ts  1 つのファイルだけ
#           tools/e2e.ps1 --update-snapshots     画面比較の基準画像を撮り直す(見た目を意図して変えたときだけ。レビューで承認してから)
#
# 先に docker compose up -d でラボを起動してください。
# テストのコンテナは cdn-waf と「同じネットワークの部屋」(--network container:lab-cdn-waf-1)に入ります。
# ブラウザは *.localhost の名前を必ず自分自身(127.0.0.1)として引くので、コンテナの中の 127.0.0.1:18080 = cdn-waf に届きます。
# こうすると、テストもホスト PC のブラウザと同じ URL(http://www.lab.localhost:18080)で動きます。
# 結果の詳しい報告は tools/e2e/playwright-report/index.html に出ます(失敗したときの画面や差分の画像もここで見られます)。
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

# tools/e2e に移動します(終わったら元の場所に戻します)。
Push-Location (Join-Path $PSScriptRoot 'e2e')
try {
  # テストの道具(@playwright/test)と Docker イメージの版は、必ず同じ番号にそろえます(package.json と合わせる)。
  $image = 'mcr.microsoft.com/playwright:v1.63.0-noble'
  $cdnWaf = (& docker compose -p lab ps -q cdn-waf) -join ''
  if (-not $cdnWaf) {
    [Console]::Error.WriteLine('cdn-waf が動いていません。先に docker compose up -d を実行してください。')
    exit 1
  }
  $baseUrl = if ($env:BASE_URL) { $env:BASE_URL } else { 'http://www.lab.localhost:18080' }

  $dockerArgs = @('run', '--rm', '--init', '--ipc=host', '--network', "container:$cdnWaf")
  # Mac / Linux では、テストが作るファイル(node_modules・報告)の持ち主が root にならないよう、自分のユーザーで動かします。
  # Windows の共有フォルダには持ち主の概念が無いので、この指定は要りません。
  if (-not $IsWindows) {
    $dockerArgs += @('--user', "$(& id -u):$(& id -g)")
  }
  $dockerArgs += @(
    '-e', 'HOME=/tmp', '-e', 'NPM_CONFIG_UPDATE_NOTIFIER=false',
    '-e', "BASE_URL=$baseUrl",
    '-v', "$((Get-Location).Path):/work", '-w', '/work',
    $image,
    'sh', '-c', 'npm ci --no-audit --no-fund --loglevel=error && npx playwright test "$@"', '--'
  ) + @($args)
  & docker @dockerArgs
  # テストの結果(失敗なら 0 以外)をそのまま返します
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
} finally {
  Pop-Location
}
