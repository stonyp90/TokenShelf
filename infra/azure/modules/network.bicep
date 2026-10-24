// Network: VNet with delegated subnets for Container Apps + data tier

@minLength(3)
@maxLength(6)
param prefix string

@allowed([ 'dev', 'stg', 'prod' ])
param env string

param location string
param tags object

@description('Address space for the VNet.')
param vnetAddressPrefix string = '10.42.0.0/16'

// CIDR notes for the /16 VNet (10.42.0.0/16):
//   • app subnet /23  → must align on a /23 boundary → 10.42.0.0/23
//     (covers 10.42.0.0 – 10.42.1.255, 512 addresses)
//   • data subnet /24 → 10.42.4.0/24
//     (covers 10.42.4.0 – 10.42.4.255, 256 addresses; non-overlapping)

@description('Subnet for Container Apps environment (delegated). Must be /23 minimum per ACA requirements.')
param appSubnetPrefix string = '10.42.0.0/23'

@description('Subnet for data tier (Postgres + service endpoints to KV/Storage/Cosmos).')
param dataSubnetPrefix string = '10.42.4.0/24'

var vnetName = '${prefix}-vnet-${env}'

resource vnet 'Microsoft.Network/virtualNetworks@2024-05-01' = {
  name: vnetName
  location: location
  tags: tags
  properties: {
    addressSpace: { addressPrefixes: [ vnetAddressPrefix ] }
    subnets: [
      {
        name: 'app'
        properties: {
          addressPrefix: appSubnetPrefix
          delegations: [
            {
              name: 'Microsoft.App.environments'
              properties: { serviceName: 'Microsoft.App/environments' }
            }
          ]
          serviceEndpoints: [
            { service: 'Microsoft.Storage' }
            { service: 'Microsoft.KeyVault' }
            { service: 'Microsoft.AzureCosmosDB' }
          ]
        }
      }
      {
        name: 'data'
        properties: {
          addressPrefix: dataSubnetPrefix
          privateEndpointNetworkPolicies: 'Disabled'
          delegations: [
            {
              name: 'Microsoft.DBforPostgreSQL.flexibleServers'
              properties: { serviceName: 'Microsoft.DBforPostgreSQL/flexibleServers' }
            }
          ]
        }
      }
    ]
  }
}

resource pgPrivateDnsZone 'Microsoft.Network/privateDnsZones@2024-06-01' = {
  name: '${prefix}-${env}.postgres.database.azure.com'
  location: 'global'
  tags: tags
}

resource pgZoneLink 'Microsoft.Network/privateDnsZones/virtualNetworkLinks@2024-06-01' = {
  parent: pgPrivateDnsZone
  name: '${vnetName}-link'
  location: 'global'
  properties: {
    virtualNetwork: { id: vnet.id }
    registrationEnabled: false
  }
}

output vnetId string = vnet.id
output appSubnetId string = '${vnet.id}/subnets/app'
output dataSubnetId string = '${vnet.id}/subnets/data'
output postgresPrivateDnsZoneId string = pgPrivateDnsZone.id
