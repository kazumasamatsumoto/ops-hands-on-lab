#!/usr/bin/env bash
# 攻撃の「見本」を送って、WAF(edge の ModSecurity)が止めるかを確かめるスクリプトです。
#
# !!! 注意 !!!
#   このスクリプトは、自分の PC で動かしているこのラボ(http://localhost:18080)にだけ使ってください。
#   実在するサイトや他人のサーバーに送ってはいけません。許可なく送ると、法律(不正アクセス禁止法など)に触れるおそれがあります。
#   そのため、送り先は localhost:18080 に固定していて、変えられないようにしています。
#
# 使い方: tools/attack-samples.sh
# 期待する結果: 攻撃の見本は 403(WAF が遮断)、普通の検索は 200。
set -uo pipefail

BASE="http://localhost:18080"

send() {
  local label="$1" path="$2"
  local code
  code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "${BASE}${path}")
  printf '%s  %s\n     %s\n' "$code" "$label" "$path"
}

echo "送り先: ${BASE}(ラボ専用)"
echo "結果 内容 / 送った URL"
send "普通の検索(通るべき)"            "/api/products?q=%E3%83%8E%E3%83%BC%E3%83%88"
send "SQL インジェクション: 常に真"        "/api/products?q=%27%20OR%20%271%27%3D%271"
send "SQL インジェクション: UNION"        "/api/products?q=%27%20UNION%20SELECT%20id%2Cusername%2Cpassword_hash%2C1%2C1%2C1%20FROM%20users--"
send "SQL インジェクション: コメント"      "/api/products?q=abc%27%3B--"
send "XSS: script タグ"                   "/api/products?q=%3Cscript%3Ealert(1)%3C%2Fscript%3E"
send "XSS: img onerror"                   "/products?q=%3Cimg%20src%3Dx%20onerror%3Dalert(1)%3E"
send "パスの巡回(../)"                   "/api/products?file=..%2F..%2F..%2Fetc%2Fpasswd"
echo
echo "403 = WAF が遮断した / 200 = 通った。遮断の理由は docker compose logs edge の \"ruleId\" で分かります。"
