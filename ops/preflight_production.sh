#!/usr/bin/env bash
set -euo pipefail

ENV_SOURCE="${SELLERHUB_ENV_FILE:-/etc/sellerhub/sellerhub.env}"
EXPECTED_PUBLIC_URL="${SELLERHUB_PUBLIC_URL:-https://seller.avocadoss.co.kr}"

fail() {
  echo "ERROR: $*" >&2
  exit 1
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || fail "required command not found: $1"
}

require_command docker
require_command curl

[[ -f "$ENV_SOURCE" ]] || fail "SellerHub production env file not found: $ENV_SOURCE"
[[ ! -L "$ENV_SOURCE" ]] || fail "SellerHub production env file must not be a symlink: $ENV_SOURCE"

set -a
# shellcheck disable=SC1090
source "$ENV_SOURCE"
set +a

[[ "${WEB_ENABLED:-true}" == "true" ]] || fail "WEB_ENABLED must be true in production"
[[ "${WEB_PORT:-8787}" == "8787" ]] || fail "WEB_PORT must remain 8787 for the production compose mapping"
[[ -n "${MARKET_CREDENTIALS_KEY:-}" ]] || fail "MARKET_CREDENTIALS_KEY is required"
[[ "${PUBLIC_BASE_URL:-$EXPECTED_PUBLIC_URL}" == "$EXPECTED_PUBLIC_URL" ]] || fail "PUBLIC_BASE_URL must be $EXPECTED_PUBLIC_URL"

if [[ "${DRY_RUN:-true}" != "true" ]]; then
  [[ -n "${LIVE_MARKETS:-}" ]] || fail "LIVE_MARKETS must be explicit when DRY_RUN=false"
fi

if [[ "${PRODUCT_REGISTRATION_ENABLED:-false}" == "true" && "${DRY_RUN:-true}" == "true" ]]; then
  echo "[preflight] product registration is enabled while command execution remains DRY_RUN=true"
fi

tmp_env="$(mktemp)"
trap 'rm -f "$tmp_env"' EXIT
cp "$ENV_SOURCE" "$tmp_env"
chmod 0600 "$tmp_env"

SELLERHUB_ENV_FILE="$ENV_SOURCE" SELLERHUB_DATA_DIR="${SELLERHUB_DATA_DIR:-/var/lib/sellerhub}" \
  docker compose --env-file "$tmp_env" -f docker-compose.production.yml config >/dev/null

echo "[preflight] SellerHub production configuration passed fail-closed checks"
