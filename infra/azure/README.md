# TokenShelf · Azure (Canada Central) — Deployment Runbook

End-to-end Bicep IaC for TokenShelf on Azure. Region: **Canada Central**
(Toronto). All data stays in Canadian sovereignty.

## Architecture at a glance

```
┌────────────────────────────────── Resource Group ──────────────────────────────────┐
│                                                                                     │
│  ┌──────────────────┐    ┌─────────────────────┐    ┌──────────────────────────┐   │
│  │ Container Apps   │◄──►│ Managed Identity    │───►│ Key Vault (HSM Premium)  │   │
│  │ Environment      │    │ (app + evaluator)   │    │  · receipt signing keys  │   │
│  │  · app           │    └─────────────────────┘    │  · engagement KEKs       │   │
│  │  · evaluator job │              │                └──────────────────────────┘   │
│  └──────┬───────────┘              │                                                │
│         │                          │                ┌──────────────────────────┐   │
│         │                          └────────────────┤ Container Registry (ACR) │   │
│         │                                           └──────────────────────────┘   │
│         │                                                                           │
│         │              ┌─────────────────────────────────────────┐                  │
│         ├──────────────┤ PostgreSQL Flexible Server              │                  │
│         │              │ · engagements, consents, scores         │                  │
│         │              │ · receipts (existing TokenShelf schema) │                  │
│         │              │ · RLS-enforced                          │                  │
│         │              └─────────────────────────────────────────┘                  │
│         │                                                                           │
│         │              ┌─────────────────────────────────────────┐                  │
│         ├──────────────┤ Cosmos DB (SQL API, serverless)         │                  │
│         │              │ · sessions · transparency entries        │                  │
│         │              │ · judge traces (90d TTL)                │                  │
│         │              └─────────────────────────────────────────┘                  │
│         │                                                                           │
│         │              ┌─────────────────────────────────────────┐                  │
│         └──────────────┤ Storage Account (Blob)                  │                  │
│                        │ · sealed-sessions · project-assets       │                  │
│                        │ · audit-anchors                         │                  │
│                        └─────────────────────────────────────────┘                  │
│                                                                                     │
│  ┌──────────────────────────────────────────────────────────────────────────────┐  │
│  │ Virtual Network (10.42.0.0/16)                                                │  │
│  │  · app subnet (delegated to Container Apps)                                   │  │
│  │  · data subnet (delegated to Postgres + service endpoints for KV/Storage/Cosmos) │
│  └──────────────────────────────────────────────────────────────────────────────┘  │
│                                                                                     │
│  ┌──────────────────────────────────────────────────────────────────────────────┐  │
│  │ Observability: Log Analytics workspace + Application Insights                 │  │
│  └──────────────────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────────────────┘
```

## Hexagonal mapping

Each Azure resource backs a specific port from the M4 architecture
(see [`../../plan/M4-a-team-module.md`](../../plan/M4-a-team-module.md)).

| M4 Port                | Azure adapter                                    |
| ---------------------- | ------------------------------------------------ |
| `BlobStore`            | Azure Blob Storage (`sealed-sessions` container) |
| `Kms`                  | Azure Key Vault Premium (HSM-backed)             |
| `ReceiptStore`         | Postgres Flexible Server (existing schema)       |
| `ConsentStore`         | Postgres Flexible Server (new `consent` table)   |
| `ScoreStore`           | Postgres Flexible Server (new `score` table)     |
| Session / event docs   | Cosmos DB SQL API (`sessions` container)         |
| Transparency log       | Cosmos DB (`transparency-entries` container)     |
| Judge traces (90d TTL) | Cosmos DB (`judge-traces` container)             |
| `IdentityProvider`     | Azure Entra ID (federated to Container App MI)   |
| Compute (web)          | Azure Container Apps (Consumption)               |
| Compute (evaluator)    | Container Apps Jobs (later, sandboxed)           |
| Observability          | Log Analytics + Application Insights             |

Adapters live in [`src/lib/m4/adapters/azure/`](../../src/lib/m4/adapters/)
(to be created in M4.0). Domain code remains framework- and
cloud-agnostic.

## File tree

```
infra/azure/
├── main.bicep                          # subscription-scope entry
├── main.parameters.dev.json
├── main.parameters.stg.json            # references KV-bootstrap secret
├── main.parameters.prod.json           # (create when going to prod)
└── modules/
    ├── network.bicep                   # VNet + subnets + PG private DNS
    ├── identity.bicep                  # user-assigned managed identities
    ├── observability.bicep             # Log Analytics + App Insights
    ├── keyvault.bicep                  # Premium KV + role assignments
    ├── storage.bicep                   # Blob account + 3 containers
    ├── cosmos.bicep                    # NoSQL account + 3 containers
    ├── postgres.bicep                  # Flexible Server (VNet-injected)
    ├── registry.bicep                  # ACR (Premium in prod)
    └── containerapp.bicep              # Managed environment + web app
```

## Prerequisites

1. **Azure CLI** ≥ 2.65: `brew install azure-cli` (already installed)
2. **Bicep CLI**: `az bicep install` (already installed)
3. **Docker** for building the app image
4. **Active Azure auth** in the target tenant:
   ```bash
   az login --tenant 12cf2055-17fd-48fc-bff0-a591d4b061fa
   az account set --subscription PRODUCER-STAGING
   ```

## Bootstrap (one-time, per subscription)

Create a tiny bootstrap resource group + key vault that holds the
Postgres admin password before the main deployment can reference it:

```bash
RG_BOOT=tks-bootstrap-rg
LOC=canadacentral
KV_BOOT=tks-bootstrap-kv-$RANDOM   # globally unique
PG_PASS=$(openssl rand -base64 32 | tr -d '=+/')

az group create -n $RG_BOOT -l $LOC

az keyvault create \
  -g $RG_BOOT -n $KV_BOOT -l $LOC \
  --enable-rbac-authorization true \
  --enabled-for-template-deployment true

OBJ=$(az ad signed-in-user show --query id -o tsv)
az role assignment create \
  --assignee-object-id $OBJ \
  --assignee-principal-type User \
  --role "Key Vault Secrets Officer" \
  --scope $(az keyvault show -n $KV_BOOT -g $RG_BOOT --query id -o tsv)

az keyvault secret set --vault-name $KV_BOOT --name tokenshelf-pg-admin-password --value "$PG_PASS"
```

Edit `main.parameters.stg.json` (and `.prod.json`) and replace
`<SUBSCRIPTION_ID>`, `<BOOTSTRAP_RG>`, `<BOOTSTRAP_KV>` with the
values above.

## Validate before deploy

```bash
az bicep build -f infra/azure/main.bicep              # syntax + types
az deployment sub validate \
  --location canadacentral \
  --template-file infra/azure/main.bicep \
  --parameters @infra/azure/main.parameters.stg.json  # against the actual API
az deployment sub what-if \
  --location canadacentral \
  --template-file infra/azure/main.bicep \
  --parameters @infra/azure/main.parameters.stg.json  # see exactly what will change
```

## Deploy

```bash
az deployment sub create \
  --name tokenshelf-stg-$(date +%Y%m%d%H%M) \
  --location canadacentral \
  --template-file infra/azure/main.bicep \
  --parameters @infra/azure/main.parameters.stg.json
```

Outputs include `containerAppFqdn`, `containerRegistryLoginServer`,
`postgresFqdn`, `keyVaultUri`, `blobAccountName`, and
`cosmosAccountEndpoint`. Save the JSON output for downstream scripts.

## Build & push the app image

```bash
ACR=$(az deployment sub show -n <deployment-name> \
  --query "properties.outputs.containerRegistryLoginServer.value" -o tsv)

# Option A: cloud build (faster, no local Docker needed)
az acr build -r ${ACR%%.*} -t tokenshelf-app:$(git rev-parse --short HEAD) .

# Option B: local build + push
docker build -t $ACR/tokenshelf-app:$(git rev-parse --short HEAD) .
az acr login -n ${ACR%%.*}
docker push $ACR/tokenshelf-app:$(git rev-parse --short HEAD)
```

Then update the Container App revision:

```bash
az containerapp update \
  -g tks-stg-rg -n tks-app-stg \
  --image $ACR/tokenshelf-app:$(git rev-parse --short HEAD)
```

## Apply Prisma schema

```bash
PG_FQDN=$(az deployment sub show -n <deployment-name> \
  --query "properties.outputs.postgresFqdn.value" -o tsv)

PG_PASS=$(az keyvault secret show \
  --vault-name $KV_BOOT --name tokenshelf-pg-admin-password \
  --query value -o tsv)

export DATABASE_URL="postgresql://tksadmin:${PG_PASS}@${PG_FQDN}:5432/tokenshelf?sslmode=require"
pnpm db:push    # apply schema (dev/stg)
# OR
pnpm db:migrate # versioned migration (prod)
```

## Verify health

```bash
APP=$(az deployment sub show -n <deployment-name> \
  --query "properties.outputs.containerAppFqdn.value" -o tsv)
curl -fsSL https://$APP/api/health
curl -fsSL https://$APP/.well-known/tokenshelf-verify.json
```

## Cost notes (Canada Central, starter tier — prod default)

The default Bicep parameters target the *cheapest defensible prod*:
scale-to-zero, single-zone, no HA, periodic backups. Production-grade
without traffic-driven cost.

| Resource                                | Idle (USD/mo) | Light traffic |
| --------------------------------------- | ------------- | ------------- |
| Container App Environment (Consumption) | ~$0 (scale-to-zero) | ~$15-30 |
| Postgres Flexible Server (Burstable B1ms, 32 GB, no HA) | ~$15-20 | ~$20-30 |
| Cosmos DB (serverless, single region, periodic backup) | ~$0 | ~$5-15 (per RU + storage) |
| Storage Account (LRS, low volume)       | ~$2           | ~$2-5         |
| Key Vault (Standard, RBAC)              | <$1           | <$1           |
| Container Registry (Basic)              | $5            | $5            |
| Log Analytics (30d retention)           | ~$2-5         | ~$10-20       |
| Application Insights (workspace-based)  | ~$0 (free tier) | ~$5-10      |
| **Total prod-starter**                  | **~$30-40 / mo** | **~$70-120 / mo** |

### Scale-up paths (no re-deploy needed)

When traffic, compliance, or M4 hardening justify the spend, scale
in-place via the Azure CLI — no Bicep change required.

| Lever | Command | Cost impact |
| --- | --- | --- |
| Bigger Postgres compute | `az postgres flexible-server update -g $RG -n $PG --sku-name Standard_B2ms` | +$15/mo per tier |
| Postgres HA (zone-redundant) | `az postgres flexible-server update -g $RG -n $PG --high-availability ZoneRedundant` | +~$30/mo |
| Postgres geo-redundant backup | `az postgres flexible-server update -g $RG -n $PG --geo-redundant-backup Enabled` | +~$10/mo |
| Postgres longer backup | `az postgres flexible-server update -g $RG -n $PG --backup-retention 35` | minor |
| Container App pinned warm | `az containerapp update -g $RG -n $APP --min-replicas 1` | +~$10-15/mo |
| Container App bigger replicas | `az containerapp update -g $RG -n $APP --cpu 1.0 --memory 2.0Gi` | doubles per-replica cost |
| Cosmos provisioned RU/s | Edit `cosmos.bicep` `serverlessCapacity=false` and re-deploy | depends on RU/s |
| Cosmos zone-redundant | Edit `cosmos.bicep` `zoneRedundant=true` and re-deploy | +30% |
| Storage zone-redundant | Edit `storage.bicep` `skuName=Standard_ZRS` and re-deploy | +25% storage cost |
| Key Vault Premium HSM | Edit `keyvault.bicep` `skuName=premium` and re-deploy | $1/key/mo |
| ACR Premium (private endpoints) | Edit `registry.bicep` `skuName=Premium` and re-deploy | +$20/mo |
| App Insights longer retention | `az monitor app-insights update --retention-days 90` | +per-GB |

### When to flip levers

- **Postgres HA**: any engagement that materially depends on uptime
- **Postgres geo-redundant backup**: regulatory/compliance ask
- **Container App min-replicas=1**: when cold-start latency
  (~1-2s on Consumption) is unacceptable for first request
- **Cosmos provisioned RU/s**: when steady-state RU usage > 1M RU/day
  (~$8/day vs serverless at $0.25/M-RU)
- **Key Vault Premium**: when M4.2 sealed-content encryption ships
  (engagement KEKs need HSM-grade)
- **ACR Premium**: when M4.6 supply-chain hardening lands (private
  endpoints + content trust)

## Teardown

```bash
az group delete -n tks-stg-rg --yes --no-wait
# Repeat for bootstrap RG if no longer needed
az group delete -n tks-bootstrap-rg --yes --no-wait
```

> Key Vault has **purge protection** enabled — a deleted vault enters
> soft-delete and cannot be removed until the retention period passes
> (7 days dev/stg, 90 days prod). Plan accordingly.

## Honest gaps

The auth token from `az account show` was cached but the refresh
token expired (90 days inactive); subsequent CLI calls require
`az login` again. The Bicep below was authored without contacting
the live ARM API for validation. Run the `az bicep build` +
`az deployment sub what-if` steps yourself once re-authenticated;
they're the safety net for schema or API drift since this file was
written.
