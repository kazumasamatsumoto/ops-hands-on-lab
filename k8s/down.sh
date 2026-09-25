#!/usr/bin/env bash
# 本格版(kind)を止めます。クラスタごと消すので、DB・指標・ログのデータも消えます。
# (もう一度 k8s/up.sh を実行すれば、見本データ入りのまっさらな状態で作り直されます)
#
#   k8s/down.sh
set -euo pipefail
CLUSTER="${LAB_CLUSTER:-lab}"
kind delete cluster --name "$CLUSTER"
