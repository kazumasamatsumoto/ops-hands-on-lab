# サンプルストア API のイメージです。
# 2 段階(マルチステージ)で作ります: 1 段目で依存パッケージを入れ、2 段目には動かすのに必要な物だけを写します。
# たとえ: 台所で料理して(1 段目)、お皿に盛った料理だけを食卓に出す(2 段目)。

FROM node:24.21.0-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund

FROM node:24.21.0-alpine
# curl は演習で「コンテナの中から API を直接呼ぶ」ために入れています。
RUN apk add --no-cache curl
WORKDIR /app
ENV NODE_ENV=production PORT=3001
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY src ./src
# root ではなく、イメージに最初からある一般ユーザー node で動かします(乗っ取られたときの被害を小さくするため)。
USER node
EXPOSE 3001
HEALTHCHECK --interval=10s --timeout=3s --start-period=20s --retries=3 \
  CMD curl -fsS http://127.0.0.1:3001/healthz || exit 1
CMD ["node", "src/server.js"]
