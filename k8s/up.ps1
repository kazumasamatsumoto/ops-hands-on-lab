#Requires -Version 7.0
# 本格版(kind = Docker の中の Kubernetes)を起動するスクリプトです。PowerShell 7 版(Mac / Linux / WSL は k8s/up.sh)。
# 何度実行しても大丈夫です(あるものはそのまま、変わったものだけ反映)。
#
#   k8s/up.ps1                      環境 p1(本番のまね)で起動
#   k8s/up.ps1 -Env d1              環境 d1(開発のまね)に切り替える。s1 も同じ。もう一度 p1 にすれば戻ります
#   k8s/up.ps1 -Env d1 -SkipBuild   イメージのビルドを飛ばして切り替えだけ(速い)
#
# できあがる形(k8s/README.md の図も見てください):
#
#   ブラウザ ─127.0.0.1:18080─▶ [cdn-waf コンテナ] ─▶ [kind のノードの 80 番 = ingress-nginx] ─▶ storefront / api / backoffice
#                              クラスタの外(Docker)       クラスタの中(Kubernetes)
#
# やること:
#   1. Docker のネットワーク lab-kind(172.30.91.0/24)と、社外の代わりの lab-kind-outside(172.30.92.0/24)を作る
#   2. kind のクラスタが無ければ作る(ノードは lab-kind につなぐ)
#   3. storefront と api のイメージを手元でビルドし、kind のノードに読み込む(軽量版と同じ Dockerfile)
#   4. ingress-nginx を入れる(k8s/vendor/ingress-nginx。バージョン固定の写し)
#   5. manifest.json から k8s/generated/ を作り直す(tools/manifest/render.mjs)
#   6. 土台(Namespace・Secret・DB・Solr)と観測の道具を反映し、設定ファイルを ConfigMap に入れる
#   7. アプリと Ingress を、環境の差分(k8s/generated/envs/<環境>)で反映する
#   8. 全部の Pod が Ready になるまで待つ
#   9. クラスタの外に cdn-waf のコンテナを起動する(キャッシュの ON/OFF は環境の ConfigMap lab-environment から)
#
# 変えられる値(ふだんは不要)。パラメータで書きます。bash 版と同じ環境変数($env:LAB_ENV など)が設定されていればそれも使います。
#   -Env p1                           環境(d1・s1・p1)。環境変数なら LAB_ENV
#   -Cluster lab                      クラスタの名前(cdn-waf のコンテナ名は <クラスタ名>-cdn-waf)。LAB_CLUSTER
#   -KindConfig k8s/kind-config.yaml  クラスタ定義のファイル(観測の道具のホスト側のポートはここで決まる)。LAB_KIND_CONFIG
#   -HttpPort 18080                   お店の入口(cdn-waf)のホスト側のポート。LAB_HTTP_PORT
#   -EdgeCache on|off                 cdn-waf のキャッシュ(省くと環境の設定に従う)。EDGE_CACHE
#   -SkipBuild                        イメージのビルドを飛ばす(環境を切り替えるだけのときに速い)。LAB_SKIP_BUILD=1
#   $env:LAB_CDN_WAF_IP = '172.30.91.10'  cdn-waf の lab-kind の中での IP(クラスタを 2 つ同時に動かすときだけ変える)
#
# kubeconfig について: kind はクラスタの接続情報を既定の場所($env:KUBECONFIG があればそこ、無ければ
# Windows は $env:USERPROFILE\.kube\config、Mac / Linux は ~/.kube/config)に書き、kubectl も同じ場所を読みます。
# このスクリプトは bash 版と同じく、その既定の場所をそのまま使います(--context kind-<クラスタ名> で選びます)。
[CmdletBinding()]
param(
  [string]$Env,
  [switch]$SkipBuild,
  [int]$HttpPort,
  [string]$Cluster,
  [string]$KindConfig,
  [string]$EdgeCache
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
# 二重引用符や空白を含む引数(cdn-waf の --health-cmd など)を docker にそのまま渡すための指定です。
$PSNativeCommandArgumentPassing = 'Standard'

# ---------- 値の決定(パラメータ → 環境変数 → 既定値 の順) ----------
# (PowerShell の変数名は大文字小文字を区別しないので、パラメータとは別の名前にしています)
$labEnv = if ($Env) { $Env } elseif ($env:LAB_ENV) { $env:LAB_ENV } else { 'p1' }
$skipBuildImages = $SkipBuild.IsPresent -or ($env:LAB_SKIP_BUILD -eq '1')
$hostPort = if ($HttpPort) { $HttpPort } elseif ($env:LAB_HTTP_PORT) { [int]$env:LAB_HTTP_PORT } else { 18080 }
$clusterName = if ($Cluster) { $Cluster } elseif ($env:LAB_CLUSTER) { $env:LAB_CLUSTER } else { 'lab' }
$kindConfigPath = if ($KindConfig) { $KindConfig } elseif ($env:LAB_KIND_CONFIG) { $env:LAB_KIND_CONFIG } else { 'k8s/kind-config.yaml' }
$edgeCacheOverride = if ($EdgeCache) { $EdgeCache } elseif ($env:EDGE_CACHE) { $env:EDGE_CACHE } else { '' }
$cdnWafIp = if ($env:LAB_CDN_WAF_IP) { $env:LAB_CDN_WAF_IP } else { '172.30.91.10' }
$cdnWafName = "${clusterName}-cdn-waf"
$nodeName = "${clusterName}-control-plane"
$NS = 'lab'

# Docker のネットワーク。番号を固定するのは、manifest.json の ipFilters.office(社内の範囲)と
# ingress-nginx の proxy-real-ip-cidr(X-Forwarded-For を信じる相手)に、同じ番号を書いておくためです。
$NET = 'lab-kind'
$NET_SUBNET = '172.30.91.0/24'
$OUTSIDE_NET = 'lab-kind-outside'
$OUTSIDE_SUBNET = '172.30.92.0/24'

if ($labEnv -cnotin @('d1', 's1', 'p1')) {
  [Console]::Error.WriteLine("LAB_ENV は d1・s1・p1 のどれかにしてください(今: $labEnv)")
  exit 1
}
if ($edgeCacheOverride -and $edgeCacheOverride -cnotin @('on', 'off')) {
  [Console]::Error.WriteLine("EDGE_CACHE は on か off にしてください(今: $edgeCacheOverride)")
  exit 1
}

foreach ($cmd in 'docker', 'kind', 'kubectl', 'node') {
  if (-not (Get-Command $cmd -ErrorAction SilentlyContinue)) {
    [Console]::Error.WriteLine("$cmd が見つかりません。k8s/README.md の「用意するもの」を見て入れてください。")
    exit 1
  }
}

# ---------- 小さな道具 ----------
function Step([string]$Message) { "`n==> $Message" }

# kubectl を「このクラスタ」に向けて呼びます。失敗したらそこで止めます(bash 版の set -e と同じ)。
function K {
  & kubectl --context "kind-$clusterName" @args
  if ($LASTEXITCODE -ne 0) { throw "kubectl $($args -join ' ') が失敗しました(終了コード $LASTEXITCODE)" }
}

# 失敗したら止める docker / kind / node の呼び出し
function Invoke-Native([string]$Command, [string[]]$Arguments) {
  & $Command @Arguments
  if ($LASTEXITCODE -ne 0) { throw "$Command $($Arguments -join ' ') が失敗しました(終了コード $LASTEXITCODE)" }
}

# ---------- 1. Docker のネットワーク ----------
function Ensure-Network([string]$Name, [string]$Subnet, [string]$Gateway) {
  & docker network inspect $Name 2>$null | Out-Null
  if ($LASTEXITCODE -eq 0) {
    $actual = ((& docker network inspect $Name -f '{{range .IPAM.Config}}{{.Subnet}} {{end}}') -join ' ').Trim()
    if ((" $actual " -replace '\s+', ' ') -notlike "* $Subnet *") {
      [Console]::Error.WriteLine("ネットワーク $Name の番号が $Subnet ではありません($actual)。docker network rm $Name してからやり直してください。")
      exit 1
    }
  } else {
    Invoke-Native docker @('network', 'create', '--driver', 'bridge', '--subnet', $Subnet, '--gateway', $Gateway, $Name) | Out-Null
    "  ネットワーク $Name($Subnet)を作りました"
  }
}

# 出力の文字コードを UTF-8 にそろえます(ConfigMap に入れる設定ファイルには日本語のコメントがあり、
# kubectl の出力を PowerShell が受け渡すときに化けないようにするため)。終わったら元に戻します。
$prevConsoleEncoding = [Console]::OutputEncoding
$utf8 = [Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = $utf8
$OutputEncoding = $utf8
# リポジトリの一番上に移動します(終わったら元の場所に戻します)。
Push-Location (Join-Path $PSScriptRoot '..')
try {
  $root = (Get-Location).Path

  Step "Docker のネットワークを用意します(lab-kind = クラスタと cdn-waf、lab-kind-outside = 社外の代わり)"
  Ensure-Network $NET $NET_SUBNET '172.30.91.1'
  Ensure-Network $OUTSIDE_NET $OUTSIDE_SUBNET '172.30.92.1'

  # ---------- 2. クラスタ ----------
  $clusters = @(& kind get clusters 2>$null)
  if ($clusters -ccontains $clusterName) {
    Step "クラスタ ${clusterName} はもうあります。作らずに進みます"
  } else {
    Step "クラスタ ${clusterName} を作ります(初回はノードのイメージ取得で数分かかります)"
    # KIND_EXPERIMENTAL_DOCKER_NETWORK: ノードをつなぐ Docker のネットワークを指定する kind の設定です(既定は kind という名前)。
    # 環境変数はプロセス全体に効くので、この 1 回だけ設定して、終わったら元に戻します。
    $prevKindNet = $env:KIND_EXPERIMENTAL_DOCKER_NETWORK
    $env:KIND_EXPERIMENTAL_DOCKER_NETWORK = $NET
    try {
      Invoke-Native kind @('create', 'cluster', '--name', $clusterName, '--config', $kindConfigPath, '--wait', '120s')
    } finally {
      $env:KIND_EXPERIMENTAL_DOCKER_NETWORK = $prevKindNet
    }
  }

  # ---------- 3. イメージ ----------
  if ($skipBuildImages) {
    Step "イメージのビルドを飛ばします(-SkipBuild)"
  } else {
    Step "storefront と api のイメージをビルドします(軽量版と同じ Dockerfile)"
    Invoke-Native docker @('build', '-t', 'lab/api:local', 'apps/api')
    Invoke-Native docker @('build', '-t', 'lab/web:local', 'apps/web')
  }
  Step "イメージを kind のノードに読み込みます(ノードは手元の Docker のイメージを直接は見られないため)"
  Invoke-Native kind @('load', 'docker-image', 'lab/api:local', 'lab/web:local', '--name', $clusterName)

  # ---------- 4. ingress-nginx ----------
  Step "ingress-nginx(クラスタの入口の振り分け係)を入れます"
  K apply -k k8s/vendor/ingress-nginx | Out-Null
  K -n ingress-nginx rollout status deploy/ingress-nginx-controller --timeout=300s

  # ---------- 5. manifest.json → k8s/generated/ ----------
  Step "manifest.json から k8s/generated/ を作り直します"
  Invoke-Native node @('tools/manifest/render.mjs')

  # ---------- 6. 土台と観測 ----------
  Step "土台(Namespace・Secret・DB・Solr)を反映します"
  K apply -f k8s/platform/namespace.yaml | Out-Null

  # ConfigMap を「ファイルから作って、差分だけ反映」する小さな関数です。
  # (kubectl から kubectl へのパイプは、PowerShell 7.4 以降ではバイトのまま渡ります)
  function Set-ConfigMapFromFiles([string]$Name, [string[]]$FromFiles) {
    & kubectl --context "kind-$clusterName" -n $NS create configmap $Name @FromFiles --dry-run=client -o yaml |
      & kubectl --context "kind-$clusterName" apply --server-side --force-conflicts -f - | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "configmap/$Name の反映に失敗しました(終了コード $LASTEXITCODE)" }
    "  configmap/$Name"
  }
  Set-ConfigMapFromFiles solr-products-config @('--from-file=apps/api/solr/products/conf/')
  K apply -k k8s/platform

  Step "観測の道具の設定(ConfigMap)と本体を反映します"
  Set-ConfigMapFromFiles prometheus-config @('--from-file=prometheus.yml=k8s/config/prometheus.yml')
  Set-ConfigMapFromFiles prometheus-rules @('--from-file=observability/prometheus/rules/')
  Set-ConfigMapFromFiles alertmanager-config @('--from-file=alertmanager.yml=observability/alertmanager/alertmanager.yml')
  Set-ConfigMapFromFiles pager-app @('--from-file=server.mjs=observability/pager/server.mjs')
  Set-ConfigMapFromFiles grafana-datasources @('--from-file=datasources.yml=k8s/config/grafana-datasources.yml')
  Set-ConfigMapFromFiles grafana-dashboard-providers @('--from-file=observability/grafana/provisioning/dashboards/')
  Set-ConfigMapFromFiles grafana-dashboards @('--from-file=observability/grafana/dashboards/samplestore-slo.json', '--from-file=k8s/config/dashboards/samplestore-trace.json')
  Set-ConfigMapFromFiles loki-config @('--from-file=loki.yml=observability/loki/loki.yml')
  Set-ConfigMapFromFiles alloy-config @('--from-file=config.alloy=k8s/config/config.alloy')
  Set-ConfigMapFromFiles otel-collector-config @('--from-file=otel-collector.yaml=k8s/config/otel-collector.yaml')
  Set-ConfigMapFromFiles tempo-config @('--from-file=tempo.yaml=k8s/config/tempo.yaml')
  K apply -k k8s/observability

  # ---------- 7. アプリと Ingress(環境の差分つき) ----------
  Step "アプリと Ingress を環境 ${labEnv} で反映します(kubectl apply -k k8s/generated/envs/${labEnv})"
  # ingress-nginx は Ingress を受け付ける前に中身を確かめる「検問(admission webhook)」を持っています。
  # 入れた直後は検問の準備ができておらず断られることがあるので、何回かやり直します。
  foreach ($try in 1..10) {
    & kubectl --context "kind-$clusterName" apply -k "k8s/generated/envs/${labEnv}"
    if ($LASTEXITCODE -eq 0) { break }
    if ($try -eq 10) { exit 1 }
    "  (ingress-nginx の検問の準備を待って、やり直します)"
    Start-Sleep 6
  }

  # ---------- 8. 待つ ----------
  Step "全部の Pod が Ready になるまで待ちます(初回はイメージ取得で 5〜10 分かかることがあります)"
  K -n $NS rollout status statefulset/db --timeout=600s
  foreach ($d in 'search', 'api', 'backoffice', 'worker', 'storefront', 'prometheus', 'alertmanager', 'pager', 'grafana', 'loki', 'alloy', 'otel-collector', 'tempo') {
    K -n $NS rollout status "deploy/$d" --timeout=600s
  }

  # ---------- 9. cdn-waf(クラスタの外) ----------
  # 軽量版と同じイメージ・同じ設定ファイル(cdn-waf/default.conf.template)を、ただの Docker のコンテナとして動かします。
  # 行き先(INGRESS_UPSTREAM)だけが違い、kind のノード(<クラスタ名>-control-plane)の 80 番 = ingress-nginx に送ります。
  # キャッシュの ON/OFF は、環境の ConfigMap lab-environment の EDGE_CACHE(manifest.json の environments.*.cdnCache)に従います。
  Step "cdn-waf をクラスタの外に起動します(コンテナ ${cdnWafName})"
  $edgeCacheEnv = (K -n $NS get configmap lab-environment -o jsonpath='{.data.EDGE_CACHE}') -join ''
  $edgeCacheValue = if ($edgeCacheOverride) { $edgeCacheOverride } else { $edgeCacheEnv }
  # CSP は軽量版の docker-compose.yml の WWW_CSP をそのまま使います(2 か所に同じ長い文字列を書かないため)。
  $cspMatch = Select-String -LiteralPath (Join-Path $root 'docker-compose.yml') -Pattern '^ *WWW_CSP: "(.*)"$' | Select-Object -First 1
  if (-not $cspMatch) {
    [Console]::Error.WriteLine('docker-compose.yml から WWW_CSP を読めませんでした')
    exit 1
  }
  $wwwCsp = $cspMatch.Matches[0].Groups[1].Value

  & docker rm -f $cdnWafName 2>$null | Out-Null
  # 共有するファイルは絶対パスで(Windows なら C:\...\cdn-waf\... の形。空白が入っていても 1 つの引数として渡します)
  $tplFile = Join-Path $root 'cdn-waf' 'default.conf.template'
  $exclFile = Join-Path $root 'cdn-waf' 'modsecurity' 'lab-exclusions-before.conf'
  $envOr = { param($Name, $Default) if (Test-Path "Env:$Name") { (Get-Item "Env:$Name").Value } else { $Default } }
  $runArgs = @(
    'run', '-d', '--name', $cdnWafName,
    '--network', $NET, '--ip', $cdnWafIp,
    '-p', "127.0.0.1:${hostPort}:8081",
    '-e', "INGRESS_UPSTREAM=${nodeName}:80",
    '-e', "EDGE_CACHE=$edgeCacheValue",
    '-e', "EDGE_GLOBAL_RATE=$(& $envOr 'EDGE_GLOBAL_RATE' '20r/s')",
    '-e', "EDGE_GLOBAL_BURST=$(& $envOr 'EDGE_GLOBAL_BURST' '80')",
    '-e', "WWW_CSP=$wwwCsp",
    '-e', 'MODSEC_RULE_ENGINE=On',
    '-e', "BLOCKING_PARANOIA=$(& $envOr 'BLOCKING_PARANOIA' '1')",
    '-e', "ANOMALY_INBOUND=$(& $envOr 'ANOMALY_INBOUND' '5')",
    '-e', 'ANOMALY_OUTBOUND=4',
    '-e', 'MODSEC_AUDIT_LOG_FORMAT=JSON',
    '-e', 'MODSEC_AUDIT_LOG=/dev/stdout',
    '-e', 'RESOLVERS=127.0.0.11',
    '-e', "BACKEND=http://${nodeName}:80",
    '-v', "${tplFile}:/etc/nginx/templates/conf.d/default.conf.template:ro",
    '-v', "${exclFile}:/opt/owasp-crs/plugins/lab-exclusions-before.conf:ro",
    '--sysctl', 'net.ipv4.ip_local_port_range=1024 65535',
    '--sysctl', 'net.ipv4.tcp_tw_reuse=1',
    '--health-cmd', 'curl -fsS -H "Host: localhost" http://127.0.0.1:18080/cdn-healthz',
    '--health-interval', '5s', '--health-retries', '10',
    '--memory', '128m', '--restart', 'unless-stopped',
    '--label', "lab.cluster=$clusterName",
    'owasp/modsecurity-crs:4.25.1-nginx-alpine-202609241109-lts'
  )
  Invoke-Native docker $runArgs | Out-Null
  # 社外の代わりのネットワークにもつなぎます(IP フィルタの 403 を確かめる演習用。README の「IP フィルタを確かめる」)。
  Invoke-Native docker @('network', 'connect', $OUTSIDE_NET, $cdnWafName)

  # 見回り(healthcheck)が healthy になるまで、2 秒おきに最長 2 分待ちます。
  foreach ($i in 1..60) {
    $health = (& docker inspect -f '{{.State.Health.Status}}' $cdnWafName) -join ''
    if ($health -eq 'healthy') { break }
    Start-Sleep 2
  }
  # 本物の curl(Windows は curl.exe。PowerShell の curl は Invoke-WebRequest の別名)。
  # --resolve で名前を 127.0.0.1 に固定しているので、hosts の設定がまだでもこの確認はできます。
  $curl = if (Get-Command 'curl.exe' -ErrorAction SilentlyContinue) { 'curl.exe' } else { 'curl' }
  $devNull = if ($IsWindows) { 'NUL' } else { '/dev/null' }
  $code = (& $curl -s -o $devNull -w '%{http_code}' --max-time 20 --resolve "www.lab.localhost:${hostPort}:127.0.0.1" "http://www.lab.localhost:${hostPort}/") -join ''
  "  http://www.lab.localhost:${hostPort}/ → ${code}"

  K -n $NS get pods -o wide

  # ノードのポート(30300 など)がホストの何番に出ているか(kind-config.yaml の hostPort)を docker port で調べます。
  function Get-HostPort([int]$NodePort) {
    $line = @(& docker port $nodeName "$NodePort/tcp" 2>$null) | Select-Object -First 1
    if ($line) { $line.Substring($line.LastIndexOf(':') + 1) } else { '' }
  }
  $searchProvider = (K -n $NS get configmap lab-environment -o jsonpath='{.data.SEARCH_PROVIDER}') -join ''
  @"

準備ができました(環境 ${labEnv}: キャッシュ ${edgeCacheValue}・検索 ${searchProvider})。
  お店(storefront)   http://www.lab.localhost:${hostPort}
  API               http://api.lab.localhost:${hostPort}/occ/v2/samplestore/products/search?query=ノート
  管理画面          http://backoffice.lab.localhost:${hostPort}/backoffice/   (admin / admin。社内の IP だけ)
  Grafana           http://localhost:$(Get-HostPort 30300)
  Prometheus        http://localhost:$(Get-HostPort 30090)
  Alertmanager      http://localhost:$(Get-HostPort 30093)
  pager             http://localhost:$(Get-HostPort 30094)

Pod の様子:     kubectl -n lab get pods -w
環境の切り替え: k8s/up.ps1 -Env d1 -SkipBuild
スイッチ:       k8s/chaos.ps1 status
止める:         k8s/down.ps1
"@
} finally {
  Pop-Location
  [Console]::OutputEncoding = $prevConsoleEncoding
}
