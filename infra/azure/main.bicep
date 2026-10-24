// TokenShelf · Azure infrastructure — entry point
//
// Scope: subscription. Deploys the resource group + all module resources.
// Region: Canada Central (Toronto) by default — pick canadaeast if you
// need a Quebec-City presence.
//
// Deploy:
//   az login --tenant <tenant-id>
//   az account set --subscription <subscription-id>
//   az deployment sub create \
//     --name tokenshelf-${ENV} \
//     --location canadacentral \
//     --template-file infra/azure/main.bicep \
//     --parameters @infra/azure/main.parameters.${ENV}.json

targetScope = 'subscription'

// ────────────────────────────── parameters ─────────────────────────────

@description('Environment slug. Drives naming + tagging.')
@allowed([ 'dev', 'stg', 'prod' ])
param env string

@description('Azure region. Default: Canada Central (Toronto).')
@allowed([ 'canadacentral', 'canadaeast' ])
param location string = 'canadacentral'

@description('Short product prefix used in resource names.')
@minLength(3)
@maxLength(6)
param prefix string = 'tks'

@description('Postgres administrator login. Stored in Key Vault; do not commit.')
@secure()
param postgresAdminPassword string

@description('Email for resource owner tag (cost attribution + ops).')
param ownerEmail string

@description('Container image tag for the Next.js app. Push to ACR before deploying.')
param appImageTag string = 'latest'

@description('Optional custom domain to bind to the Container App.')
param customDomain string = ''

// ────────────────────────────── derived ────────────────────────────────

var resourceGroupName = '${prefix}-${env}-rg'
var commonTags = {
  product: 'TokenShelf'
  env: env
  owner: ownerEmail
  managedBy: 'bicep'
  costCenter: 'tokenshelf-${env}'
}

// ────────────────────────────── resource group ─────────────────────────

resource rg 'Microsoft.Resources/resourceGroups@2024-11-01' = {
  name: resourceGroupName
  location: location
  tags: commonTags
}

// ────────────────────────────── modules ────────────────────────────────

module observability 'modules/observability.bicep' = {
  scope: rg
  name: 'observability'
  params: {
    prefix: prefix
    env: env
    location: location
    tags: commonTags
  }
}

module network 'modules/network.bicep' = {
  scope: rg
  name: 'network'
  params: {
    prefix: prefix
    env: env
    location: location
    tags: commonTags
  }
}

module identity 'modules/identity.bicep' = {
  scope: rg
  name: 'identity'
  params: {
    prefix: prefix
    env: env
    location: location
    tags: commonTags
  }
}

module keyvault 'modules/keyvault.bicep' = {
  scope: rg
  name: 'keyvault'
  params: {
    prefix: prefix
    env: env
    location: location
    tags: commonTags
    tenantId: subscription().tenantId
    appIdentityPrincipalId: identity.outputs.appIdentityPrincipalId
    evaluatorIdentityPrincipalId: identity.outputs.evaluatorIdentityPrincipalId
    subnetId: network.outputs.dataSubnetId
  }
}

module storage 'modules/storage.bicep' = {
  scope: rg
  name: 'storage'
  params: {
    prefix: prefix
    env: env
    location: location
    tags: commonTags
    appIdentityPrincipalId: identity.outputs.appIdentityPrincipalId
    evaluatorIdentityPrincipalId: identity.outputs.evaluatorIdentityPrincipalId
    subnetId: network.outputs.dataSubnetId
  }
}

module cosmos 'modules/cosmos.bicep' = {
  scope: rg
  name: 'cosmos'
  params: {
    prefix: prefix
    env: env
    location: location
    tags: commonTags
    appIdentityPrincipalId: identity.outputs.appIdentityPrincipalId
    subnetId: network.outputs.dataSubnetId
  }
}

module postgres 'modules/postgres.bicep' = {
  scope: rg
  name: 'postgres'
  params: {
    prefix: prefix
    env: env
    location: location
    tags: commonTags
    administratorLogin: 'tksadmin'
    administratorLoginPassword: postgresAdminPassword
    subnetId: network.outputs.dataSubnetId
    privateDnsZoneArmResourceId: network.outputs.postgresPrivateDnsZoneId
    logAnalyticsWorkspaceId: observability.outputs.logAnalyticsWorkspaceId
  }
}

module registry 'modules/registry.bicep' = {
  scope: rg
  name: 'registry'
  params: {
    prefix: prefix
    env: env
    location: location
    tags: commonTags
    appIdentityPrincipalId: identity.outputs.appIdentityPrincipalId
  }
}

module containerapp 'modules/containerapp.bicep' = {
  scope: rg
  name: 'containerapp'
  params: {
    prefix: prefix
    env: env
    location: location
    tags: commonTags
    appIdentityId: identity.outputs.appIdentityId
    appIdentityClientId: identity.outputs.appIdentityClientId
    evaluatorIdentityId: identity.outputs.evaluatorIdentityId
    appSubnetId: network.outputs.appSubnetId
    logAnalyticsWorkspaceId: observability.outputs.logAnalyticsWorkspaceId
    logAnalyticsSharedKey: observability.outputs.logAnalyticsSharedKey
    applicationInsightsConnectionString: observability.outputs.applicationInsightsConnectionString
    containerRegistryServer: registry.outputs.loginServer
    appImageTag: appImageTag
    postgresFqdn: postgres.outputs.fqdn
    postgresDatabase: postgres.outputs.databaseName
    keyVaultUri: keyvault.outputs.vaultUri
    blobAccountName: storage.outputs.accountName
    cosmosAccountName: cosmos.outputs.accountName
    customDomain: customDomain
  }
}

// ────────────────────────────── outputs ────────────────────────────────

output resourceGroupName string = rg.name
output containerAppFqdn string = containerapp.outputs.appFqdn
output containerRegistryLoginServer string = registry.outputs.loginServer
output postgresFqdn string = postgres.outputs.fqdn
output keyVaultUri string = keyvault.outputs.vaultUri
output blobAccountName string = storage.outputs.accountName
output cosmosAccountEndpoint string = cosmos.outputs.endpoint
output applicationInsightsConnectionString string = observability.outputs.applicationInsightsConnectionString
