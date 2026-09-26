#!/usr/bin/env bash
# わざと壊すスイッチ(カオス)を切り替えるスクリプトです。
#
# /admin/chaos は ingress で「外からは 403」にしているため、http://api.lab.localhost:18080/admin/chaos からは変えられません
# (それが正しい動きです)。そこで、対象のコンテナの「中」に入って、そのプロセスに直接頼みます。
#
# 使い方(リポジトリのどこから実行しても動きます)。最初に対象(api・backoffice・worker)を書けます。省くと api です。
#   tools/chaos.sh status                          api の今の状態を見る
#   tools/chaos.sh set latencyMs=1500              OCC の API とトークンに 1.5 秒の遅延を足す
#   tools/chaos.sh set errorRate=0.5               半分のリクエストを 500 にする
#   tools/chaos.sh set leakMb=5                    リクエストのたびに 5MB ずつメモリをため込む(最後は落ちる)
#   tools/chaos.sh set idorBug=true                他人の注文が見えてしまうバグを入れる
#   tools/chaos.sh set sqliBug=true                検索(query)に SQL インジェクションの穴を開ける
#   tools/chaos.sh set latencyMs=800 errorRate=0.1 まとめて変える
#   tools/chaos.sh reset                           api のスイッチを全部元に戻す
#   tools/chaos.sh worker set cronFail=true        worker(定期ジョブ)をすべて失敗させる
#   tools/chaos.sh worker status                   worker の状態を見る
#   tools/chaos.sh worker reset                    worker を元に戻す
#
# どのスイッチがどの対象に効くかは apps/api/README.md の「カオススイッチ」の表にあります(cronFail は worker だけ)。
# 対象を再起動すると、スイッチは起動時の値(docker-compose.yml の CHAOS_*)に戻ります。
#
# 中でやっていること(手で打つ場合):
#   docker compose exec api curl -s -X POST -H 'Content-Type: application/json' \
#     -d '{"errorRate":0.5}' http://localhost:3001/admin/chaos
set -euo pipefail
cd "$(dirname "$0")/.."

target=api
case "${1:-}" in
  api | backoffice | worker)
    target="$1"
    shift
    ;;
esac

call() {
  docker compose exec -T "$target" curl -sS "$@"
  echo
}

URL=http://localhost:3001/admin/chaos

case "${1:-status}" in
  status)
    call "$URL"
    ;;
  reset)
    call -X POST -H 'Content-Type: application/json' -d '{"reset":true}' "$URL"
    ;;
  set)
    shift
    if [ $# -eq 0 ]; then
      echo "例: tools/chaos.sh set errorRate=0.5 / tools/chaos.sh worker set cronFail=true" >&2
      exit 1
    fi
    json="{"
    sep=""
    for pair in "$@"; do
      key="${pair%%=*}"
      value="${pair#*=}"
      if [ "$key" = "$pair" ]; then
        echo "名前=値 の形で書いてください: $pair" >&2
        exit 1
      fi
      # 数と true/false はそのまま、それ以外は文字列として送ります(相手の側で検査して、おかしければ 400 が返ります)。
      if [[ "$value" =~ ^[0-9]+(\.[0-9]+)?$ || "$value" == "true" || "$value" == "false" ]]; then
        json+="${sep}\"${key}\":${value}"
      else
        json+="${sep}\"${key}\":\"${value}\""
      fi
      sep=","
    done
    json+="}"
    call -X POST -H 'Content-Type: application/json' -d "$json" "$URL"
    ;;
  *)
    sed -n '2,24p' "$0"
    exit 1
    ;;
esac
