#!/usr/bin/env bash
#
# Production startup for the self-hosted wab AIO image.
#
# Unlike tools/dev.bash (which runs the rsbuild dev server + six file watchers +
# the backend == 9 long-lived processes), this serves the *pre-built* studio
# bundle and runs only two lightweight processes and no watchers/bundler:
#
#   - backend  : the API + socket.io server (src/wab/server/main.ts) on :3004
#   - frontend : a static SPA server for platform/wab/build on :3003
#
# Routing note: the studio calls its API same-origin under /api, and the
# socket.io websocket connects at /api/v1/socket (see src/wab/client/api.ts).
# Traefik routes PathPrefix(`/api`) -> :3004 and everything else -> :3003, so
# the static server never needs to proxy the API and websockets work natively.
#
# The DB URLs (REACT_APP_PUBLIC_URL / REACT_APP_DEFAULT_HOST_URL / PUBLIC_URL /
# HOST_URL) are provided by the compose environment. We export the values the
# server reads directly instead of going through tools/backend-server.bash,
# which hardcodes dev defaults (localhost:3005 host, localhost:3003 codegen).

set -eo pipefail

cd /plasmic/platform/wab

git config --global --add safe.directory /plasmic || true

# Point ormconfig at the configured DB (e.g. Supabase pooler) WITH SSL, matching
# the sample/dev startup. Covers both the migration CLI and the runtime server.
cp ormconfig.json /tmp/ormconfig.json
jq '(.host = env.DB_HOST)
    | (.port = (env.DB_PORT | tonumber))
    | (.username = env.DB_USER)
    | (.database = env.DB_NAME)
    | (.password = env.DB_PASSWORD)
    | (.ssl = {"rejectUnauthorized": false})' \
  /tmp/ormconfig.json > /tmp/ormconfig-new.json
cp /tmp/ormconfig-new.json ormconfig.json

# Schema migration + one-time seed (maybe-seed.sh is idempotent: seeds only if
# the DB has no users).
yarn typeorm migration:run
bash /plasmic/platform/wab/tools/docker-dev/maybe-seed.sh

# --- Runtime env for the backend (prod values, not backend-server.bash dev defaults) ---
export NODE_ENV=production
export MAX_HEAP_SIZE="${MAX_HEAP_SIZE:-2048}"
export REACT_APP_PUBLIC_URL="${PUBLIC_URL}"
export REACT_APP_DEFAULT_HOST_URL="${DEFAULT_HOST_URL:-${HOST_URL}}"
export CODEGEN_HOST="${PUBLIC_URL}"
export SITE_ASSETS_BUCKET="${SITE_ASSETS_BUCKET:-plasmic-site-assets}"
export SITE_ASSETS_BASE_URL="${SITE_ASSETS_BASE_URL:-https://site-assets.plasmic.app/}"
export DISABLE_BWRAP=1

# The canvas host (e.g. canvas.aihe.dev) loads Studio's JS/CSS bundles cross-origin
# into the host iframe, so the Studio static assets must be served with CORS. Write
# a serve.json with Access-Control-Allow-Origin:* and an SPA rewrite (so deep links
# like /projects/<id> still resolve to index.html regardless of how `serve` merges
# the -s flag with serve.json). Static assets are public; the API is a separate port.
cat > /plasmic/platform/wab/build/serve.json <<'JSON'
{
  "rewrites": [{ "source": "**", "destination": "/index.html" }],
  "headers": [
    {
      "source": "**/*",
      "headers": [{ "key": "Access-Control-Allow-Origin", "value": "*" }]
    },
    {
      "comment": "Non-hashed entry + loaders keep their filename across builds but their content (and the hashed-chunk URLs they reference) changes, so they must always revalidate or browsers/Cloudflare serve a stale app that points at deleted chunks. Content-hashed chunks are left to default (immutable by nature) caching.",
      "source": "**/*.html",
      "headers": [{ "key": "Cache-Control", "value": "no-cache" }]
    },
    { "source": "**/*.worker.js", "headers": [{ "key": "Cache-Control", "value": "no-cache" }] },
    { "source": "**/*.template", "headers": [{ "key": "Cache-Control", "value": "no-cache" }] },
    { "source": "**/studio.js", "headers": [{ "key": "Cache-Control", "value": "no-cache" }] },
    { "source": "**/studio.dev.js", "headers": [{ "key": "Cache-Control", "value": "no-cache" }] },
    { "source": "**/getlibs.js", "headers": [{ "key": "Cache-Control", "value": "no-cache" }] },
    { "source": "**/preamble.js", "headers": [{ "key": "Cache-Control", "value": "no-cache" }] },
    { "source": "**/loader-hydrate.js", "headers": [{ "key": "Cache-Control", "value": "no-cache" }] }
  ]
}
JSON

# Two processes, no watchers. --kill-others-on-fail makes the container exit (and
# Coolify restart it) if either dies, instead of limping along half-up.
exec yarn concurrently --kill-others-on-fail --names backend,frontend \
  "bash tools/run.bash src/wab/server/main.ts" \
  "serve -s /plasmic/platform/wab/build -l 3003"
