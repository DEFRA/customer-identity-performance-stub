// Single source of truth for the OIDC claim set: used both as the provider's claims.openid
// config and to override claims_supported in the per-policy discovery document
export const OIDC_CLAIMS = [
  'sub',
  'contactId',
  'email',
  'firstName',
  'lastName',
  'serviceId',
  'correlationId',
  'sessionId',
  'uniqueReference',
  'loa',
  'aal',
  'enrolmentCount',
  'enrolmentRequestCount',
  'currentRelationshipId',
  'relationships',
  'roles',
  'amr',
  'iss',
  'iat',
  'exp',
  'aud',
  'acr',
  'nonce',
  'auth_time'
]
