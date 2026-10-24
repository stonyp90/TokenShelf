// Cosmos DB: NoSQL (SQL API) for high-volume documents
//
// Used for: session telemetry, transparency-log entries, judge traces.
// The relational core (engagement, consent, score, receipt) stays in Postgres.

@minLength(3)
@maxLength(6)
param prefix string

@allowed([ 'dev', 'stg', 'prod' ])
param env string

param location string
param tags object
param appIdentityPrincipalId string
param subnetId string

@description('Free tier discount — only one Cosmos account per subscription can use it.')
param enableFreeTier bool = false

@description('Serverless capacity. Default true (pay-per-RU). Flip false for provisioned RU/s once traffic justifies it.')
param serverlessCapacity bool = true

@description('Enable multi-region automatic failover. Off by default to keep costs at one region.')
param enableAutomaticFailover bool = false

@description('Make the primary region zone-redundant. Adds ~30% cost in prod-grade configs.')
param zoneRedundant bool = false

@description('Backup policy. Periodic is cheaper; Continuous (PITR) enables 30d restore.')
@allowed([ 'Periodic', 'Continuous' ])
param backupPolicyType string = 'Periodic'

@description('Disable public network access; require VNet service endpoints / private endpoints.')
param disablePublicAccess bool = false

// Cosmos DB built-in data-plane role: 00000000-0000-0000-0000-000000000002 = Data Contributor
var cosmosDataContributorRoleId = '00000000-0000-0000-0000-000000000002'

var accountName = toLower('${prefix}-cos-${env}-${uniqueString(subscription().subscriptionId, env)}')

resource account 'Microsoft.DocumentDB/databaseAccounts@2024-12-01-preview' = {
  name: substring(accountName, 0, min(length(accountName), 44))
  location: location
  tags: tags
  kind: 'GlobalDocumentDB'
  identity: { type: 'SystemAssigned' }
  properties: {
    databaseAccountOfferType: 'Standard'
    enableAutomaticFailover: enableAutomaticFailover
    enableFreeTier: enableFreeTier
    // Newer API version (≥ 2024-12-01-preview) uses `capacityMode` instead
    // of the legacy EnableServerless capability.
    capacityMode: serverlessCapacity ? 'Serverless' : 'Provisioned'
    consistencyPolicy: {
      defaultConsistencyLevel: 'Session'
    }
    locations: [
      {
        locationName: location
        failoverPriority: 0
        isZoneRedundant: zoneRedundant
      }
    ]
    // Starter tier: public access enabled, AAD-only auth (no key auth).
    // VNet rules left empty so the deploy doesn't require app-side
    // service-endpoint plumbing. Harden later by setting
    // disablePublicAccess true + adding private endpoints.
    publicNetworkAccess: disablePublicAccess ? 'Disabled' : 'Enabled'
    isVirtualNetworkFilterEnabled: false
    networkAclBypass: 'AzureServices'
    minimalTlsVersion: 'Tls12'
    disableLocalAuth: true
    backupPolicy: backupPolicyType == 'Periodic' ? {
      type: 'Periodic'
      periodicModeProperties: {
        backupIntervalInMinutes: 240
        backupRetentionIntervalInHours: 8
        backupStorageRedundancy: 'Local'
      }
    } : {
      type: 'Continuous'
      continuousModeProperties: { tier: 'Continuous7Days' }
    }
  }
}

resource database 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases@2024-12-01-preview' = {
  parent: account
  name: 'tokenshelf'
  properties: {
    resource: { id: 'tokenshelf' }
  }
}

resource sessionsContainer 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases/containers@2024-12-01-preview' = {
  parent: database
  name: 'sessions'
  properties: {
    resource: {
      id: 'sessions'
      partitionKey: { paths: [ '/engagementId' ], kind: 'Hash', version: 2 }
      indexingPolicy: {
        indexingMode: 'consistent'
        automatic: true
        includedPaths: [ { path: '/*' } ]
        excludedPaths: [ { path: '/payload/*' } ]
      }
      defaultTtl: -1
    }
  }
}

resource transparencyContainer 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases/containers@2024-12-01-preview' = {
  parent: database
  name: 'transparency-entries'
  properties: {
    resource: {
      id: 'transparency-entries'
      partitionKey: { paths: [ '/anchorWindow' ], kind: 'Hash', version: 2 }
      indexingPolicy: {
        indexingMode: 'consistent'
        automatic: true
        includedPaths: [ { path: '/*' } ]
      }
    }
  }
}

resource judgeTracesContainer 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases/containers@2024-12-01-preview' = {
  parent: database
  name: 'judge-traces'
  properties: {
    resource: {
      id: 'judge-traces'
      partitionKey: { paths: [ '/engagementId' ], kind: 'Hash', version: 2 }
      defaultTtl: 7776000  // 90 days
    }
  }
}

resource appCosmosRole 'Microsoft.DocumentDB/databaseAccounts/sqlRoleAssignments@2024-12-01-preview' = {
  parent: account
  name: guid(account.id, appIdentityPrincipalId, cosmosDataContributorRoleId)
  properties: {
    roleDefinitionId: '${account.id}/sqlRoleDefinitions/${cosmosDataContributorRoleId}'
    principalId: appIdentityPrincipalId
    scope: account.id
  }
}

output accountName string = account.name
output endpoint string = account.properties.documentEndpoint
output databaseName string = database.name
