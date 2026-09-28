#Requires -Version 7.0
# 本格版(kind)で、わざと壊すスイッチ(カオス)を切り替えるスクリプトです。軽量版の tools/chaos.ps1 と同じ使い方です。
# PowerShell 7 版(Mac / Linux / WSL は k8s/chaos.sh)。
#
# /admin/chaos は ingress で「外からは 403」にしているので、Pod の「中」に入って、そのプロセスに直接頼みます。
# 最初に対象(api・backoffice・worker)を書けます。省くと api です。
#
# 軽量版との違い:
#   - Pod が 2 つ以上あることがあり、スイッチは Pod ごとに持っています。このスクリプトは「対象の全部の Pod」に同じ指示を送ります。
#   - Pod が作り直されると、スイッチは起動時の値(Deployment の環境変数 CHAOS_*)に戻ります。
#     作り直されても残したいとき(CrashLoopBackOff の演習など)は boot を使います。
#
# 使い方:
#   k8s/chaos.ps1 status                          全 api Pod の今の状態
#   k8s/chaos.ps1 set latencyMs=1500              全 api Pod に 1.5 秒の遅延を足す
#   k8s/chaos.ps1 set errorRate=0.5               半分を 500 にする
#   k8s/chaos.ps1 set leakMb=5                    リクエストのたびに 5MB ためる(上限 256Mi で OOMKilled → 再起動)
#   k8s/chaos.ps1 set idorBug=true                他人の注文が見えるバグ
#   k8s/chaos.ps1 set sqliBug=true                検索に SQL インジェクションの穴
#   k8s/chaos.ps1 reset                           全部元に戻す
#   k8s/chaos.ps1 worker set cronFail=true        worker の定期ジョブを全部失敗させる
#   k8s/chaos.ps1 worker reset
#
#   k8s/chaos.ps1 boot leakMb=20                  「起動時の値」を変える(Deployment の環境変数。ローリング更新で Pod が作り直されます)
#   k8s/chaos.ps1 worker boot cronFail=true cronIntervalSeconds=10   worker のジョブを失敗させ、間隔を 10 秒に(アラートの演習)
#   k8s/chaos.ps1 boot-reset                      起動時の値を元に戻す(これもローリング更新)。worker なら k8s/chaos.ps1 worker boot-reset
#
#   名前を変えて作ったクラスタなら -Cluster lab2 を足します(環境変数 LAB_CLUSTER でも可)。
#
# 中でやっていること(手で打つ場合。Pod の中の curl なので .exe は付けません):
#   kubectl -n lab exec deploy/api -- curl -s -X POST -H 'Content-Type: application/json' -d '{"errorRate":0.5}' http://localhost:3001/admin/chaos
#   (deploy/api と書くと、api の Pod の「どれか 1 つ」にだけ届きます)
# -Cluster は名前付きだけ(PositionalBinding = $false)。並べて書いた語(api・set・latencyMs=1500 …)は全部 $Rest に入ります。
[CmdletBinding(PositionalBinding = $false)]
param(
  [string]$Cluster,
  [Parameter(Position = 0, ValueFromRemainingArguments)]
  [string[]]$Rest
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
# JSON のように「二重引用符を含む引数」を kubectl にそのまま渡すための指定です(PowerShell 7.3 以降の標準の渡し方)。
$PSNativeCommandArgumentPassing = 'Standard'

$clusterName = if ($Cluster) { $Cluster } elseif ($env:LAB_CLUSTER) { $env:LAB_CLUSTER } else { 'lab' }
$K = @('--context', "kind-$clusterName", '-n', 'lab')

# 使い方(このファイルの先頭の説明)を表示します。
function Show-Usage {
  $lines = Get-Content -LiteralPath $PSCommandPath
  $i = 1
  while ($lines[$i] -like '#*') { $lines[$i]; $i++ }
}

# 動いている対象の Pod の名前の一覧
function Get-TargetPods {
  $names = (& kubectl @K get pods -l "app.kubernetes.io/name=${target}" --field-selector=status.phase=Running -o jsonpath='{.items[*].metadata.name}') -join ' '
  if ($LASTEXITCODE -ne 0) { throw "kubectl get pods が失敗しました(終了コード $LASTEXITCODE)。クラスタは動いていますか(kind get clusters)。" }
  @($names -split '\s+' | Where-Object { $_ })
}

# 対象の全部の Pod の中の curl に、同じ指示を送ります。
function Invoke-ChaosAll {
  param([string[]]$CurlArgs)
  $pods = @(Get-TargetPods) # Pod が 1 つでも配列として扱う
  if ($pods.Count -eq 0) {
    [Console]::Error.WriteLine("動いている ${target} の Pod がありません(kubectl -n lab get pods で様子を見てください)")
    exit 1
  }
  foreach ($p in $pods) {
    $reply = (& kubectl @K exec $p -c $target -- curl -sS @CurlArgs) -join "`n"
    if ($LASTEXITCODE -ne 0) { $reply = '(届きませんでした。再起動中かもしれません)' }
    "${p}: $reply"
  }
}

# 名前=値 の並びを JSON にします。数と true/false はそのまま、それ以外は文字列として送ります。
function ConvertTo-ChaosJson([string[]]$Pairs) {
  $fields = foreach ($pair in $Pairs) {
    $at = $pair.IndexOf('=')
    if ($at -lt 0) {
      [Console]::Error.WriteLine("名前=値 の形で書いてください: $pair")
      exit 1
    }
    $key = $pair.Substring(0, $at)
    $value = $pair.Substring($at + 1)
    if ($value -match '^[0-9]+(\.[0-9]+)?$' -or $value -ceq 'true' -or $value -ceq 'false') {
      "`"$key`":$value"
    } else {
      "`"$key`":`"$value`""
    }
  }
  '{' + ($fields -join ',') + '}'
}

# スイッチの名前 → 起動時の環境変数の名前
function Get-EnvName([string]$SwitchName) {
  switch -CaseSensitive ($SwitchName) {
    'latencyMs' { 'CHAOS_LATENCY_MS' }
    'errorRate' { 'CHAOS_ERROR_RATE' }
    'leakMb' { 'CHAOS_LEAK_MB' }
    'idorBug' { 'CHAOS_IDOR_BUG' }
    'sqliBug' { 'CHAOS_SQLI_BUG' }
    'cronFail' { 'CHAOS_CRON_FAIL' }
    'cronIntervalSeconds' { 'CRON_INTERVAL_SECONDS' }
    default {
      [Console]::Error.WriteLine("知らないスイッチです: $SwitchName")
      exit 1
    }
  }
}

# リポジトリの一番上に移動します(manifest.json を読むため。終わったら元の場所に戻します)。
Push-Location (Join-Path $PSScriptRoot '..')
try {
  $argv = @($Rest)
  $target = 'api'
  if ($argv.Count -gt 0 -and $argv[0] -cin @('api', 'backoffice', 'worker')) {
    $target = $argv[0]
    $argv = @($argv | Select-Object -Skip 1)
  }

  $url = 'http://localhost:3001/admin/chaos'
  $command = if ($argv.Count -gt 0) { $argv[0] } else { 'status' }
  $pairs = @($argv | Select-Object -Skip 1)

  switch -CaseSensitive ($command) {
    'status' {
      Invoke-ChaosAll @($url)
    }
    'reset' {
      Invoke-ChaosAll @('-X', 'POST', '-H', 'Content-Type: application/json', '-d', '{"reset":true}', $url)
    }
    'set' {
      if ($pairs.Count -eq 0) {
        [Console]::Error.WriteLine('例: k8s/chaos.ps1 set errorRate=0.5 / k8s/chaos.ps1 worker set cronFail=true')
        exit 1
      }
      $json = ConvertTo-ChaosJson $pairs # 書き方が違うときは、ここで止まる(何も送らない)
      Invoke-ChaosAll @('-X', 'POST', '-H', 'Content-Type: application/json', '-d', $json, $url)
    }
    'boot' {
      if ($pairs.Count -eq 0) {
        [Console]::Error.WriteLine('例: k8s/chaos.ps1 boot leakMb=20')
        exit 1
      }
      # @( ) で囲むのは、1 つだけのときも配列にするためです(文字列のままだと 1 文字ずつばらけて渡ってしまいます)
      $envArgs = @(foreach ($pair in $pairs) {
        $at = $pair.IndexOf('=')
        $name = if ($at -lt 0) { $pair } else { $pair.Substring(0, $at) }
        $value = if ($at -lt 0) { '' } else { $pair.Substring($at + 1) }
        "$(Get-EnvName $name)=$value"
      })
      & kubectl @K set env "deploy/${target}" @envArgs
      if ($LASTEXITCODE -ne 0) { throw "kubectl set env が失敗しました(終了コード $LASTEXITCODE)" }
      "起動時の値を変えました。新しい Pod に入れ替わります(kubectl -n lab get pods -w で見られます)。"
    }
    'boot-reset' {
      # CHAOS_* は manifest.json に無い(= 生成した Deployment に無い)ので、消せば既定値(壊さない)に戻ります。
      # CRON_INTERVAL_SECONDS は manifest.json にある値へ戻します。
      $envArgs = @('CHAOS_LATENCY_MS-', 'CHAOS_ERROR_RATE-', 'CHAOS_LEAK_MB-', 'CHAOS_IDOR_BUG-', 'CHAOS_SQLI_BUG-', 'CHAOS_CRON_FAIL-')
      if ($target -ceq 'worker') {
        $manifest = Get-Content -LiteralPath 'manifest.json' -Raw | ConvertFrom-Json
        $interval = ($manifest.aspects | Where-Object { $_.service -eq 'worker' }).env.CRON_INTERVAL_SECONDS
        $envArgs += "CRON_INTERVAL_SECONDS=$interval"
      }
      & kubectl @K set env "deploy/${target}" @envArgs
      if ($LASTEXITCODE -ne 0) { throw "kubectl set env が失敗しました(終了コード $LASTEXITCODE)" }
      "起動時の値を元に戻しました。新しい Pod に入れ替わります。"
    }
    default {
      Show-Usage
      exit 1
    }
  }
} finally {
  Pop-Location
}
