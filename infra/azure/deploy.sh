#!/usr/bin/env bash
# TokenShelf · Azure deploy
#
# Provisions the full Azure stack in Canada Central, builds the
# container image in ACR, rolls out the Container App, and applies the
# Prisma schema. Idempotent — safe to re-run.
#
# Prereqs (run once):
#   az login --tenant 12cf2055-17fd-48fc-bff0-a591d4b061fa
#   az account set --subscription PRODUCER-STAGING
#   pnpm install
#
# Usage:
#   ./infra/azure/deploy.sh prod        # deploy prod env (default)
#   ./infra/azure/deploy.sh stg         # deploy staging
#   ./infra/azure/deploy.sh prod --skip-image    # skip image build
#   ./infra/azure/deploy.sh prod --skip-schema   # skip prisma migrate

set -euo pipefail

ENV="${1:-prod}"
shift || true
SKIP_IMAGE=false
SKIP_SCHEMA=false
AUTO_YES=false
for arg in "$@"; do
  case "$arg" in
    --skip-image)  SKIP_IMAGE=true ;;
    --skip-schema) SKIP_SCHEMA=true ;;
    --yes|-y)      AUTO_YES=true ;;
    *) echo "unknown flag: $arg"; exit 2 ;;
  esac
done

case "$ENV" in
  dev|stg|prod) ;;
  *) echo "env must be dev | stg | prod"; exit 2 ;;
esac

cd "$(dirname "$0")/../.."  # repo root

PARAM_FILE="infra/azure/main.parameters.${ENV}.json"
LOCATION="canadacentral"
PREFIX="tks"
RG="${PREFIX}-${ENV}-rg"
BOOTSTRAP_RG="${PREFIX}-bootstrap-rg"
BOOTSTRAP_KV_PREFIX="${PREFIX}-bootstrap-kv"
PG_SECRET_NAME="tokenshelf-pg-admin-password"
DEPLOYMENT_NAME="tokenshelf-${ENV}-$(date +%Y%m%d%H%M)"
TAG=$(git rev-parse --short HEAD 2>/dev/null || echo "local")

# ─── colour-coded log helpers ─────────────────────────────────────────
b()   { printf "\033[1m%s\033[0m\n" "$*"; }
ok()  { printf "\033[32m✓\033[0m %s\n" "$*"; }
warn(){ printf "\033[33m⚠\033[0m %s\n" "$*"; }
die() { printf "\033[31m✗\033[0m %s\n" "$*" >&2; exit 1; }

# ─── 1. preflight ─────────────────────────────────────────────────────
b "1/8 · preflight"
command -v az >/dev/null         || die "az CLI not installed"
command -v jq >/dev/null         || die "jq not installed (brew install jq)"
[[ -f "$PARAM_FILE" ]]           || die "missing $PARAM_FILE"
az account show --only-show-errors >/dev/null 2>&1 || die "run: az login"
SUB_ID=$(az account show --query id -o tsv)
SUB_NAME=$(az account show --query name -o tsv)
USER_ID=$(az ad signed-in-user show --query id -o tsv)
ok "subscription: $SUB_NAME ($SUB_ID)"
ok "user: $(az account show --query user.name -o tsv)"

# ─── 2. bootstrap KV (idempotent) ─────────────────────────────────────
b "2/8 · bootstrap key vault for postgres password"
az group show -n "$BOOTSTRAP_RG" >/dev/null 2>&1 || {
  az group create -n "$BOOTSTRAP_RG" -l "$LOCATION" >/dev/null
  ok "created $BOOTSTRAP_RG"
}
BOOTSTRAP_KV=$(az keyvault list -g "$BOOTSTRAP_RG" --query "[?starts_with(name, '${BOOTSTRAP_KV_PREFIX}')].name | [0]" -o tsv)
if [[ -z "$BOOTSTRAP_KV" ]]; then
  BOOTSTRAP_KV="${BOOTSTRAP_KV_PREFIX}-$RANDOM"
  az keyvault create -g "$BOOTSTRAP_RG" -n "$BOOTSTRAP_KV" -l "$LOCATION" \
    --enable-rbac-authorization true \
    --enabled-for-template-deployment true \
    --only-show-errors >/dev/null
  ok "created $BOOTSTRAP_KV"
else
  ok "found $BOOTSTRAP_KV"
fi
KV_ID=$(az keyvault show -n "$BOOTSTRAP_KV" -g "$BOOTSTRAP_RG" --query id -o tsv)
az role assignment create \
  --assignee-object-id "$USER_ID" \
  --assignee-principal-type User \
  --role "Key Vault Secrets Officer" \
  --scope "$KV_ID" \
  --only-show-errors 2>/dev/null || true

# Retry secret operations — RBAC propagation can take ~30-60s after grant.
kv_set_with_retry() {
  local name="$1" value="$2"
  for i in 1 2 3 4 5 6 7 8 9 10 11 12; do
    if az keyvault secret set --vault-name "$BOOTSTRAP_KV" --name "$name" --value "$value" --only-show-errors >/dev/null 2>&1; then
      return 0
    fi
    printf "  RBAC propagation, retry %d/12...\n" "$i"
    sleep 6
  done
  return 1
}
kv_get_check() {
  az keyvault secret show --vault-name "$BOOTSTRAP_KV" --name "$1" >/dev/null 2>&1
}
# Wait until the RBAC grant is usable (read probe). Up to 90s.
for i in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15; do
  if az keyvault secret list --vault-name "$BOOTSTRAP_KV" --only-show-errors >/dev/null 2>&1; then
    break
  fi
  printf "  waiting for KV RBAC grant to propagate (%ds)...\n" "$((i * 6))"
  sleep 6
done

if ! kv_get_check "$PG_SECRET_NAME"; then
  PG_PASS=$(openssl rand -base64 32 | tr -d '=+/' | head -c 32)
  kv_set_with_retry "$PG_SECRET_NAME" "$PG_PASS" \
    || die "could not write $PG_SECRET_NAME after retries — RBAC may need manual investigation"
  ok "generated and stored $PG_SECRET_NAME"
else
  ok "$PG_SECRET_NAME already set"
fi

# ─── 3. patch the parameters file with the resolved KV id ─────────────
b "3/8 · patch $PARAM_FILE with bootstrap KV id"
TMP_PARAM=$(mktemp)
jq --arg id "$KV_ID" '
  .parameters.postgresAdminPassword.reference.keyVault.id = $id
' "$PARAM_FILE" > "$TMP_PARAM"
ok "parameters resolved"

# ─── 4. validate + what-if ────────────────────────────────────────────
b "4/8 · validate"
az deployment sub validate \
  --location "$LOCATION" \
  --template-file infra/azure/main.bicep \
  --parameters "@$TMP_PARAM" \
  --only-show-errors >/dev/null && ok "template valid"

b "    what-if (preview changes)"
az deployment sub what-if \
  --location "$LOCATION" \
  --template-file infra/azure/main.bicep \
  --parameters "@$TMP_PARAM" \
  --result-format ResourceIdOnly \
  || warn "what-if produced warnings (continuing)"

if [[ "$AUTO_YES" == true ]]; then
  ok "--yes set, skipping confirm prompt"
else
  read -r -p "Proceed with deployment? [y/N] " ack
  [[ "$ack" =~ ^[Yy]$ ]] || die "aborted by user"
fi

# ─── 5. deploy ────────────────────────────────────────────────────────
b "5/8 · deploy $DEPLOYMENT_NAME"
az deployment sub create \
  --name "$DEPLOYMENT_NAME" \
  --location "$LOCATION" \
  --template-file infra/azure/main.bicep \
  --parameters "@$TMP_PARAM" \
  --only-show-errors
ok "deployment complete"

OUTS=$(az deployment sub show -n "$DEPLOYMENT_NAME" --query properties.outputs -o json)
ACR=$(echo "$OUTS" | jq -r '.containerRegistryLoginServer.value')
APP_FQDN=$(echo "$OUTS" | jq -r '.containerAppFqdn.value')
PG_FQDN=$(echo "$OUTS" | jq -r '.postgresFqdn.value')

# ─── 6. build + push image ────────────────────────────────────────────
if [[ "$SKIP_IMAGE" != true ]]; then
  b "6/8 · build image $ACR/tokenshelf-app:$TAG (cloud build)"
  az acr build -r "${ACR%%.*}" -t "tokenshelf-app:$TAG" -t "tokenshelf-app:latest" .
  ok "image pushed"

  b "    rolling out new revision"
  az containerapp update -g "$RG" -n "${PREFIX}-app-${ENV}" \
    --image "$ACR/tokenshelf-app:$TAG" \
    --only-show-errors >/dev/null
  ok "revision rolled out"
else
  warn "skipping image build (--skip-image)"
fi

# ─── 7. apply prisma schema ───────────────────────────────────────────
if [[ "$SKIP_SCHEMA" != true ]]; then
  b "7/8 · apply prisma schema"
  PG_PASS=$(az keyvault secret show --vault-name "$BOOTSTRAP_KV" --name "$PG_SECRET_NAME" --query value -o tsv)
  export DATABASE_URL="postgresql://tksadmin:${PG_PASS}@${PG_FQDN}:5432/tokenshelf?sslmode=require"

  # Ensure prisma client is generated locally before any schema operation
  if [[ ! -d node_modules/.prisma/client ]]; then
    pnpm prisma generate >/dev/null
  fi

  # Use db push (no migration history needed). When the project adopts
  # versioned migrations, switch this to `prisma migrate deploy` per env.
  if [[ -d prisma/migrations ]]; then
    pnpm prisma migrate deploy
  else
    pnpm prisma db push --accept-data-loss
  fi
  ok "schema applied"
else
  warn "skipping schema (--skip-schema)"
fi

# ─── 8. health check ──────────────────────────────────────────────────
b "8/8 · health check"
for i in $(seq 1 30); do
  if curl -fsSL "https://${APP_FQDN}/api/health" >/dev/null 2>&1; then
    ok "https://${APP_FQDN}/api/health → 200"
    curl -fsSL "https://${APP_FQDN}/api/health" | jq .
    break
  fi
  printf "."
  sleep 2
done

b "done"
echo "  App:      https://${APP_FQDN}"
echo "  Verifier: https://${APP_FQDN}/.well-known/tokenshelf-verify.json"
echo "  Postgres: ${PG_FQDN}"
echo "  ACR:      ${ACR}"
echo
echo "  Logs:     az containerapp logs show -g $RG -n ${PREFIX}-app-${ENV} --follow"
echo "  Revisions: az containerapp revision list -g $RG -n ${PREFIX}-app-${ENV} -o table"

rm -f "$TMP_PARAM"
