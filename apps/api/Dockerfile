# Build from the repo root: docker build -f apps/api/Dockerfile -t aywo-api .
FROM node:lts-slim
# pg_dump and pg_restore for the nightly backup. They must be the same major version as the database (17), which
# Debian's own packages are not, so they come from the PostgreSQL project's repository.
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl \
 && install -d /usr/share/postgresql-common/pgdg \
 && curl -fsSL -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc https://www.postgresql.org/media/keys/ACCC4CF8.asc \
 && . /etc/os-release \
 && echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] https://apt.postgresql.org/pub/repos/apt ${VERSION_CODENAME}-pgdg main" > /etc/apt/sources.list.d/pgdg.list \
 && apt-get update \
 && apt-get install -y --no-install-recommends postgresql-client-17 \
 && apt-get purge -y curl \
 && apt-get autoremove -y \
 && rm -rf /var/lib/apt/lists/*
RUN corepack enable
WORKDIR /repo
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json ./
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
