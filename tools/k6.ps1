#Requires -Version 7.0
# k6(負荷をかける道具)を Docker で動かします。PC に k6 を入れる必要はありません。PowerShell 7 版(Mac / Linux / WSL は tools/k6.sh)。
#
#   使い方: tools/k6.ps1 smoke.js       主な URL を 1 回ずつ確かめる(煙が出ないかの確認 = スモークテスト)
#           tools/k6.ps1 browse.js      普通の利用者(トップ → 検索 → 商品詳細)を数人ぶん
#           tools/k6.ps1 ramp.js        段階的に負荷を上げる試験
#
# 既定では、利用者と同じ URL(http://www.lab.localhost:18080 と http://api.lab.localhost:18080)で、cdn-waf を通します。
# k6 はコンテナの中で動くので、--add-host で 3 つのホスト名を cdn-waf の IP(172.30.89.10)に向けています。
# cdn-waf には「IP ごとに 1 秒 20 回まで」のレート制限があるため、強い負荷をかけると 429 が返ります(それ自体が演習の見どころです)。
# アプリそのものの性能を測りたいときは、cdn-waf と ingress を通さず直接かけます(環境変数はコマンドの前の行で設定します):
#   $env:API_URL = 'http://api:3001'; tools/k6.ps1 ramp.js
#   $env:WWW_URL = 'http://storefront:4000'; tools/k6.ps1 ramp.js -e TARGET=page
#   (元に戻す: Remove-Item Env:API_URL)
#
# bash 版はスクリプトを標準入力(< ファイル)で渡しますが、PowerShell にはそれが無いので、
# tools/k6 のフォルダをコンテナに /scripts として見せて(-v)、その中のファイルを実行します。
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

# リポジトリの一番上に移動します(終わったら元の場所に戻します)。
Push-Location (Join-Path $PSScriptRoot '..')
try {
  if ($args.Count -eq 0) {
    [Console]::Error.WriteLine('スクリプト名を指定してください(例: browse.js)')
    exit 1
  }
  $script = [string]$args[0]
  $rest = @($args | Select-Object -Skip 1)
  if (-not (Test-Path -LiteralPath (Join-Path 'tools' 'k6' $script) -PathType Leaf)) {
    [Console]::Error.WriteLine("tools/k6/$script が見つかりません(あるのは: $((Get-ChildItem 'tools/k6' -Filter '*.js' | ForEach-Object Name) -join '・'))")
    exit 1
  }

  # 本格版(kind)に向けるときは、ネットワークと cdn-waf の IP を変えます:
  #   $env:LAB_DOCKER_NETWORK = 'lab-kind'; $env:CDN_WAF_IP = '172.30.91.10'; tools/k6.ps1 browse.js
  $cdnWafIp = if ($env:CDN_WAF_IP) { $env:CDN_WAF_IP } else { '172.30.89.10' }
  $network = if ($env:LAB_DOCKER_NETWORK) { $env:LAB_DOCKER_NETWORK } else { 'lab_default' }
  $wwwUrl = if ($env:WWW_URL) { $env:WWW_URL } else { 'http://www.lab.localhost:18080' }
  $apiUrl = if ($env:API_URL) { $env:API_URL } else { 'http://api.lab.localhost:18080' }
  # 共有するフォルダは絶対パスで(Windows なら C:\...\tools\k6 の形。空白が入っていても 1 つの引数として渡します)
  $scriptsDir = Join-Path (Get-Location).Path 'tools' 'k6'

  $dockerArgs = @(
    'run', '--rm',
    '--network', $network,
    '--add-host', "www.lab.localhost:$cdnWafIp",
    '--add-host', "api.lab.localhost:$cdnWafIp",
    '--add-host', "backoffice.lab.localhost:$cdnWafIp",
    '-e', "WWW_URL=$wwwUrl",
    '-e', "API_URL=$apiUrl",
    '-v', "${scriptsDir}:/scripts:ro",
    'grafana/k6:1.8.1', 'run'
  ) + $rest + @("/scripts/$script")
  & docker @dockerArgs
  # k6 の終了コードをそのまま返します(しきい値(thresholds)を満たさなかったときは 0 以外になります)
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
} finally {
  Pop-Location
}
