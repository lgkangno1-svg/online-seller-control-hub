#!/usr/bin/env bash
set -Eeuo pipefail
trap 'rc=$?; echo "Installer failed at line $LINENO: $BASH_COMMAND (exit $rc)" >&2; exit $rc' ERR

if [[ ${EUID:-$(id -u)} -ne 0 ]]; then
  echo 'Run this installer with sudo/root.' >&2
  exit 1
fi

RUNNER_ROOT='/opt/github-runners/lgkangno1-svg__online-seller-control-hub'
REQUEST_DIR="$RUNNER_ROOT/_deploy"
DEPLOY_ROOT='/opt/sellerhub-deployer'
ENV_DIR='/etc/sellerhub'
ENV_FILE="$ENV_DIR/sellerhub.env"
LEGACY_ENV='/etc/threads-revenue-os/sellerhub.env'

if [[ ! -d "$RUNNER_ROOT" ]]; then
  echo "Runner root not found: $RUNNER_ROOT" >&2
  echo 'Install/register the new repository self-hosted runner first, then rerun this installer.' >&2
  exit 1
fi

RUNNER_SERVICE=''
RUNNER_USER=''
RUNNER_GROUP=''
if [[ -f "$RUNNER_ROOT/.service" ]]; then
  RUNNER_SERVICE="$(tr -d '[:space:]' < "$RUNNER_ROOT/.service")"
fi
if [[ -n "$RUNNER_SERVICE" ]]; then
  RUNNER_USER="$(systemctl show -p User --value "$RUNNER_SERVICE" 2>/dev/null || true)"
  RUNNER_GROUP="$(systemctl show -p Group --value "$RUNNER_SERVICE" 2>/dev/null || true)"
fi
[[ -n "$RUNNER_USER" ]] || RUNNER_USER="$(stat -c '%U' "$RUNNER_ROOT")"
[[ -n "$RUNNER_GROUP" ]] || RUNNER_GROUP="$(id -gn "$RUNNER_USER" 2>/dev/null || true)"
id "$RUNNER_USER" >/dev/null 2>&1 || { echo "Unable to resolve runner user" >&2; exit 1; }

install -d -o root -g root -m 0755 "$DEPLOY_ROOT" "$DEPLOY_ROOT/releases" "$ENV_DIR"
mkdir -p "$REQUEST_DIR"
rm -f "$REQUEST_DIR/result.env" "$REQUEST_DIR/request.sha"
chown "$RUNNER_USER:$RUNNER_GROUP" "$REQUEST_DIR"
chmod 0750 "$REQUEST_DIR"

if [[ ! -f "$ENV_FILE" && -f "$LEGACY_ENV" ]]; then
  install -o root -g root -m 0600 "$LEGACY_ENV" "$ENV_FILE"
  echo "Migrated existing SellerHub environment from $LEGACY_ENV to $ENV_FILE"
fi

cat > /usr/local/sbin/sellerhub-handle-request <<'HANDLER'
#!/usr/bin/env bash
set -Eeuo pipefail
RUNNER_ROOT='/opt/github-runners/lgkangno1-svg__online-seller-control-hub'
REQUEST_DIR="$RUNNER_ROOT/_deploy"
REQUEST_FILE="$REQUEST_DIR/request.sha"
RESULT_FILE="$REQUEST_DIR/result.env"
WORKSPACE="$RUNNER_ROOT/_work/online-seller-control-hub/online-seller-control-hub"
DEPLOY_ROOT='/opt/sellerhub-deployer'
ENV_FILE='/etc/sellerhub/sellerhub.env'

[[ -f "$REQUEST_FILE" ]] || exit 0
SHA="$(tr -d '[:space:]' < "$REQUEST_FILE")"
rm -f "$REQUEST_FILE"

write_result() {
  local status="$1" message="$2" tmp
  tmp="$RESULT_FILE.tmp.$$"
  {
    printf 'sha=%s\n' "$SHA"
    printf 'status=%s\n' "$status"
    printf 'message=%q\n' "$message"
    printf 'finished_at=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  } > "$tmp"
  chown "$(stat -c '%U' "$REQUEST_DIR"):$(stat -c '%G' "$REQUEST_DIR")" "$tmp"
  chmod 0640 "$tmp"
  mv -f "$tmp" "$RESULT_FILE"
}

fail() { local msg="$1"; trap - ERR; write_result failure "$msg" || true; echo "$msg" >&2; exit 1; }
trap 'rc=$?; trap - ERR; write_result failure "Unexpected deployment error (exit $rc)" || true; exit $rc' ERR

[[ "$SHA" =~ ^[0-9a-f]{40}$ ]] || fail 'Deployment ref must be an exact 40-character lowercase commit SHA.'
[[ -f "$ENV_FILE" ]] || fail "SellerHub env file missing: $ENV_FILE"
[[ -d "$WORKSPACE/.git" ]] || fail "Runner checkout missing: $WORKSPACE"
git -c safe.directory="$WORKSPACE" -C "$WORKSPACE" cat-file -e "$SHA^{commit}" 2>/dev/null || fail "Requested commit is not present in runner checkout: $SHA"

exec 9>/run/lock/sellerhub-deploy.lock
flock -n 9 || fail 'Another SellerHub deployment is already running.'

RELEASE="$DEPLOY_ROOT/releases/$SHA"
rm -rf "$RELEASE"
install -d -o root -g root -m 0755 "$RELEASE"
git -c safe.directory="$WORKSPACE" -C "$WORKSPACE" archive --format=tar "$SHA" | tar -xf - -C "$RELEASE"
[[ -f "$RELEASE/ops/deploy_minipc.sh" ]] || fail 'ops/deploy_minipc.sh missing from requested commit.'

cd "$RELEASE"
SELLERHUB_ENV_FILE="$ENV_FILE" SELLERHUB_DEPLOY_REQUEST_DIR="$REQUEST_DIR" bash ops/deploy_minipc.sh

mapfile -t releases < <(find "$DEPLOY_ROOT/releases" -mindepth 1 -maxdepth 1 -type d -printf '%T@ %p\n' | sort -nr | awk '{print $2}')
if (( ${#releases[@]} > 3 )); then
  for old in "${releases[@]:3}"; do rm -rf "$old"; done
fi

write_result success 'SellerHub deployed and passed readiness checks.'
echo "SellerHub deployed: $SHA"
HANDLER
chmod 0755 /usr/local/sbin/sellerhub-handle-request
chown root:root /usr/local/sbin/sellerhub-handle-request

cat > /etc/systemd/system/sellerhub-deploy-request.service <<'UNIT'
[Unit]
Description=Handle a trusted SellerHub deployment request
After=network-online.target docker.service
Wants=network-online.target

[Service]
Type=oneshot
ExecStart=/usr/local/sbin/sellerhub-handle-request
UNIT

cat > /etc/systemd/system/sellerhub-deploy-request.path <<'UNIT'
[Unit]
Description=Watch for trusted SellerHub deployment requests

[Path]
PathChanged=/opt/github-runners/lgkangno1-svg__online-seller-control-hub/_deploy/request.sha
Unit=sellerhub-deploy-request.service

[Install]
WantedBy=multi-user.target
UNIT

systemctl daemon-reload
systemctl enable sellerhub-deploy-request.path >/dev/null
systemctl restart sellerhub-deploy-request.path

echo 'SellerHub secure deploy bridge installed.'
echo "Runner user: $RUNNER_USER"
echo "Request directory: $REQUEST_DIR"
