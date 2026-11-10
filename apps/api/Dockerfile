# Build from the repo root: docker build -f apps/api/Dockerfile -t aywo-api .
FROM node:lts-slim
RUN corepack enable
WORKDIR /repo
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc tsconfig.base.json ./
COPY apps/api ./apps/api
COPY apps/app/package.json ./apps/app/package.json
COPY packages ./packages
COPY db ./db
RUN pnpm install --frozen-lockfile --filter @aywo/api...
ENV NODE_ENV=production
USER node
WORKDIR /repo/apps/api
EXPOSE 3000
CMD ["pnpm", "start"]
