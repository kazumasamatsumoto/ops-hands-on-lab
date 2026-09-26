#!/bin/sh
# ingress の起動時に 1 回だけ動き、backoffice の IP フィルタ(nginx の allow / deny の行)を作ります。
# nginx の公式イメージは、/docker-entrypoint.d/ に置いたスクリプトを nginx の起動前に順に動かします。
#
#   入力: 環境変数 BACKOFFICE_IP_ALLOWLIST(空白かカンマで区切った CIDR。例 "127.0.0.1/32 172.30.89.0/24")
#   出力: /etc/nginx/ip-filters/backoffice.conf
#           allow 127.0.0.1/32;
#           allow 172.30.89.0/24;
#           deny all;
#
# CCv2 の Cloud Portal でエンドポイントに IP フィルタを付けるのと同じで、「許す範囲の一覧 + それ以外は拒否」です。
# 一覧が空なら、誰も通しません(うっかり全開にしないため)。
set -eu

out=/etc/nginx/ip-filters/backoffice.conf
mkdir -p "$(dirname "$out")"
: > "$out"
for cidr in $(echo "${BACKOFFICE_IP_ALLOWLIST:-}" | tr ',' ' '); do
  # 数字・点・スラッシュ・コロン(IPv6)以外が入っていたら止めます(設定の書き間違いに早く気付くため)。
  case "$cidr" in
    *[!0-9a-fA-F.:/]*) echo "40-ip-filter.sh: IP の書き方が正しくありません: $cidr" >&2; exit 1 ;;
  esac
  echo "allow $cidr;" >> "$out"
done
echo "deny all;" >> "$out"
echo "40-ip-filter.sh: backoffice の IP フィルタ:"
sed 's/^/  /' "$out"
