#!/usr/bin/env bash
# 攻撃の「見本」を送って、WAF(cdn-waf の ModSecurity)が止めるかを確かめるスクリプトです。
#
# !!! 注意 !!!
#   このスクリプトは、自分の PC で動かしているこのラボ(http://www.lab.localhost:18080 と http://api.lab.localhost:18080)にだけ使ってください。
#   実在するサイトや他人のサーバーに送ってはいけません。許可なく送ると、法律(不正アクセス禁止法など)に触れるおそれがあります。
#   そのため、送り先はラボのホスト名に固定していて、変えられないようにしています。
#   さらに curl の --resolve で、名前を必ず自分の PC(127.0.0.1)に向けています(名前の引き方がおかしくても外に出ません)。
#
# 使い方: tools/attack-samples.sh
# 期待する結果: 攻撃の見本は 403(WAF が遮断)、普通の検索は 200。
set -uo pipefail

API="http://api.lab.localhost:18080"
WWW="http://www.lab.localhost:18080"
SEARCH="/occ/v2/samplestore/products/search?query="
PIN=(--resolve api.lab.localhost:18080:127.0.0.1 --resolve www.lab.localhost:18080:127.0.0.1)

send() {
  local label="$1" url="$2"
  local code
  code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "${PIN[@]}" "$url")
  printf '%s  %s\n     %s\n' "$code" "$label" "$url"
}

echo "送り先: ${API} と ${WWW}(ラボ専用)"
echo "結果 内容 / 送った URL"
echo "--- api(OCC の商品検索 query)"
send "普通の検索(通るべき)"            "${API}${SEARCH}%E3%83%8E%E3%83%BC%E3%83%88"
send "SQL インジェクション: 常に真"        "${API}${SEARCH}%27%20OR%20%271%27%3D%271"
send "SQL インジェクション: UNION"        "${API}${SEARCH}%27%20UNION%20SELECT%20username%2Cpassword_hash%20FROM%20users--"
send "SQL インジェクション: コメント"      "${API}${SEARCH}abc%27%3B--"
send "XSS: script タグ"                   "${API}${SEARCH}%3Cscript%3Ealert(1)%3C%2Fscript%3E"
send "パスの巡回(../)"                   "${API}${SEARCH}a&file=..%2F..%2F..%2Fetc%2Fpasswd"
echo "--- storefront(画面の検索 q)"
send "普通の検索(通るべき)"            "${WWW}/search?q=%E3%83%8E%E3%83%BC%E3%83%88"
send "SQL インジェクション: 常に真"        "${WWW}/search?q=%27%20OR%20%271%27%3D%271"
send "XSS: img onerror"                   "${WWW}/search?q=%3Cimg%20src%3Dx%20onerror%3Dalert(1)%3E"
echo
echo "403 = WAF が遮断した / 200 = 通った。遮断の理由は docker compose logs cdn-waf の \"ruleId\" で分かります。"
