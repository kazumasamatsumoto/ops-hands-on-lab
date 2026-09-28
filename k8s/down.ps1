#Requires -Version 7.0
# 本格版(kind)を止めます。PowerShell 7 版(Mac / Linux / WSL は k8s/down.sh)。
# クラスタごと消すので、DB・指標・ログ・トレースのデータも消えます。
# クラスタの外の cdn-waf のコンテナも消します。
# (もう一度 k8s/up.ps1 を実行すれば、見本データ入りのまっさらな状態で作り直されます)
#
#   k8s/down.ps1
#   k8s/down.ps1 -Cluster lab2    名前を変えて作ったクラスタを消すとき(環境変数 LAB_CLUSTER でも可)
[CmdletBinding()]
param(
  [string]$Cluster
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$clusterName = if ($Cluster) { $Cluster } elseif ($env:LAB_CLUSTER) { $env:LAB_CLUSTER } else { 'lab' }

# cdn-waf のコンテナ(無ければ何も言わずに進みます)
& docker rm -f "${clusterName}-cdn-waf" 2>$null | Out-Null
if ($LASTEXITCODE -eq 0) { "コンテナ ${clusterName}-cdn-waf を消しました" }

# クラスタ(kubeconfig の接続情報も kind が消してくれます)
& kind delete cluster --name $clusterName
if ($LASTEXITCODE -ne 0) { throw "kind delete cluster が失敗しました(終了コード $LASTEXITCODE)" }

# ネットワーク lab-kind・lab-kind-outside は、ほかに使っているコンテナ(別の名前のクラスタなど)がいなければ消します。
foreach ($net in 'lab-kind-outside', 'lab-kind') {
  & docker network inspect $net 2>$null | Out-Null
  if ($LASTEXITCODE -ne 0) { continue }
  $inUse = (& docker network inspect $net -f '{{len .Containers}}') -join ''
  if ($inUse -eq '0') {
    & docker network rm $net | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "docker network rm $net が失敗しました(終了コード $LASTEXITCODE)" }
    "ネットワーク $net を消しました"
  } else {
    "ネットワーク $net はほかのコンテナが使っているので残します"
  }
}
