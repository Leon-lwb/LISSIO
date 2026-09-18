#!/bin/sh
set -eu

if [ -z "${LISSIO_TOKEN:-}" ]; then
  echo "LISSIO_TOKEN must be set for the container image" >&2
  exit 64
fi

mkdir -p /var/lib/lissio
exec /usr/local/bin/lissio-server \
  --bind 0.0.0.0 \
  --static-dir /opt/lissio/web \
  --config-dir /var/lib/lissio \
  "$@"
