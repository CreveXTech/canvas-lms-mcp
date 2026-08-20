# syntax=docker/dockerfile:1

FROM node:24-alpine AS build
WORKDIR /app
ENV CI=true
RUN corepack enable
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY tsconfig.json ./
COPY src ./src
RUN pnpm build

FROM node:24-alpine AS deps
WORKDIR /app
ENV CI=true
RUN corepack enable
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile --prod

FROM node:24-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    MCP_TRANSPORT=http \
    MCP_HTTP_PORT=3000 \
    MCP_HTTP_HOST=0.0.0.0

COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./

USER node
EXPOSE 3000

# `node` handles SIGTERM itself; compose's init supplies the PID 1 reaper.
CMD ["node", "dist/index.js"]
