#Requires -Version 7.0
# 攻撃の「見本」を送って、WAF(cdn-waf の ModSecurity)が止めるかを確かめるスクリプトです。PowerShell 7 版(Mac / Linux / WSL は tools/attack-samples.sh)。
#
# !!! 注意 !!!
#   このスクリプトは、自分の PC で動かしているこのラボ(http://www.lab.localhost:18080 と http://api.lab.localhost:18080)にだけ使ってください。
#   実在するサイトや他人のサーバーに送ってはいけません。許可なく送ると、法律(不正アクセス禁止法など)に触れるおそれがあります。
#   そのため、送り先はラボのホスト名に固定していて、変えられないようにしています(引数や環境変数では変わりません)。
#   さらに curl の --resolve で、名前を必ず自分の PC(127.0.0.1)に向けています(名前の引き方がおかしくても外に出ません)。
#
# 使い方: tools/attack-samples.ps1
# 期待する結果: 攻撃の見本は 403(WAF が遮断)、普通の検索は 200。
#
# PowerShell では curl が Invoke-WebRequest の別名なので、本物の curl(curl.exe)を呼びます。
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$API = 'http://api.lab.localhost:18080'
$WWW = 'http://www.lab.localhost:18080'
$SEARCH = '/occ/v2/samplestore/products/search?query='
$PIN = @('--resolve', 'api.lab.localhost:18080:127.0.0.1', '--resolve', 'www.lab.localhost:18080:127.0.0.1')

# 本物の curl。Windows は curl.exe(Windows 10 以降に入っています)。Mac / Linux の pwsh では curl です。
$curl = if (Get-Command 'curl.exe' -ErrorAction SilentlyContinue) { 'curl.exe' } else { 'curl' }
# 応答の本文の捨て先(Windows は NUL、それ以外は /dev/null)
$devNull = if ($IsWindows) { 'NUL' } else { '/dev/null' }

function Send-Sample {
  param([string]$Label, [string]$Url)
  # -s: 進み具合を出さない / -o: 本文は捨てる / -w: 状態コードだけ表示 / --max-time: 10 秒で諦める
  $code = (& $curl -s -o $devNull -w '%{http_code}' --max-time 10 @PIN $Url) -join ''
  if (-not $code) { $code = '000' }
  "{0}  {1}`n     {2}" -f $code, $Label, $Url
}

"送り先: ${API} と ${WWW}(ラボ専用)"
"結果 内容 / 送った URL"
"--- api(OCC の商品検索 query)"
Send-Sample "普通の検索(通るべき)"            "${API}${SEARCH}%E3%83%8E%E3%83%BC%E3%83%88"
Send-Sample "SQL インジェクション: 常に真"        "${API}${SEARCH}%27%20OR%20%271%27%3D%271"
Send-Sample "SQL インジェクション: UNION"        "${API}${SEARCH}%27%20UNION%20SELECT%20username%2Cpassword_hash%20FROM%20users--"
Send-Sample "SQL インジェクション: コメント"      "${API}${SEARCH}abc%27%3B--"
Send-Sample "XSS: script タグ"                   "${API}${SEARCH}%3Cscript%3Ealert(1)%3C%2Fscript%3E"
Send-Sample "パスの巡回(../)"                   "${API}${SEARCH}a&file=..%2F..%2F..%2Fetc%2Fpasswd"
"--- storefront(画面の検索 q)"
Send-Sample "普通の検索(通るべき)"            "${WWW}/search?q=%E3%83%8E%E3%83%BC%E3%83%88"
Send-Sample "SQL インジェクション: 常に真"        "${WWW}/search?q=%27%20OR%20%271%27%3D%271"
Send-Sample "XSS: img onerror"                   "${WWW}/search?q=%3Cimg%20src%3Dx%20onerror%3Dalert(1)%3E"
""
'403 = WAF が遮断した / 200 = 通った。遮断の理由は docker compose logs cdn-waf の "ruleId" で分かります。'
