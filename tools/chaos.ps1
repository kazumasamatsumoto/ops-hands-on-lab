#Requires -Version 7.0
# わざと壊すスイッチ(カオス)を切り替えるスクリプトです(PowerShell 7 版。Mac / Linux / WSL は tools/chaos.sh)。
#
# /admin/chaos は ingress で「外からは 403」にしているため、http://api.lab.localhost:18080/admin/chaos からは変えられません
# (それが正しい動きです)。そこで、対象のコンテナの「中」に入って、そのプロセスに直接頼みます。
#
# 使い方(リポジトリのどこから実行しても動きます)。最初に対象(api・backoffice・worker)を書けます。省くと api です。
#   tools/chaos.ps1 status                          api の今の状態を見る
#   tools/chaos.ps1 set latencyMs=1500              OCC の API とトークンに 1.5 秒の遅延を足す
#   tools/chaos.ps1 set errorRate=0.5               半分のリクエストを 500 にする
#   tools/chaos.ps1 set leakMb=5                    リクエストのたびに 5MB ずつメモリをため込む(最後は落ちる)
#   tools/chaos.ps1 set idorBug=true                他人の注文が見えてしまうバグを入れる
#   tools/chaos.ps1 set sqliBug=true                検索(query)に SQL インジェクションの穴を開ける
#   tools/chaos.ps1 set latencyMs=800 errorRate=0.1 まとめて変える
#   tools/chaos.ps1 reset                           api のスイッチを全部元に戻す
#   tools/chaos.ps1 worker set cronFail=true        worker(定期ジョブ)をすべて失敗させる
#   tools/chaos.ps1 worker status                   worker の状態を見る
#   tools/chaos.ps1 worker reset                    worker を元に戻す
#
# どのスイッチがどの対象に効くかは apps/api/README.md の「カオススイッチ」の表にあります(cronFail は worker だけ)。
# 対象を再起動すると、スイッチは起動時の値(docker-compose.yml の CHAOS_*)に戻ります。
#
# 中でやっていること(手で打つ場合。コンテナの中の curl なので .exe は付けません):
#   docker compose exec api curl -s -X POST -H 'Content-Type: application/json' -d '{"errorRate":0.5}' http://localhost:3001/admin/chaos
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
# JSON のように「二重引用符を含む引数」を docker にそのまま渡すための指定です(PowerShell 7.3 以降の標準の渡し方)。
$PSNativeCommandArgumentPassing = 'Standard'

# 使い方(このファイルの先頭の説明)を表示します。
function Show-Usage {
  $lines = Get-Content -LiteralPath $PSCommandPath
  $i = 1
  while ($lines[$i] -like '#*') { $lines[$i]; $i++ }
}

# 対象のコンテナの中の curl を呼び、返ってきた JSON を 1 行で表示します。docker が失敗したら(ラボが起動していないなど)そこで止めます。
function Invoke-Chaos {
  param([string[]]$CurlArgs)
  $reply = (& docker compose exec -T $target curl -sS @CurlArgs) -join "`n"
  if ($LASTEXITCODE -ne 0) {
    throw "docker compose exec $target curl が失敗しました(終了コード $LASTEXITCODE)。ラボは起動していますか(docker compose ps)。"
  }
  $reply
}

# リポジトリの一番上に移動します(docker compose がここの docker-compose.yml を見つけられるように)。
# 終わったら元の場所に戻します(PowerShell では、スクリプトの中の移動が呼び出した側にも残るため)。
Push-Location (Join-Path $PSScriptRoot '..')
try {
  $argv = @($args)
  $target = 'api'
  if ($argv.Count -gt 0 -and $argv[0] -cin @('api', 'backoffice', 'worker')) {
    $target = $argv[0]
    $argv = @($argv | Select-Object -Skip 1)
  }

  $url = 'http://localhost:3001/admin/chaos'
  $command = if ($argv.Count -gt 0) { $argv[0] } else { 'status' }

  switch -CaseSensitive ($command) {
    'status' {
      Invoke-Chaos @($url)
    }
    'reset' {
      Invoke-Chaos @('-X', 'POST', '-H', 'Content-Type: application/json', '-d', '{"reset":true}', $url)
    }
    'set' {
      $pairs = @($argv | Select-Object -Skip 1)
      if ($pairs.Count -eq 0) {
        [Console]::Error.WriteLine('例: tools/chaos.ps1 set errorRate=0.5 / tools/chaos.ps1 worker set cronFail=true')
        exit 1
      }
      $fields = foreach ($pair in $pairs) {
        $at = $pair.IndexOf('=')
        if ($at -lt 0) {
          [Console]::Error.WriteLine("名前=値 の形で書いてください: $pair")
          exit 1
        }
        $key = $pair.Substring(0, $at)
        $value = $pair.Substring($at + 1)
        # 数と true/false はそのまま、それ以外は文字列として送ります(相手の側で検査して、おかしければ 400 が返ります)。
        if ($value -match '^[0-9]+(\.[0-9]+)?$' -or $value -ceq 'true' -or $value -ceq 'false') {
          "`"$key`":$value"
        } else {
          "`"$key`":`"$value`""
        }
      }
      $json = '{' + ($fields -join ',') + '}'
      Invoke-Chaos @('-X', 'POST', '-H', 'Content-Type: application/json', '-d', $json, $url)
    }
    default {
      Show-Usage
      exit 1
    }
  }
} finally {
  Pop-Location
}
