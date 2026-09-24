import assert from 'node:assert/strict'
import test from 'node:test'

const baseUrl = process.env.TEST_BASE_URL || 'http://localhost:3000'
const policy = 'b2c_1a_signupsignin'

test('GET /{policyId}/.well-known/openid-configuration returns Azure AD B2C-compatible metadata, keeping /oidc in endpoint URLs', async () => {
  const response = await fetch(`${baseUrl}/${policy}/.well-known/openid-configuration`)

  assert.equal(response.status, 200)
  assert.match(response.headers.get('content-type'), /^application\/json/)

  const metadata = await response.json()

  // issuer is not policy-scoped, matching real Azure AD B2C
  assert.equal(metadata.issuer, baseUrl)
  assert.equal(metadata.authorization_endpoint, `${baseUrl}/${policy}/oidc/auth`)
  assert.equal(metadata.token_endpoint, `${baseUrl}/${policy}/oidc/token`)
  assert.equal(metadata.end_session_endpoint, `${baseUrl}/${policy}/oidc/session/end`)
  assert.equal(metadata.jwks_uri, `${baseUrl}/${policy}/oidc/jwks`)
  assert.deepEqual(metadata.response_types_supported, ['code'])
  assert.deepEqual(metadata.scopes_supported, ['openid', 'offline_access'])
  assert.deepEqual(metadata.subject_types_supported, ['pairwise'])
  assert.deepEqual(metadata.id_token_signing_alg_values_supported, ['RS256'])
  assert.deepEqual(metadata.token_endpoint_auth_methods_supported, [
    'client_secret_post',
    'client_secret_basic'
  ])
  assert.equal(metadata.claims_supported.includes('contactId'), true)
  assert.equal(metadata.claims_supported.includes('relationships'), true)

  for (const field of [
    'authorization_response_iss_parameter_supported',
    'claim_types_supported',
    'claims_parameter_supported',
    'code_challenge_methods_supported',
    'dpop_signing_alg_values_supported',
    'grant_types_supported',
    'pushed_authorization_request_endpoint',
    'request_uri_parameter_supported',
    'userinfo_endpoint'
  ]) {
    assert.equal(Object.hasOwn(metadata, field), false)
  }
})

test('policy matching is case-insensitive', async () => {
  const response = await fetch(`${baseUrl}/${policy.toUpperCase()}/.well-known/openid-configuration`)
  assert.equal(response.status, 200)

  const metadata = await response.json()
  assert.match(metadata.authorization_endpoint, /\/oidc\/auth$/)
})

test('rejects an unrecognised path-segment policy identifier with 404', async () => {
  const response = await fetch(`${baseUrl}/b2c_1a_invalid/.well-known/openid-configuration`)
  assert.equal(response.status, 404)

  const body = await response.json()
  assert.equal(body.error, 'invalid_request')
})

test('legacy /oidc-nested discovery paths are no longer served', async () => {
  const withoutPolicy = await fetch(`${baseUrl}/oidc/.well-known/openid-configuration`)
  assert.equal(withoutPolicy.status, 404)

  const withPolicy = await fetch(`${baseUrl}/${policy}/oidc/.well-known/openid-configuration`)
  assert.equal(withPolicy.status, 404)
})
