# サンプルストア web(Angular 21 SSR)のイメージ
# 2 段階ビルド: 1 段目でビルドし、2 段目には出来上がったファイルだけを入れます(小さく、余計な道具を持たない)。
#   ビルド:  docker build -t samplestore-web apps/web
#   起動:    docker run --rm -p 4000:4000 -e API_INTERNAL_URL=http://api:3001 samplestore-web

# ---- 1 段目: ビルド ----
FROM node:24.21.0-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
# budgets(angular.json)を超えると、ここで失敗してイメージは作られません
RUN npx ng build --configuration production

# ---- 2 段目: 実行 ----
# ビルド結果(dist/web/server/server.mjs)は必要なライブラリを中に含むので、node_modules は入れません
FROM node:24.21.0-bookworm-slim AS runtime
ENV NODE_ENV=production \
    PORT=4000 \
    RENDER_MODE=ssr \
    SSR_TIMEOUT_MS=3000 \
    SSR_WINDOW_BUG=false \
    API_INTERNAL_URL=http://api:3001
WORKDIR /app
COPY --from=build --chown=node:node /app/dist/web ./dist/web
# root では動かさない(乗っ取られたときの被害を小さくする)
USER node
EXPOSE 4000
# 生きているかの確認(curl が無いイメージなので node で聞きます)
HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||4000)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
CMD ["node", "dist/web/server/server.mjs"]
