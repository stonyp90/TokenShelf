// PostgreSQL Flexible Server — relational core (engagements, consents, scores, receipts)

@minLength(3)
@maxLength(6)
param prefix string

@allowed([ 'dev', 'stg', 'prod' ])
param env string

param location string
param tags object

@description('Admin login. Stored in Key Vault by main.bicep; do not commit.')
param administratorLogin string

@secure()
param administratorLoginPassword string

param subnetId string
param logAnalyticsWorkspaceId string

@description('Private DNS zone resource id used by Postgres Flexible Server VNet integration. Required when subnetId is delegated.')
param privateDnsZoneArmResourceId string

@description('Compute SKU. Default Burstable B1ms (~$15/mo). Override to Standard_D2ds_v5 for prod traffic.')
param skuName string = 'Standard_B1ms'

@description('SKU tier. Burstable is the cost-optimized default.')
@allowed([ 'Burstable', 'GeneralPurpose', 'MemoryOptimized' ])
param skuTier string = 'Burstable'

@description('Storage in GB; auto-grow enabled. 32 GB ~ $4/mo at P10 tier.')
@minValue(32)
param storageSizeGB int = 32

@description('Enable zone-redundant HA. Off by default to save ~$25/mo idle. Flip on for prod traffic.')
param enableHighAvailability bool = false

@description('Backup retention in days. 7d default; bump to 35 for prod compliance.')
@minValue(7)
@maxValue(35)
param backupRetentionDays int = 7

@description('Enable geo-redundant backup. Adds ~$10/mo + replication cost.')
param geoRedundantBackup bool = false

@description('Postgres major version.')
param postgresVersion string = '16'

@description('Database name created on the server.')
param databaseName string = 'tokenshelf'

var serverName = '${prefix}-pg-${env}-${uniqueString(subscription().subscriptionId, env)}'

resource server 'Microsoft.DBforPostgreSQL/flexibleServers@2024-08-01' = {
  name: substring(serverName, 0, min(length(serverName), 63))
  location: location
  tags: tags
  sku: { name: skuName, tier: skuTier }
  properties: {
    administratorLogin: administratorLogin
    administratorLoginPassword: administratorLoginPassword
    version: postgresVersion
    storage: {
      storageSizeGB: storageSizeGB
      autoGrow: 'Enabled'
      tier: 'P10'
    }
    network: {
      delegatedSubnetResourceId: subnetId
      privateDnsZoneArmResourceId: privateDnsZoneArmResourceId
    }
    highAvailability: enableHighAvailability ? {
      mode: 'ZoneRedundant'
    } : {
      mode: 'Disabled'
    }
    backup: {
      backupRetentionDays: backupRetentionDays
      geoRedundantBackup: geoRedundantBackup ? 'Enabled' : 'Disabled'
    }
    authConfig: {
      activeDirectoryAuth: 'Enabled'
      passwordAuth: 'Enabled'
      tenantId: subscription().tenantId
    }
  }
}

resource db 'Microsoft.DBforPostgreSQL/flexibleServers/databases@2024-08-01' = {
  parent: server
  name: databaseName
  properties: {
    charset: 'UTF8'
    collation: 'en_US.utf8'
  }
}

resource diagnostics 'Microsoft.Insights/diagnosticSettings@2021-05-01-preview' = {
  scope: server
  name: 'pg-to-loganalytics'
  properties: {
    workspaceId: logAnalyticsWorkspaceId
    logs: [
      { category: 'PostgreSQLLogs', enabled: true }
      { category: 'PostgreSQLFlexSessions', enabled: true }
      { category: 'PostgreSQLFlexQueryStoreRuntime', enabled: true }
    ]
    metrics: [
      { category: 'AllMetrics', enabled: true }
    ]
  }
}

output fqdn string = server.properties.fullyQualifiedDomainName
output serverName string = server.name
output databaseName string = db.name
