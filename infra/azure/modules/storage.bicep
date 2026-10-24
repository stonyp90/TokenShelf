// Storage: blob account for sealed-content envelopes + project assets

@minLength(3)
@maxLength(6)
param prefix string

@allowed([ 'dev', 'stg', 'prod' ])
param env string

param location string
param tags object
param appIdentityPrincipalId string
param evaluatorIdentityPrincipalId string
param subnetId string

@description('Replication SKU. LRS is cheapest (single zone). ZRS adds zone-redundancy.')
@allowed([ 'Standard_LRS', 'Standard_ZRS', 'Standard_GRS' ])
param skuName string = 'Standard_LRS'

@description('Restrict public network access; require VNet rules / private endpoints.')
param disablePublicAccess bool = false

@description('Enable infrastructure encryption (double encryption). Adds storage cost ~6%.')
param infrastructureEncryption bool = false

// Built-in role definitions (tenant-scoped paths resolve on fresh subs).
var storageBlobDataContributorRoleDef = tenantResourceId('Microsoft.Authorization/roleDefinitions', 'ba92f5b4-2d11-453d-a403-e96b0029c9fe')
var storageBlobDataReaderRoleDef      = tenantResourceId('Microsoft.Authorization/roleDefinitions', '2a2b9908-6ea1-4ae2-8e65-a410df84e7d1')

var accountName = toLower('${prefix}st${env}${uniqueString(subscription().subscriptionId, env)}')

resource storage 'Microsoft.Storage/storageAccounts@2024-01-01' = {
  name: substring(accountName, 0, min(length(accountName), 24))
  location: location
  tags: tags
  sku: { name: skuName }
  kind: 'StorageV2'
  properties: {
    accessTier: 'Hot'
    allowBlobPublicAccess: false
    allowSharedKeyAccess: false
    minimumTlsVersion: 'TLS1_2'
    supportsHttpsTrafficOnly: true
    // Starter tier: public access enabled, MI auth via Storage Blob
    // Data Contributor role assignments below. To harden later: flip
    // disablePublicAccess true and add private endpoints.
    publicNetworkAccess: disablePublicAccess ? 'Disabled' : 'Enabled'
    networkAcls: {
      defaultAction: disablePublicAccess ? 'Deny' : 'Allow'
      bypass: 'AzureServices'
    }
    encryption: {
      services: {
        blob: { enabled: true, keyType: 'Account' }
        file: { enabled: true, keyType: 'Account' }
      }
      keySource: 'Microsoft.Storage'
      requireInfrastructureEncryption: infrastructureEncryption
    }
  }
}

resource blobService 'Microsoft.Storage/storageAccounts/blobServices@2024-01-01' = {
  parent: storage
  name: 'default'
  properties: {
    deleteRetentionPolicy: { enabled: true, days: 7 }
    containerDeleteRetentionPolicy: { enabled: true, days: 7 }
    isVersioningEnabled: false
  }
}

resource sealedContainer 'Microsoft.Storage/storageAccounts/blobServices/containers@2024-01-01' = {
  parent: blobService
  name: 'sealed-sessions'
  properties: {
    publicAccess: 'None'
    immutableStorageWithVersioning: { enabled: false }
  }
}

resource projectAssetsContainer 'Microsoft.Storage/storageAccounts/blobServices/containers@2024-01-01' = {
  parent: blobService
  name: 'project-assets'
  properties: { publicAccess: 'None' }
}

resource auditAnchorContainer 'Microsoft.Storage/storageAccounts/blobServices/containers@2024-01-01' = {
  parent: blobService
  name: 'audit-anchors'
  properties: { publicAccess: 'None' }
}

resource appBlobContributor 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  scope: storage
  name: guid(storage.id, appIdentityPrincipalId, storageBlobDataContributorRoleDef)
  properties: {
    roleDefinitionId: storageBlobDataContributorRoleDef
    principalId: appIdentityPrincipalId
    principalType: 'ServicePrincipal'
  }
}

resource evalBlobReader 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  scope: storage
  name: guid(storage.id, evaluatorIdentityPrincipalId, storageBlobDataReaderRoleDef)
  properties: {
    roleDefinitionId: storageBlobDataReaderRoleDef
    principalId: evaluatorIdentityPrincipalId
    principalType: 'ServicePrincipal'
  }
}

output accountName string = storage.name
output accountId string = storage.id
output blobEndpoint string = storage.properties.primaryEndpoints.blob
