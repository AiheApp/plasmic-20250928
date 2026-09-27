#!/usr/bin/env bash

cmd=${1:-dev}
port=${PORT:-3003}

source "$(dirname "${BASH_SOURCE[0]}")/host-url.bash"
# Self-hosted deployments pass the canvas host origin via DEFAULT_HOST_URL.
if [[ -z $REACT_APP_DEV_HOST_PROXY && -z $REACT_APP_DEV_PROXY && $DEFAULT_HOST_URL ]]; then
  HOST_URL=${DEFAULT_HOST_URL}static/host.html
fi
HOST_URL_DEFAULT=$HOST_URL

# Respect existing PUBLIC_URL if set
PUBLIC_URL_VALUE=${PUBLIC_URL:-${REACT_APP_DEV_PROXY:-http://localhost:$port}}
REACT_APP_PUBLIC_URL_VALUE=${REACT_APP_PUBLIC_URL:-$PUBLIC_URL_VALUE}
REACT_APP_DEFAULT_HOST_URL_VALUE=${REACT_APP_DEFAULT_HOST_URL:-$HOST_URL_DEFAULT}

REACT_APP_DEFAULT_HOST_URL=${REACT_APP_DEFAULT_HOST_URL_VALUE} \
  REACT_APP_PUBLIC_URL=${REACT_APP_PUBLIC_URL_VALUE} \
  PUBLIC_URL=${PUBLIC_URL_VALUE} \
  PORT=$port \
  NODE_OPTIONS="--max-old-space-size=16384" \
  pnpm rsbuild $cmd
