#!/usr/bin/env bash
# 本格版(kind = Docker の中の Kubernetes)を起動するスクリプトです。何度実行しても大丈夫です(あるものはそのまま、変わったものだけ反映)。
#
#   k8s/up.sh                 環境 p1(本番のまね)で起動
#   LAB_ENV=d1 k8s/up.sh      環境 d1(開発のまね)に切り替える。s1 も同じ。もう一度 p1 にすれば戻ります
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
#   7. アプリと Ingress を、環境 LAB_ENV の差分(k8s/generated/envs/<環境>)で反映する
#   8. 全部の Pod が Ready になるまで待つ
#   9. クラスタの外に cdn-waf のコンテナを起動する(キャッシュの ON/OFF は環境の ConfigMap lab-environment から)
#
# 変えられる値(ふだんは不要):
#   LAB_ENV=p1                          環境(d1・s1・p1)
#   LAB_CLUSTER=lab                     クラスタの名前(cdn-waf のコンテナ名は <クラスタ名>-cdn-waf)
#   LAB_KIND_CONFIG=k8s/kind-config.yaml クラスタ定義のファイル(観測の道具のホスト側のポートはここで決まる)
#   LAB_HTTP_PORT=18080                 お店の入口(cdn-waf)のホスト側のポート
#   LAB_CDN_WAF_IP=172.30.91.10         cdn-waf の lab-kind の中での IP(クラスタを 2 つ同時に動かすときだけ変える)
#   LAB_SKIP_BUILD=1                    イメージのビルドを飛ばす(環境を切り替えるだけのときに速い)
set -euo pipefail
cd "$(dirname "$0")/.."

LAB_ENV="${LAB_ENV:-p1}"
CLUSTER="${LAB_CLUSTER:-lab}"
KIND_CONFIG="${LAB_KIND_CONFIG:-k8s/kind-config.yaml}"
HTTP_PORT="${LAB_HTTP_PORT:-18080}"
CDN_WAF_IP="${LAB_CDN_WAF_IP:-172.30.91.10}"
CDN_WAF="${CLUSTER}-cdn-waf"
NODE="${CLUSTER}-control-plane"
K="kubectl --context kind-${CLUSTER}"
NS=lab

# Docker のネットワーク。番号を固定するのは、manifest.json の ipFilters.office(社内の範囲)と
# ingress-nginx の proxy-real-ip-cidr(X-Forwarded-For を信じる相手)に、同じ番号を書いておくためです。
NET=lab-kind
NET_SUBNET=172.30.91.0/24
OUTSIDE_NET=lab-kind-outside
OUTSIDE_SUBNET=172.30.92.0/24

case "$LAB_ENV" in
  d1 | s1 | p1) ;;
  *) echo "LAB_ENV は d1・s1・p1 のどれかにしてください(今: $LAB_ENV)" >&2; exit 1 ;;
esac

for cmd in docker kind kubectl node; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "$cmd が見つかりません。k8s/README.md の「用意するもの」を見て入れてください。" >&2
    exit 1
  fi
done

step() { printf '\n==> %s\n' "$*"; }

# ---------- 1. Docker のネットワーク ----------
ensure_network() {
  local name="$1" subnet="$2" gateway="$3"
  if docker network inspect "$name" >/dev/null 2>&1; then
    local actual
    actual="$(docker network inspect "$name" -f '{{range .IPAM.Config}}{{.Subnet}} {{end}}')"
    case " $actual " in
      *" $subnet "*) ;;
      *) echo "ネットワーク $name の番号が $subnet ではありません($actual)。docker network rm $name してからやり直してください。" >&2; exit 1 ;;
    esac
  else
    docker network create --driver bridge --subnet "$subnet" --gateway "$gateway" "$name" >/dev/null
    echo "  ネットワーク $name($subnet)を作りました"
  fi
}
step "Docker のネットワークを用意します(lab-kind = クラスタと cdn-waf、lab-kind-outside = 社外の代わり)"
ensure_network "$NET" "$NET_SUBNET" 172.30.91.1
ensure_network "$OUTSIDE_NET" "$OUTSIDE_SUBNET" 172.30.92.1

# ---------- 2. クラスタ ----------
if kind get clusters 2>/dev/null | grep -qx "$CLUSTER"; then
  step "クラスタ ${CLUSTER} はもうあります。作らずに進みます"
else
  step "クラスタ ${CLUSTER} を作ります(初回はノードのイメージ取得で数分かかります)"
  # KIND_EXPERIMENTAL_DOCKER_NETWORK: ノードをつなぐ Docker のネットワークを指定する kind の設定です(既定は kind という名前)。
  KIND_EXPERIMENTAL_DOCKER_NETWORK="$NET" kind create cluster --name "$CLUSTER" --config "$KIND_CONFIG" --wait 120s
fi

# ---------- 3. イメージ ----------
if [ "${LAB_SKIP_BUILD:-}" = 1 ]; then
  step "イメージのビルドを飛ばします(LAB_SKIP_BUILD=1)"
else
  step "storefront と api のイメージをビルドします(軽量版と同じ Dockerfile)"
  docker build -t lab/api:local apps/api
  docker build -t lab/web:local apps/web
fi
step "イメージを kind のノードに読み込みます(ノードは手元の Docker のイメージを直接は見られないため)"
kind load docker-image lab/api:local lab/web:local --name "$CLUSTER"

# ---------- 4. ingress-nginx ----------
step "ingress-nginx(クラスタの入口の振り分け係)を入れます"
$K apply -k k8s/vendor/ingress-nginx >/dev/null
$K -n ingress-nginx rollout status deploy/ingress-nginx-controller --timeout=300s

# ---------- 5. manifest.json → k8s/generated/ ----------
step "manifest.json から k8s/generated/ を作り直します"
node tools/manifest/render.mjs

# ---------- 6. 土台と観測 ----------
step "土台(Namespace・Secret・DB・Solr)を反映します"
$K apply -f k8s/platform/namespace.yaml >/dev/null

# ConfigMap を「ファイルから作って、差分だけ反映」する小さな関数です。
cm() {
  local name="$1"; shift
  $K -n "$NS" create configmap "$name" "$@" --dry-run=client -o yaml | $K apply --server-side --force-conflicts -f - >/dev/null
  echo "  configmap/$name"
}
cm solr-products-config --from-file=apps/api/solr/products/conf/
$K apply -k k8s/platform

step "観測の道具の設定(ConfigMap)と本体を反映します"
cm prometheus-config --from-file=prometheus.yml=k8s/config/prometheus.yml
cm prometheus-rules --from-file=observability/prometheus/rules/
cm alertmanager-config --from-file=alertmanager.yml=observability/alertmanager/alertmanager.yml
cm pager-app --from-file=server.mjs=observability/pager/server.mjs
cm grafana-datasources --from-file=datasources.yml=k8s/config/grafana-datasources.yml
cm grafana-dashboard-providers --from-file=observability/grafana/provisioning/dashboards/
cm grafana-dashboards --from-file=observability/grafana/dashboards/samplestore-slo.json --from-file=k8s/config/dashboards/samplestore-trace.json
cm loki-config --from-file=loki.yml=observability/loki/loki.yml
cm alloy-config --from-file=config.alloy=k8s/config/config.alloy
cm otel-collector-config --from-file=otel-collector.yaml=k8s/config/otel-collector.yaml
cm tempo-config --from-file=tempo.yaml=k8s/config/tempo.yaml
$K apply -k k8s/observability

# ---------- 7. アプリと Ingress(環境の差分つき) ----------
step "アプリと Ingress を環境 ${LAB_ENV} で反映します(kubectl apply -k k8s/generated/envs/${LAB_ENV})"
# ingress-nginx は Ingress を受け付ける前に中身を確かめる「検問(admission webhook)」を持っています。
# 入れた直後は検問の準備ができておらず断られることがあるので、何回かやり直します。
for try in 1 2 3 4 5 6 7 8 9 10; do
  if $K apply -k "k8s/generated/envs/${LAB_ENV}"; then break; fi
  [ "$try" = 10 ] && exit 1
  echo "  (ingress-nginx の検問の準備を待って、やり直します)"; sleep 6
done

# ---------- 8. 待つ ----------
step "全部の Pod が Ready になるまで待ちます(初回はイメージ取得で 5〜10 分かかることがあります)"
$K -n "$NS" rollout status statefulset/db --timeout=600s
for d in search api backoffice worker storefront prometheus alertmanager pager grafana loki alloy otel-collector tempo; do
  $K -n "$NS" rollout status "deploy/$d" --timeout=600s
done

# ---------- 9. cdn-waf(クラスタの外) ----------
# 軽量版と同じイメージ・同じ設定ファイル(cdn-waf/default.conf.template)を、ただの Docker のコンテナとして動かします。
# 行き先(INGRESS_UPSTREAM)だけが違い、kind のノード(<クラスタ名>-control-plane)の 80 番 = ingress-nginx に送ります。
# キャッシュの ON/OFF は、環境の ConfigMap lab-environment の EDGE_CACHE(manifest.json の environments.*.cdnCache)に従います。
step "cdn-waf をクラスタの外に起動します(コンテナ ${CDN_WAF})"
EDGE_CACHE_ENV="$($K -n "$NS" get configmap lab-environment -o jsonpath='{.data.EDGE_CACHE}')"
# CSP は軽量版の docker-compose.yml の WWW_CSP をそのまま使います(2 か所に同じ長い文字列を書かないため)。
WWW_CSP="$(sed -n 's/^ *WWW_CSP: "\(.*\)"$/\1/p' docker-compose.yml)"
[ -n "$WWW_CSP" ] || { echo "docker-compose.yml から WWW_CSP を読めませんでした" >&2; exit 1; }

docker rm -f "$CDN_WAF" >/dev/null 2>&1 || true
docker run -d --name "$CDN_WAF" \
  --network "$NET" --ip "$CDN_WAF_IP" \
  -p "127.0.0.1:${HTTP_PORT}:8081" \
  -e INGRESS_UPSTREAM="${NODE}:80" \
  -e EDGE_CACHE="${EDGE_CACHE:-$EDGE_CACHE_ENV}" \
  -e EDGE_GLOBAL_RATE="${EDGE_GLOBAL_RATE:-20r/s}" \
  -e EDGE_GLOBAL_BURST="${EDGE_GLOBAL_BURST:-80}" \
  -e WWW_CSP="$WWW_CSP" \
  -e MODSEC_RULE_ENGINE=On \
  -e BLOCKING_PARANOIA="${BLOCKING_PARANOIA:-1}" \
  -e ANOMALY_INBOUND="${ANOMALY_INBOUND:-5}" \
  -e ANOMALY_OUTBOUND=4 \
  -e MODSEC_AUDIT_LOG_FORMAT=JSON \
  -e MODSEC_AUDIT_LOG=/dev/stdout \
  -e RESOLVERS=127.0.0.11 \
  -e BACKEND="http://${NODE}:80" \
  -v "$PWD/cdn-waf/default.conf.template:/etc/nginx/templates/conf.d/default.conf.template:ro" \
  -v "$PWD/cdn-waf/modsecurity/lab-exclusions-before.conf:/opt/owasp-crs/plugins/lab-exclusions-before.conf:ro" \
  --sysctl net.ipv4.ip_local_port_range="1024 65535" \
  --sysctl net.ipv4.tcp_tw_reuse=1 \
  --health-cmd 'curl -fsS -H "Host: localhost" http://127.0.0.1:18080/cdn-healthz' \
  --health-interval 5s --health-retries 10 \
  --memory 128m --restart unless-stopped \
  --label lab.cluster="$CLUSTER" \
  owasp/modsecurity-crs:4.25.1-nginx-alpine-202609241109-lts >/dev/null
# 社外の代わりのネットワークにもつなぎます(IP フィルタの 403 を確かめる演習用。README の「IP フィルタを確かめる」)。
docker network connect "$OUTSIDE_NET" "$CDN_WAF"

for _ in $(seq 1 60); do
  [ "$(docker inspect -f '{{.State.Health.Status}}' "$CDN_WAF")" = healthy ] && break
  sleep 2
done
code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 "http://www.lab.localhost:${HTTP_PORT}/" || true)"
echo "  http://www.lab.localhost:${HTTP_PORT}/ → ${code}"

$K -n "$NS" get pods -o wide

port_of() {
  docker port "$NODE" "$1/tcp" 2>/dev/null | head -1 | sed 's/.*://'
}
cat <<MSG

準備ができました(環境 ${LAB_ENV}: $($K -n "$NS" get configmap lab-environment -o jsonpath='キャッシュ {.data.EDGE_CACHE}・検索 {.data.SEARCH_PROVIDER}'))。
  お店(storefront)   http://www.lab.localhost:${HTTP_PORT}
  API               http://api.lab.localhost:${HTTP_PORT}/occ/v2/samplestore/products/search?query=ノート
  管理画面          http://backoffice.lab.localhost:${HTTP_PORT}/backoffice/   (admin / admin。社内の IP だけ)
  Grafana           http://localhost:$(port_of 30300)
  Prometheus        http://localhost:$(port_of 30090)
  Alertmanager      http://localhost:$(port_of 30093)
  pager             http://localhost:$(port_of 30094)

Pod の様子:     kubectl -n lab get pods -w
環境の切り替え: LAB_ENV=d1 LAB_SKIP_BUILD=1 k8s/up.sh
スイッチ:       k8s/chaos.sh status
止める:         k8s/down.sh
MSG
