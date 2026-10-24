FROM node:22.18.0-alpine AS build
RUN apk add --no-cache openssl
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/api/package.json apps/api/package.json
COPY packages/contracts/package.json packages/contracts/package.json
RUN pnpm install --frozen-lockfile --filter @callflow/api...
COPY packages/contracts packages/contracts
COPY apps/api apps/api
RUN pnpm --filter @callflow/api prisma:generate && pnpm --filter @callflow/contracts build && pnpm --filter @callflow/api build

FROM node:22.18.0-alpine AS runtime
RUN apk add --no-cache openssl
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /app /app
USER node
EXPOSE 3000
CMD ["sh", "-c", "node apps/api/node_modules/prisma/build/index.js migrate deploy --schema apps/api/prisma/schema.prisma && exec node apps/api/dist/main.js"]
