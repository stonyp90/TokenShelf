// Container Apps: serverless environment + the Next.js app

@minLength(3)
@maxLength(6)
param prefix string

@allowed([ 'dev', 'stg', 'prod' ])
param env string

param location string
param tags object

param appIdentityId string
param appIdentityClientId string

#disable-next-line no-unused-params
param evaluatorIdentityId string

param appSubnetId string
param logAnalyticsWorkspaceId string

@secure()
param logAnalyticsSharedKey string

@secure()
param applicationInsightsConnectionString string

param containerRegistryServer string

@description('Container image tag for the app. Push to ACR first.')
param appImageTag string = 'latest'
param appImageName string = 'tokenshelf-app'

param postgresFqdn string
param postgresDatabase string
param keyVaultUri string
param blobAccountName string
param cosmosAccountName string

@description('Optional custom domain (FQDN). If empty, no binding is configured.')
param customDomain string = ''

@description('Minimum replica count. 0 = scale-to-zero (cold start ~1-2s on Consumption). Set to 1+ for steady traffic.')
@minValue(0)
@maxValue(25)
param minReplicas int = 0

@description('Maximum replica count. Each replica = 1 vCPU + 2 GiB by default.')
@minValue(1)
@maxValue(300)
param maxReplicas int = 10

@description('Concurrent HTTP requests that triggers a scale-up.')
@minValue(1)
param scaleConcurrentRequests int = 100

@description('Container CPU. Container Apps Consumption supports 0.25/0.5/0.75/1.0/1.25/1.5/1.75/2.0.')
param cpu string = '0.5'

@description('Container memory. Must pair with cpu (e.g. 0.5 vCPU → 1Gi).')
param memory string = '1Gi'

@description('Enable zone-redundancy on the Container Apps environment. Adds resiliency, no extra base cost on Consumption.')
param zoneRedundant bool = false

var environmentName = '${prefix}-cae-${env}'
var appName = '${prefix}-app-${env}'

resource environmentRes 'Microsoft.App/managedEnvironments@2025-02-02-preview' = {
  name: environmentName
  location: location
  tags: tags
  properties: {
    appLogsConfiguration: {
      destination: 'log-analytics'
      logAnalyticsConfiguration: {
        customerId: reference(logAnalyticsWorkspaceId, '2025-02-01').customerId
        sharedKey: logAnalyticsSharedKey
      }
    }
    vnetConfiguration: {
      infrastructureSubnetId: appSubnetId
      internal: false
    }
    workloadProfiles: [
      {
        name: 'Consumption'
        workloadProfileType: 'Consumption'
      }
    ]
    zoneRedundant: zoneRedundant
  }
}

resource app 'Microsoft.App/containerApps@2025-02-02-preview' = {
  name: appName
  location: location
  tags: tags
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: {
      '${appIdentityId}': {}
    }
  }
  properties: {
    environmentId: environmentRes.id
    workloadProfileName: 'Consumption'
    configuration: {
      activeRevisionsMode: 'Single'
      ingress: {
        external: true
        targetPort: 3000
        transport: 'http'
        allowInsecure: false
        traffic: [
          { latestRevision: true, weight: 100 }
        ]
        customDomains: empty(customDomain) ? null : [
          {
            name: customDomain
            bindingType: 'SniEnabled'
          }
        ]
      }
      registries: [
        {
          server: containerRegistryServer
          identity: appIdentityId
        }
      ]
      secrets: [
        {
          name: 'appinsights-connection-string'
          value: applicationInsightsConnectionString
        }
      ]
    }
    template: {
      containers: [
        {
          name: 'app'
          image: '${containerRegistryServer}/${appImageName}:${appImageTag}'
          resources: {
            cpu: json(cpu)
            memory: memory
          }
          env: [
            { name: 'NODE_ENV', value: 'production' }
            { name: 'PORT', value: '3000' }
            { name: 'AZURE_CLIENT_ID', value: appIdentityClientId }
            { name: 'APPLICATIONINSIGHTS_CONNECTION_STRING', secretRef: 'appinsights-connection-string' }
            { name: 'POSTGRES_HOST', value: postgresFqdn }
            { name: 'POSTGRES_DB', value: postgresDatabase }
            { name: 'KEY_VAULT_URI', value: keyVaultUri }
            { name: 'BLOB_ACCOUNT_NAME', value: blobAccountName }
            { name: 'COSMOS_ACCOUNT_NAME', value: cosmosAccountName }
            { name: 'AZURE_REGION', value: location }
          ]
          probes: [
            {
              type: 'Liveness'
              httpGet: { path: '/api/health', port: 3000 }
              initialDelaySeconds: 15
              periodSeconds: 30
            }
            {
              type: 'Readiness'
              httpGet: { path: '/api/health', port: 3000 }
              initialDelaySeconds: 5
              periodSeconds: 10
            }
          ]
        }
      ]
      scale: {
        minReplicas: minReplicas
        maxReplicas: maxReplicas
        rules: [
          {
            name: 'http-rule'
            http: { metadata: { concurrentRequests: string(scaleConcurrentRequests) } }
          }
        ]
      }
    }
  }
}

output appFqdn string = app.properties.configuration.ingress.fqdn
output environmentId string = environmentRes.id
output appResourceId string = app.id
