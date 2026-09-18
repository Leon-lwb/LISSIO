# syntax=docker/dockerfile:1.7
FROM node:26-bookworm AS web
WORKDIR /src
RUN corepack enable
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY index.html tsconfig.json tsconfig.node.json vite.config.ts eslint.config.js ./
COPY src ./src
COPY public ./public
RUN pnpm build:web

FROM rust:1-bookworm AS server
WORKDIR /src
RUN apt-get update && apt-get install -y --no-install-recommends \
      build-essential clang cmake libudev-dev pkg-config ca-certificates \
    && rm -rf /var/lib/apt/lists/*
COPY src-tauri ./src-tauri
RUN cargo build --manifest-path src-tauri/Cargo.toml --release \
      -p backend-server -p backend-cli

FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates libudev1 \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --system --uid 10001 --create-home lissio
COPY --from=server /src/src-tauri/target/release/lissio-server /usr/local/bin/lissio-server
COPY --from=server /src/src-tauri/target/release/backend-cli /usr/local/bin/backend-cli
COPY --from=web /src/dist /opt/lissio/web
COPY packaging/container/entrypoint.sh /usr/local/bin/lissio-entrypoint
RUN chmod 0755 /usr/local/bin/lissio-server /usr/local/bin/backend-cli /usr/local/bin/lissio-entrypoint \
    && mkdir -p /var/lib/lissio \
    && chown -R lissio:lissio /var/lib/lissio
USER lissio
VOLUME ["/var/lib/lissio"]
EXPOSE 8790 8765
ENTRYPOINT ["/usr/local/bin/lissio-entrypoint"]
