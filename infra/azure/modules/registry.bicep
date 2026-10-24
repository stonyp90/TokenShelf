// Azure Container Registry — Premium for private endpoint + scoped tokens

@minLength(3)
@maxLength(6)
param prefix string

@allowed([ 'dev', 'stg', 'prod' ])
param env string

param location string
param tags object
param appIdentityPrincipalId string

@description('Premium needed for content trust + private endpoints in prod. Basic acceptable for dev.')
@allowed([ 'Basic', 'Standard', 'Premium' ])
param skuName string = (env == 'prod') ? 'Premium' : 'Basic'

// AcrPull built-in role (tenant-scoped path)
var acrPullRoleDef = tenantResourceId('Microsoft.Authorization/roleDefinitions', '7f951dda-4ed3-4680-a7ca-43fe172d538d')

var registryName = toLower('${prefix}acr${env}${uniqueString(subscription().subscriptionId, env)}')

resource registry 'Microsoft.ContainerRegistry/registries@2025-05-01-preview' = {
  name: substring(registryName, 0, min(length(registryName), 50))
  location: location
  tags: tags
  sku: { name: skuName }
  properties: {
    adminUserEnabled: false
    publicNetworkAccess: 'Enabled'
    zoneRedundancy: (env == 'prod') ? 'Enabled' : 'Disabled'
    networkRuleBypassOptions: 'AzureServices'
  }
}

resource appAcrPull 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  scope: registry
  name: guid(registry.id, appIdentityPrincipalId, acrPullRoleDef)
  properties: {
    roleDefinitionId: acrPullRoleDef
    principalId: appIdentityPrincipalId
    principalType: 'ServicePrincipal'
  }
}

output loginServer string = registry.properties.loginServer
output registryName string = registry.name
output registryId string = registry.id
