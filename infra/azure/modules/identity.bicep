// Identity: user-assigned managed identities for each workload

@minLength(3)
@maxLength(6)
param prefix string

@allowed([ 'dev', 'stg', 'prod' ])
param env string

param location string
param tags object

resource appIdentity 'Microsoft.ManagedIdentity/userAssignedIdentities@2024-11-30' = {
  name: '${prefix}-id-app-${env}'
  location: location
  tags: tags
}

resource evaluatorIdentity 'Microsoft.ManagedIdentity/userAssignedIdentities@2024-11-30' = {
  name: '${prefix}-id-eval-${env}'
  location: location
  tags: tags
}

output appIdentityId string = appIdentity.id
output appIdentityClientId string = appIdentity.properties.clientId
output appIdentityPrincipalId string = appIdentity.properties.principalId

output evaluatorIdentityId string = evaluatorIdentity.id
output evaluatorIdentityClientId string = evaluatorIdentity.properties.clientId
output evaluatorIdentityPrincipalId string = evaluatorIdentity.properties.principalId
