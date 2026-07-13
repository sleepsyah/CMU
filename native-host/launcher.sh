#!/bin/sh
set -eu
SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
ROOT_DIR=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)
NODE_BINARY=${ELLIPSIS_NODE_PATH:-$(command -v node || true)}
if [ -z "$NODE_BINARY" ]; then
  for candidate in /opt/homebrew/bin/node /opt/homebrew/opt/node*/bin/node /usr/local/bin/node /usr/local/opt/node*/bin/node /usr/bin/node; do
    if [ -x "$candidate" ]; then
      NODE_BINARY=$candidate
      break
    fi
  done
fi
if [ -z "$NODE_BINARY" ]; then
  echo "Ellipsis AI Connector could not find its Node runtime." >&2
  exit 127
fi
exec "$NODE_BINARY" "$ROOT_DIR/native-host/host.mjs" "$@"
