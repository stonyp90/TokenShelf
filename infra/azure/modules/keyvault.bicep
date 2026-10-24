// Key Vault: HSM-backed (Premium SKU) for KMS + receipt signing material

@minLength(3)
@maxLength(6)
param prefix string

@allowed([ 'dev', 'stg', 'prod' ])
param env string

param location string
param tags object
param tenantId string
param appIdentityPrincipalId string
param evaluatorIdentityPrincipalId string
param subnetId string

@description('Premium = HSM-backed key support. Required for production engagement KEKs.')
@allowed([ 'standard', 'premium' ])
param skuName string = (env == 'prod') ? 'premium' : 'standard'

// Built-in role definitions (data plane RBAC). Tenant-scoped paths
// resolve reliably even on fresh subscriptions where the role catalog
// hasn't propagated to the subscription scope yet.
var keyVaultSecretsUserRoleDef = tenantResourceId('Microsoft.Authorization/roleDefinitions', '4633458b-17de-457d-8c8e-3fe7df93d40e')
var keyVaultCryptoUserRoleDef  = tenantResourceId('Microsoft.Authorization/roleDefinitions', '12338af0-0e69-4776-bea7-57ae8d297424')

var vaultName = '${prefix}-kv-${env}-${uniqueString(subscription().subscriptionId, env)}'

resource vault 'Microsoft.KeyVault/vaults@2024-12-01-preview' = {
  name: substring(vaultName, 0, min(length(vaultName), 24))
  location: location
  tags: tags
  properties: {
    tenantId: tenantId
    sku: { family: 'A', name: skuName }
    enableRbacAuthorization: true
    enablePurgeProtection: true
    softDeleteRetentionInDays: (env == 'prod') ? 90 : 7
    // Starter tier: public network access enabled, gated by RBAC via
    // managed identity. To harden later: set publicNetworkAccess to
    // 'Disabled' + add private endpoint resources.
    publicNetworkAccess: 'Enabled'
    networkAcls: {
      defaultAction: 'Allow'
      bypass: 'AzureServices'
    }
  }
}

resource appSecretsUser 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  scope: vault
  name: guid(vault.id, appIdentityPrincipalId, keyVaultSecretsUserRoleDef)
  properties: {
    roleDefinitionId: keyVaultSecretsUserRoleDef
    principalId: appIdentityPrincipalId
    principalType: 'ServicePrincipal'
  }
}

resource evalCryptoUser 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  scope: vault
  name: guid(vault.id, evaluatorIdentityPrincipalId, keyVaultCryptoUserRoleDef)
  properties: {
    roleDefinitionId: keyVaultCryptoUserRoleDef
    principalId: evaluatorIdentityPrincipalId
    principalType: 'ServicePrincipal'
  }
}

resource evalSecretsUser 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  scope: vault
  name: guid(vault.id, evaluatorIdentityPrincipalId, keyVaultSecretsUserRoleDef)
  properties: {
    roleDefinitionId: keyVaultSecretsUserRoleDef
    principalId: evaluatorIdentityPrincipalId
    principalType: 'ServicePrincipal'
  }
}

output vaultName string = vault.name
output vaultUri string = vault.properties.vaultUri
output vaultId string = vault.id
