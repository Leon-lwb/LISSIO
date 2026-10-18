# syntax=docker/dockerfile:1.7
# The umbrella repository owns this image; the frontend lives in the `client/`
# submodule and the Rust workspace in the `server/` submodule, whose `core/`,
# `physical/`, and `data/` directories are nested submodules. All of them are
# copied from the working tree, so a checkout made with
# `git submodule update --init --recursive` builds the whole product.
FROM node:26-bookworm AS web
WORKDIR /src/client
RUN corepack enable
COPY client/package.json client/pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY client/ ./
RUN pnpm build:web

FROM rust:1-bookworm AS server
WORKDIR /src
RUN apt-get update && apt-get install -y --no-install-recommends \
      build-essential clang cmake libudev-dev pkg-config ca-certificates \
    && rm -rf /var/lib/apt/lists/*
# `server/core`, `server/physical`, and `server/data` are submodules; copying the
# server directory brings their checked-out contents in with it.
COPY server ./server
RUN cargo build --manifest-path server/Cargo.toml --release \
      -p lissio-backend-server -p lissio-backend-cli

FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates libudev1 \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --system --uid 10001 --create-home lissio
COPY --from=server /src/server/target/release/lissio-server /usr/local/bin/lissio-server
COPY --from=server /src/server/target/release/backend-cli /usr/local/bin/backend-cli
COPY --from=web /src/client/dist /opt/lissio/web
COPY packaging/container/entrypoint.sh /usr/local/bin/lissio-entrypoint
RUN chmod 0755 /usr/local/bin/lissio-server /usr/local/bin/backend-cli /usr/local/bin/lissio-entrypoint \
    && mkdir -p /var/lib/lissio \
    && chown -R lissio:lissio /var/lib/lissio
USER lissio
VOLUME ["/var/lib/lissio"]
EXPOSE 8790 8765
ENTRYPOINT ["/usr/local/bin/lissio-entrypoint"]
