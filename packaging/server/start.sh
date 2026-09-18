#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
CONFIG_DIR=${LISSIO_CONFIG_DIR:-"$SCRIPT_DIR/data"}
mkdir -p "$CONFIG_DIR"
exec "$SCRIPT_DIR/lissio-server" --config-dir "$CONFIG_DIR" "$@"
