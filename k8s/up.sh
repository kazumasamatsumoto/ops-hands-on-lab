#!/usr/bin/env bash
# 本格版(kind)を起動するスクリプトです。何度実行しても大丈夫です(あるものはそのまま、変わったものだけ反映)。
#
#   k8s/up.sh
#
# やること:
#   1. kind のクラスタ(名前 lab)が無ければ作る
#   2. api と web のイメージを手元でビルドし、kind のノードに読み込む(軽量版と同じイメージ)
#   3. 設定ファイル(nginx・Prometheus・Grafana など)を ConfigMap に入れる(軽量版と同じファイルを使う)
#   4. マニフェスト(k8s/manifests)を反映する
#   5. 全部の Pod が Ready になるまで待ち、開く場所(URL)を表示する
#
# 変えられる値(ふだんは不要):
#   LAB_CLUSTER=lab                     クラスタの名前
#   LAB_KIND_CONFIG=k8s/kind-config.yaml クラスタ定義のファイル
set -euo pipefail
cd "$(dirname "$0")/.."

CLUSTER="${LAB_CLUSTER:-lab}"
KIND_CONFIG="${LAB_KIND_CONFIG:-k8s/kind-config.yaml}"
CTX="kind-${CLUSTER}"
K="kubectl --context ${CTX}"
NS=lab

for cmd in docker kind kubectl; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "$cmd が見つかりません。k8s/README.md の「用意するもの」を見て入れてください。" >&2
    exit 1
  fi
done

step() { printf '\n==> %s\n' "$*"; }

# ---------- 1. クラスタ ----------
if kind get clusters 2>/dev/null | grep -qx "$CLUSTER"; then
  step "クラスタ ${CLUSTER} はもうあります。作らずに進みます"
else
  step "クラスタ ${CLUSTER} を作ります(初回はノードのイメージ取得で数分かかります)"
  kind create cluster --name "$CLUSTER" --config "$KIND_CONFIG" --wait 120s
fi

# ---------- 2. イメージ ----------
step "api と web のイメージをビルドします(軽量版と同じ Dockerfile)"
docker build -t lab/api:local apps/api
docker build -t lab/web:local apps/web

step "イメージを kind のノードに読み込みます"
kind load docker-image lab/api:local lab/web:local --name "$CLUSTER"

# ---------- 3. 設定ファイル → ConfigMap ----------
step "Namespace と設定(ConfigMap)を反映します"
$K apply -f k8s/manifests/namespace.yaml

DNS_IP="$($K -n kube-system get svc kube-dns -o jsonpath='{.spec.clusterIP}')"
if [ "$DNS_IP" != "10.96.0.10" ]; then
  echo "注意: kube-dns の番号が 10.96.0.10 ではありません($DNS_IP)。k8s/manifests/edge.yaml の RESOLVERS も合わせてください。" >&2
fi

# ConfigMap を「ファイルから作って、差分だけ反映」する小さな関数です。
cm() {
  local name="$1"; shift
  $K -n "$NS" create configmap "$name" "$@" --dry-run=client -o yaml | $K apply --server-side --force-conflicts -f - >/dev/null
  echo "  configmap/$name"
}

# edge の nginx 設定は軽量版のファイルを使い、Kubernetes 用に 2 か所だけ書き換えます(k8s/manifests/edge.yaml の説明を参照)。
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT
{
  echo "# このファイルは k8s/up.sh が edge/default.conf.template から作ったものです(resolver と振り分け先の名前だけ Kubernetes 用)。"
  sed -e "s#resolver 127.0.0.11 #resolver ${DNS_IP} #" \
      -e 's#http://api:3001#http://api.lab.svc.cluster.local:3001#' \
      -e 's#http://web:4000#http://web.lab.svc.cluster.local:4000#' \
      edge/default.conf.template
} > "$TMP_DIR/default.conf.template"

cm edge-config \
  --from-file=default.conf.template="$TMP_DIR/default.conf.template" \
  --from-file=lab-exclusions-before.conf=edge/modsecurity/lab-exclusions-before.conf
cm prometheus-config --from-file=prometheus.yml=k8s/config/prometheus.yml
cm prometheus-rules --from-file=observability/prometheus/rules/
cm alertmanager-config --from-file=alertmanager.yml=observability/alertmanager/alertmanager.yml
cm pager-app --from-file=server.mjs=observability/pager/server.mjs
cm grafana-datasources --from-file=observability/grafana/provisioning/datasources/
cm grafana-dashboard-providers --from-file=observability/grafana/provisioning/dashboards/
cm grafana-dashboards --from-file=observability/grafana/dashboards/
cm loki-config --from-file=loki.yml=observability/loki/loki.yml
cm alloy-config --from-file=config.alloy=k8s/config/config.alloy

# ---------- 4. マニフェスト ----------
step "マニフェストを反映します(kubectl apply -k k8s/manifests)"
$K apply -k k8s/manifests

# ---------- 5. 待つ ----------
step "全部の Pod が Ready になるまで待ちます(初回はイメージ取得で 5〜10 分かかることがあります)"
$K -n "$NS" rollout status statefulset/db --timeout=600s
for d in api web edge prometheus alertmanager pager grafana loki alloy; do
  $K -n "$NS" rollout status "deploy/$d" --timeout=600s
done

$K -n "$NS" get pods -o wide

port_of() {
  docker port "${CLUSTER}-control-plane" "$1/tcp" 2>/dev/null | head -1 | sed 's/.*://'
}
cat <<MSG

準備ができました。
  サンプルストア  http://localhost:$(port_of 30080)
  Grafana        http://localhost:$(port_of 30300)
  Prometheus     http://localhost:$(port_of 30090)
  Alertmanager   http://localhost:$(port_of 30093)
  pager          http://localhost:$(port_of 30094)

Pod の様子:     kubectl -n lab get pods -w
スイッチ:       k8s/chaos.sh status
止める:         k8s/down.sh
MSG
