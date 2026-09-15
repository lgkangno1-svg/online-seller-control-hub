#!/usr/bin/env bash
set -Eeuo pipefail

ENV_SOURCE="${SELLERHUB_ENV_FILE:-/etc/sellerhub/sellerhub.env}"
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "${SCRIPT_DIR}/.." && pwd)"
SELLERHUB_DATA_DIR="${SELLERHUB_DATA_DIR:-/var/lib/sellerhub}"
SELLERHUB_HOSTNAME="${SELLERHUB_HOSTNAME:-seller.avocadoss.co.kr}"
SELLERHUB_LOCAL_URL="http://127.0.0.1:8787"
SELLERHUB_PUBLIC_URL="https://${SELLERHUB_HOSTNAME}"
DEPLOY_REQUEST_DIR="${SELLERHUB_DEPLOY_REQUEST_DIR:-/opt/github-runners/lgkangno1-svg__online-seller-control-hub/_deploy}"
SELLERHUB_STATUS_FILE="$DEPLOY_REQUEST_DIR/sellerhub-access.env"
SELLERHUB_ADMIN_BOOTSTRAP_FILE="$DEPLOY_REQUEST_DIR/sellerhub-admin-bootstrap.env"
DEPLOY_STAGE_FILE="$DEPLOY_REQUEST_DIR/deploy-stage.env"
DEPLOY_STAGE="initializing"

write_deploy_stage() {
  local status="$1" stage="$2" tmp
  mkdir -p "$DEPLOY_REQUEST_DIR"
  tmp="${DEPLOY_STAGE_FILE}.tmp.$$"
  {
    printf 'status=%q\n' "$status"
    printf 'stage=%q\n' "$stage"
    printf 'updated_at=%q\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  } > "$tmp"
  chmod 0640 "$tmp" 2>/dev/null || true
  mv -f "$tmp" "$DEPLOY_STAGE_FILE"
}

set_deploy_stage() {
  DEPLOY_STAGE="$1"
  write_deploy_stage running "$DEPLOY_STAGE"
  echo "[deploy] stage: $DEPLOY_STAGE"
}

record_deploy_failure() {
  local rc=$?
  trap - ERR
  write_deploy_stage failure "$DEPLOY_STAGE" || true
  exit "$rc"
}
trap record_deploy_failure ERR

write_sellerhub_status() {
  local state="$1" message="$2" tmp
  mkdir -p "$DEPLOY_REQUEST_DIR"
  tmp="${SELLERHUB_STATUS_FILE}.tmp.$$"
  {
    printf 'state=%q\n' "$state"
    printf 'url=%q\n' "$SELLERHUB_PUBLIC_URL"
    printf 'message=%q\n' "$message"
    printf 'updated_at=%q\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  } > "$tmp"
  chmod 0640 "$tmp" 2>/dev/null || true
  mv -f "$tmp" "$SELLERHUB_STATUS_FILE"
}

bootstrap_sellerhub_admin() {
  if [[ ! -f "$SELLERHUB_ADMIN_BOOTSTRAP_FILE" ]]; then
    echo "[deploy] no SellerHub admin bootstrap staged; preserving existing admin account"
    return 0
  fi

  local SELLERHUB_ADMIN_USERNAME="" SELLERHUB_ADMIN_PASSWORD=""
  # shellcheck disable=SC1090
  source "$SELLERHUB_ADMIN_BOOTSTRAP_FILE"
  if [[ -z "$SELLERHUB_ADMIN_USERNAME" || -z "$SELLERHUB_ADMIN_PASSWORD" ]]; then
    rm -f "$SELLERHUB_ADMIN_BOOTSTRAP_FILE"
    echo "ERROR: staged SellerHub admin bootstrap is incomplete" >&2
    return 1
  fi

  echo "[deploy] securely bootstrapping SellerHub administrator"
  (
    cd "$REPO_ROOT"
    export SELLERHUB_ENV_FILE="$ENV_SOURCE" SELLERHUB_DATA_DIR
    COMPOSE_PROJECT_NAME=sellerhub docker compose -f docker-compose.production.yml run --rm --no-deps \
      -e SELLERHUB_ADMIN_USERNAME="$SELLERHUB_ADMIN_USERNAME" \
      -e SELLERHUB_ADMIN_PASSWORD="$SELLERHUB_ADMIN_PASSWORD" \
      sellerhub node --import tsx src/scripts/bootstrapAdmin.ts
  )

  unset SELLERHUB_ADMIN_PASSWORD
  if command -v shred >/dev/null 2>&1; then
    shred -u "$SELLERHUB_ADMIN_BOOTSTRAP_FILE" 2>/dev/null || rm -f "$SELLERHUB_ADMIN_BOOTSTRAP_FILE"
  else
    rm -f "$SELLERHUB_ADMIN_BOOTSTRAP_FILE"
  fi

  (
    cd "$REPO_ROOT"
    export SELLERHUB_ENV_FILE="$ENV_SOURCE" SELLERHUB_DATA_DIR
    COMPOSE_PROJECT_NAME=sellerhub docker compose -f docker-compose.production.yml restart sellerhub
  )
}

write_deploy_stage running "$DEPLOY_STAGE"
[[ -f "$ENV_SOURCE" ]] || {
  echo "ERROR: SellerHub production env file not found: $ENV_SOURCE" >&2
  write_deploy_stage failure production-env-check
  exit 1
}

cd "$REPO_ROOT"

set_deploy_stage "production-preflight"
SELLERHUB_ENV_FILE="$ENV_SOURCE" SELLERHUB_DATA_DIR="$SELLERHUB_DATA_DIR" bash ops/preflight_production.sh

install -d -o 1000 -g 1000 -m 0750 "$SELLERHUB_DATA_DIR"
export SELLERHUB_ENV_FILE="$ENV_SOURCE" SELLERHUB_DATA_DIR

set_deploy_stage "compose-validate"
COMPOSE_PROJECT_NAME=sellerhub docker compose -f docker-compose.production.yml config --quiet

set_deploy_stage "image-build"
COMPOSE_PROJECT_NAME=sellerhub docker compose -f docker-compose.production.yml build sellerhub

set_deploy_stage "container-start"
COMPOSE_PROJECT_NAME=sellerhub docker compose -f docker-compose.production.yml up -d --no-build --remove-orphans sellerhub

set_deploy_stage "local-health"
sellerhub_ready=false
for attempt in $(seq 1 40); do
  if curl --fail --silent --max-time 3 "$SELLERHUB_LOCAL_URL/api/health" >/dev/null; then
    sellerhub_ready=true
    break
  fi
  sleep 2
done
if [[ "$sellerhub_ready" != true ]]; then
  COMPOSE_PROJECT_NAME=sellerhub docker compose -f docker-compose.production.yml logs --tail=160 sellerhub >&2 || true
  write_sellerhub_status failure "SellerHub local health check failed"
  write_deploy_stage failure "$DEPLOY_STAGE"
  exit 1
fi

set_deploy_stage "admin-bootstrap"
bootstrap_sellerhub_admin
rm -f "$SELLERHUB_ADMIN_BOOTSTRAP_FILE" 2>/dev/null || true

set_deploy_stage "post-bootstrap-health"
sellerhub_ready=false
for attempt in $(seq 1 30); do
  if curl --fail --silent --max-time 3 "$SELLERHUB_LOCAL_URL/api/health" >/dev/null; then
    sellerhub_ready=true
    break
  fi
  sleep 2
done
if [[ "$sellerhub_ready" != true ]]; then
  write_sellerhub_status failure "SellerHub failed to recover after administrator bootstrap"
  write_deploy_stage failure "$DEPLOY_STAGE"
  exit 1
fi

set_deploy_stage "public-health"
if systemctl is-active --quiet cloudflared 2>/dev/null; then
  public_ready=false
  for attempt in $(seq 1 30); do
    if curl --fail --silent --max-time 5 "$SELLERHUB_PUBLIC_URL/api/health" >/dev/null; then
      public_ready=true
      break
    fi
    sleep 2
  done
  if [[ "$public_ready" == true ]]; then
    write_sellerhub_status success "SellerHub deployed and public HTTPS health passed"
  else
    write_sellerhub_status partial "SellerHub is healthy locally, but public HTTPS verification failed"
  fi
else
  write_sellerhub_status partial "SellerHub is healthy locally; cloudflared is not active"
fi

set_deploy_stage "complete"
write_deploy_stage success complete
echo "[deploy] SellerHub deployment complete"
COMPOSE_PROJECT_NAME=sellerhub docker compose -f docker-compose.production.yml ps
