#!/usr/bin/env bash
# 本格版(kind)を止めます。クラスタごと消すので、DB・指標・ログ・トレースのデータも消えます。
# クラスタの外の cdn-waf のコンテナも消します。
# (もう一度 k8s/up.sh を実行すれば、見本データ入りのまっさらな状態で作り直されます)
#
#   k8s/down.sh
#   LAB_CLUSTER=lab2 k8s/down.sh    名前を変えて作ったクラスタを消すとき
set -euo pipefail
CLUSTER="${LAB_CLUSTER:-lab}"

docker rm -f "${CLUSTER}-cdn-waf" >/dev/null 2>&1 && echo "コンテナ ${CLUSTER}-cdn-waf を消しました" || true
kind delete cluster --name "$CLUSTER"

# ネットワーク lab-kind・lab-kind-outside は、ほかに使っているコンテナ(別の名前のクラスタなど)がいなければ消します。
for net in lab-kind-outside lab-kind; do
  if docker network inspect "$net" >/dev/null 2>&1; then
    if [ "$(docker network inspect "$net" -f '{{len .Containers}}')" = 0 ]; then
      docker network rm "$net" >/dev/null && echo "ネットワーク $net を消しました"
    else
      echo "ネットワーク $net はほかのコンテナが使っているので残します"
    fi
  fi
done
