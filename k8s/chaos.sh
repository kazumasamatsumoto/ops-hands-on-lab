#!/usr/bin/env bash
# 本格版(kind)で、わざと壊すスイッチ(カオス)を切り替えるスクリプトです。軽量版の tools/chaos.sh と同じ使い方です。
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
#   k8s/chaos.sh status                          全 api Pod の今の状態
#   k8s/chaos.sh set latencyMs=1500              全 api Pod に 1.5 秒の遅延を足す
#   k8s/chaos.sh set errorRate=0.5               半分を 500 にする
#   k8s/chaos.sh set leakMb=5                    リクエストのたびに 5MB ためる(上限 256Mi で OOMKilled → 再起動)
#   k8s/chaos.sh set idorBug=true                他人の注文が見えるバグ
#   k8s/chaos.sh set sqliBug=true                検索に SQL インジェクションの穴
#   k8s/chaos.sh reset                           全部元に戻す
#   k8s/chaos.sh worker set cronFail=true        worker の定期ジョブを全部失敗させる
#   k8s/chaos.sh worker reset
#
#   k8s/chaos.sh boot leakMb=20                  「起動時の値」を変える(Deployment の環境変数。ローリング更新で Pod が作り直されます)
#   k8s/chaos.sh worker boot cronFail=true cronIntervalSeconds=10   worker のジョブを失敗させ、間隔を 10 秒に(アラートの演習)
#   k8s/chaos.sh boot-reset                      起動時の値を元に戻す(これもローリング更新)。worker なら k8s/chaos.sh worker boot-reset
#
# 中でやっていること(手で打つ場合):
#   kubectl -n lab exec deploy/api -- curl -s -X POST -H 'Content-Type: application/json' \
#     -d '{"errorRate":0.5}' http://localhost:3001/admin/chaos
#   (deploy/api と書くと、api の Pod の「どれか 1 つ」にだけ届きます)
set -euo pipefail
cd "$(dirname "$0")/.."

CLUSTER="${LAB_CLUSTER:-lab}"
K="kubectl --context kind-${CLUSTER} -n lab"

target=api
case "${1:-}" in
  api | backoffice | worker)
    target="$1"
    shift
    ;;
esac

pods() {
  $K get pods -l "app.kubernetes.io/name=${target}" --field-selector=status.phase=Running \
    -o jsonpath='{range .items[*]}{.metadata.name}{"\n"}{end}'
}

call_all() {
  local found=0
  for p in $(pods); do
    found=1
    printf '%s: ' "$p"
    $K exec "$p" -c "$target" -- curl -sS "$@" || echo "(届きませんでした。再起動中かもしれません)"
    echo
  done
  if [ "$found" = 0 ]; then
    echo "動いている ${target} の Pod がありません(kubectl -n lab get pods で様子を見てください)" >&2
    exit 1
  fi
}

to_json() {
  local json="{" sep="" pair key value
  for pair in "$@"; do
    key="${pair%%=*}"
    value="${pair#*=}"
    if [ "$key" = "$pair" ]; then
      echo "名前=値 の形で書いてください: $pair" >&2
      exit 1
    fi
    if [[ "$value" =~ ^[0-9]+(\.[0-9]+)?$ || "$value" == "true" || "$value" == "false" ]]; then
      json+="${sep}\"${key}\":${value}"
    else
      json+="${sep}\"${key}\":\"${value}\""
    fi
    sep=","
  done
  echo "${json}}"
}

# スイッチの名前 → 起動時の環境変数の名前
env_name() {
  case "$1" in
    latencyMs) echo CHAOS_LATENCY_MS ;;
    errorRate) echo CHAOS_ERROR_RATE ;;
    leakMb) echo CHAOS_LEAK_MB ;;
    idorBug) echo CHAOS_IDOR_BUG ;;
    sqliBug) echo CHAOS_SQLI_BUG ;;
    cronFail) echo CHAOS_CRON_FAIL ;;
    cronIntervalSeconds) echo CRON_INTERVAL_SECONDS ;;
    *) echo "知らないスイッチです: $1" >&2; exit 1 ;;
  esac
}

URL=http://localhost:3001/admin/chaos

case "${1:-status}" in
  status)
    call_all "$URL"
    ;;
  reset)
    call_all -X POST -H 'Content-Type: application/json' -d '{"reset":true}' "$URL"
    ;;
  set)
    shift
    [ $# -gt 0 ] || { echo "例: k8s/chaos.sh set errorRate=0.5 / k8s/chaos.sh worker set cronFail=true" >&2; exit 1; }
    json="$(to_json "$@")" # 書き方が違うときは、ここで止まる(何も送らない)
    call_all -X POST -H 'Content-Type: application/json' -d "$json" "$URL"
    ;;
  boot)
    shift
    [ $# -gt 0 ] || { echo "例: k8s/chaos.sh boot leakMb=20" >&2; exit 1; }
    args=()
    for pair in "$@"; do
      args+=("$(env_name "${pair%%=*}")=${pair#*=}")
    done
    $K set env "deploy/${target}" "${args[@]}"
    echo "起動時の値を変えました。新しい Pod に入れ替わります(kubectl -n lab get pods -w で見られます)。"
    ;;
  boot-reset)
    # CHAOS_* は manifest.json に無い(= 生成した Deployment に無い)ので、消せば既定値(壊さない)に戻ります。
    # CRON_INTERVAL_SECONDS は manifest.json にある値へ戻します。
    args=(CHAOS_LATENCY_MS- CHAOS_ERROR_RATE- CHAOS_LEAK_MB- CHAOS_IDOR_BUG- CHAOS_SQLI_BUG- CHAOS_CRON_FAIL-)
    if [ "$target" = worker ]; then
      interval="$(node -e 'const m=require("./manifest.json");console.log(m.aspects.find(a=>a.service==="worker").env.CRON_INTERVAL_SECONDS)')"
      args+=("CRON_INTERVAL_SECONDS=${interval}")
    fi
    $K set env "deploy/${target}" "${args[@]}"
    echo "起動時の値を元に戻しました。新しい Pod に入れ替わります。"
    ;;
  *)
    sed -n '2,31p' "$0"
    exit 1
    ;;
esac
