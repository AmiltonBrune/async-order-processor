# Multi-stage unico para os tres papeis: a diferenca entre api, relay e consumer
# e a variavel APP_ROLE, nao a imagem. Tres imagens divergiriam em silencio.
FROM node:22-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci

FROM node:22-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY tsconfig*.json ./
COPY src ./src
RUN npx tsc -p tsconfig.build.json

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
# Roda como usuario sem privilegio: container de aplicacao nao precisa de root.
USER node
CMD ["node", "dist/main.js"]
