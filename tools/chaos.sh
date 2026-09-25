#!/usr/bin/env bash
# わざと壊すスイッチ(カオス)を切り替えるスクリプトです。
#
# /admin/chaos は edge で「社内(Docker の内部ネットワーク)から以外は 403」にしているため、
# ホストのブラウザや curl http://localhost:18080/admin/chaos からは変えられません(それが正しい動きです)。
# そこで、api コンテナの「中」に入って、api に直接頼みます。
#
# 使い方(リポジトリのどこから実行しても動きます):
#   tools/chaos.sh status                          今の状態を見る
#   tools/chaos.sh set latencyMs=1500              全 API に 1.5 秒の遅延を足す
#   tools/chaos.sh set errorRate=0.5               半分のリクエストを 500 にする
#   tools/chaos.sh set leakMb=5                    リクエストのたびに 5MB ずつメモリをため込む(最後は落ちる)
#   tools/chaos.sh set idorBug=true                他人の注文が見えてしまうバグを入れる
#   tools/chaos.sh set sqliBug=true                検索に SQL インジェクションの穴を開ける
#   tools/chaos.sh set latencyMs=800 errorRate=0.1 まとめて変える
#   tools/chaos.sh reset                           全部元に戻す
#
# 中でやっていること(手で打つ場合):
#   docker compose exec api curl -s -X POST -H 'Content-Type: application/json' \
#     -d '{"errorRate":0.5}' http://localhost:3001/admin/chaos
set -euo pipefail
cd "$(dirname "$0")/.."

call() {
  docker compose exec -T api curl -sS "$@"
  echo
}

case "${1:-status}" in
  status)
    call http://localhost:3001/admin/chaos
    ;;
  reset)
    call -X POST -H 'Content-Type: application/json' -d '{"reset":true}' http://localhost:3001/admin/chaos
    ;;
  set)
    shift
    if [ $# -eq 0 ]; then
      echo "例: tools/chaos.sh set errorRate=0.5" >&2
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
      # 数と true/false はそのまま、それ以外は文字列として送ります(api 側で検査して、おかしければ 400 が返ります)。
      if [[ "$value" =~ ^[0-9]+(\.[0-9]+)?$ || "$value" == "true" || "$value" == "false" ]]; then
        json+="${sep}\"${key}\":${value}"
      else
        json+="${sep}\"${key}\":\"${value}\""
      fi
      sep=","
    done
    json+="}"
    call -X POST -H 'Content-Type: application/json' -d "$json" http://localhost:3001/admin/chaos
    ;;
  *)
    sed -n '2,20p' "$0"
    exit 1
    ;;
esac
