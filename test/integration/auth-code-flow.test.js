import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import test from 'node:test'

const baseUrl = process.env.TEST_BASE_URL || 'http://localhost:3000'
const clientId = process.env.CLIENT_ID || 'integration-test-client'
const clientSecret = process.env.CLIENT_SECRET || 'integration-test-secret'
const redirectUri = 'http://localhost:3001/cb'
const postLogoutRedirectUri = 'http://localhost:3001/logout'
const username = process.env.TEST_USERNAME || 'alice.standard@example.com'
const policy = 'b2c_1a_signupsignin'
// must be a GUID - matches the seeded alice.standard account's Finance Officer role
const serviceId = 'b6f7b9be-4b3e-4b1a-9c3a-111111111111'

function generateCodeVerifier () {
  return crypto.randomBytes(32).toString('base64url')
}

function generateCodeChallenge (verifier) {
  return crypto.createHash('sha256').update(verifier).digest('base64url')
}

function decodeJwt (token) {
  const [, payload] = token.split('.')
  return JSON.parse(Buffer.from(payload, 'base64url').toString('utf-8'))
}

function updateCookies (jar, response) {
  for (const cookie of response.headers.getSetCookie()) {
    const [name, value] = cookie.split(';')[0].split('=')
    jar.set(name, value)
  }
}

function cookieHeader (jar) {
  return [...jar].map(([name, value]) => `${name}=${value}`).join('; ')
}

async function fetchMetadata () {
  const response = await fetch(`${baseUrl}/${policy}/oidc/.well-known/openid-configuration`)
  assert.equal(response.status, 200)
  return response.json()
}

function buildAuthUrl (authorizationEndpoint, { state, nonce, codeChallenge, serviceId: serviceIdOverride, relationshipId }) {
  const authUrl = new URL(authorizationEndpoint)
  authUrl.searchParams.set('client_id', clientId)
  authUrl.searchParams.set('redirect_uri', redirectUri)
  authUrl.searchParams.set('response_type', 'code')
  authUrl.searchParams.set('scope', 'openid offline_access')
  authUrl.searchParams.set('code_challenge', codeChallenge)
  authUrl.searchParams.set('code_challenge_method', 'S256')
  authUrl.searchParams.set('serviceId', serviceIdOverride ?? serviceId)
  if (relationshipId) {
    authUrl.searchParams.set('relationshipId', relationshipId)
  }
  authUrl.searchParams.set('state', state)
  authUrl.searchParams.set('nonce', nonce)
  return authUrl
}

// Drives the headless login (no browser): follows the same redirect chain a browser would,
// forwarding cookies manually since fetch has no built-in cookie jar.
async function performLogin (metadata, jar = new Map(), { username: usernameOverride, serviceId: serviceIdOverride, relationshipId } = {}) {
  const codeVerifier = generateCodeVerifier()
  const state = `state-${crypto.randomUUID()}`
  const nonce = `nonce-${crypto.randomUUID()}`
  const authUrl = buildAuthUrl(metadata.authorization_endpoint, {
    state,
    nonce,
    codeChallenge: generateCodeChallenge(codeVerifier),
    serviceId: serviceIdOverride,
    relationshipId
  })

  let response = await fetch(authUrl, { redirect: 'manual' })
  assert.equal(response.status, 303)
  updateCookies(jar, response)
  const interactionPath = new URL(response.headers.get('location'), baseUrl).pathname

  response = await fetch(`${baseUrl}${interactionPath}`, {
    redirect: 'manual',
    headers: { cookie: cookieHeader(jar) }
  })
  assert.equal(response.status, 200)
  updateCookies(jar, response)
  assert.match(await response.text(), /name="username"/)

  response = await fetch(`${baseUrl}${interactionPath}/login`, {
    method: 'POST',
    redirect: 'manual',
    headers: {
      cookie: cookieHeader(jar),
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: new URLSearchParams({ username: usernameOverride ?? username }).toString()
  })
  assert.equal(response.status, 303)
  updateCookies(jar, response)

  // The interaction resumes through one or more same-origin hops (our /auth/interaction/{uid}
  // page plus the provider's own internal resume URL) before finally redirecting to the
  // client's redirect_uri on a different origin.
  const providerOrigin = new URL(baseUrl).origin
  let location = new URL(response.headers.get('location'), baseUrl)
  while (location.origin === providerOrigin) {
    response = await fetch(location, {
      redirect: 'manual',
      headers: { cookie: cookieHeader(jar) }
    })
    assert.equal(response.status, 303)
    updateCookies(jar, response)
    location = new URL(response.headers.get('location'), baseUrl)
  }

  const callbackUrl = location
  assert.equal(callbackUrl.origin + callbackUrl.pathname, redirectUri)
  assert.equal(callbackUrl.searchParams.get('state'), state)
  const code = callbackUrl.searchParams.get('code')
  assert.ok(code)

  return { jar, code, codeVerifier }
}

async function exchangeCodeForTokens (tokenEndpoint, code, codeVerifier) {
  const response = await fetch(tokenEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: clientId,
      client_secret: clientSecret,
      code,
      code_verifier: codeVerifier,
      redirect_uri: redirectUri
    }).toString()
  })
  assert.equal(response.status, 200)
  return response.json()
}

async function refreshTokens (tokenEndpoint, refreshToken) {
  const response = await fetch(tokenEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken
    }).toString()
  })
  assert.equal(response.status, 200)
  return response.json()
}

test('completes the authorization code + refresh token flow and returns valid claims', async () => {
  const metadata = await fetchMetadata()
  const { code, codeVerifier } = await performLogin(metadata)

  const tokenResponse = await exchangeCodeForTokens(metadata.token_endpoint, code, codeVerifier)
  assert.ok(tokenResponse.id_token)
  assert.ok(tokenResponse.access_token)
  assert.ok(tokenResponse.refresh_token)
  assert.equal(tokenResponse.scope, 'openid offline_access')

  const idTokenClaims = decodeJwt(tokenResponse.id_token)
  assert.equal(idTokenClaims.sub, 'a1b2c3d4-0001-0001-0001-000000000001')
  assert.equal(idTokenClaims.contactId, 'a1b2c3d4-0001-0001-0001-aabbccdd0001')
  assert.equal(idTokenClaims.email, 'alice.standard@example.com')
  assert.equal(idTokenClaims.acr, policy)
  assert.equal(idTokenClaims.currentRelationshipId, 'r1b2c3d4-0001-0001-0001-000000000001')
  assert.deepEqual(idTokenClaims.relationships, [
    'r1b2c3d4-0001-0001-0001-000000000001:o1b2c3d4-0001-0001-0001-000000000001:Acme Farm Ltd:2:Employee:2'
  ])
  assert.equal(idTokenClaims.serviceId, serviceId)
  assert.deepEqual(idTokenClaims.roles, ['r1b2c3d4-0001-0001-0001-000000000001:Finance Officer:3'])
  assert.equal(idTokenClaims.enrolmentCount, 1)
  // matches the real Defra CIDM B2C policy's id_token_lifetime_secs
  assert.equal(idTokenClaims.exp - idTokenClaims.iat, 1200)

  const refreshedTokenResponse = await refreshTokens(metadata.token_endpoint, tokenResponse.refresh_token)
  assert.ok(refreshedTokenResponse.access_token)
  assert.ok(refreshedTokenResponse.id_token)
})

test('narrows relationships and roles to the requested relationshipId', async () => {
  const metadata = await fetchMetadata()
  // john.multiple has two relationships; only r...005 has a role for this serviceId
  const johnServiceId = 'b6f7b9be-4b3e-4b1a-9c3a-333333333333'
  const johnRelationshipId = 'r1b2c3d4-0001-0001-0001-000000000005'
  const { code, codeVerifier } = await performLogin(metadata, new Map(), {
    username: 'john.multiple@example.com',
    serviceId: johnServiceId,
    relationshipId: johnRelationshipId
  })

  const tokenResponse = await exchangeCodeForTokens(metadata.token_endpoint, code, codeVerifier)
  const idTokenClaims = decodeJwt(tokenResponse.id_token)

  assert.equal(idTokenClaims.currentRelationshipId, johnRelationshipId)
  assert.deepEqual(idTokenClaims.relationships, [
    'r1b2c3d4-0001-0001-0001-000000000005:o1b2c3d4-0001-0001-0001-000000000005:Super Agri Ltd:1:Employee:1'
  ])
  assert.deepEqual(idTokenClaims.roles, ['r1b2c3d4-0001-0001-0001-000000000005:CEO:3'])
})

test('completes the authorization code + refresh token flow using the query-parameter policy form', async () => {
  const discoveryResponse = await fetch(`${baseUrl}/oidc/.well-known/openid-configuration?p=${policy}`)
  assert.equal(discoveryResponse.status, 200)
  const metadata = await discoveryResponse.json()

  const { code, codeVerifier } = await performLogin(metadata)
  const tokenResponse = await exchangeCodeForTokens(metadata.token_endpoint, code, codeVerifier)
  assert.ok(tokenResponse.refresh_token)
  assert.equal(tokenResponse.scope, 'openid offline_access')

  const idTokenClaims = decodeJwt(tokenResponse.id_token)
  assert.equal(idTokenClaims.acr, policy)
})

test('logs the user out and destroys the session', async () => {
  const metadata = await fetchMetadata()
  const { jar } = await performLogin(metadata)

  let response = await fetch(metadata.end_session_endpoint, {
    redirect: 'manual',
    headers: { cookie: cookieHeader(jar) }
  })
  assert.equal(response.status, 200)
  updateCookies(jar, response)
  const logoutPage = await response.text()

  const action = logoutPage.match(/action="([^"]+)"/)?.[1]
  const xsrf = logoutPage.match(/name="xsrf" value="([^"]+)"/)?.[1]
  assert.ok(action, 'expected logout form action in the confirmation page')
  assert.ok(xsrf, 'expected an xsrf token in the confirmation page')

  response = await fetch(action, {
    method: 'POST',
    redirect: 'manual',
    headers: {
      cookie: cookieHeader(jar),
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: new URLSearchParams({ xsrf, logout: 'yes' }).toString()
  })
  assert.equal(response.status, 303)
  updateCookies(jar, response)

  // Regression: a fresh authorization request must require login again, proving the
  // session (not just the client grant) was actually destroyed.
  const authUrl = buildAuthUrl(metadata.authorization_endpoint, {
    state: `state-${crypto.randomUUID()}`,
    nonce: `nonce-${crypto.randomUUID()}`,
    codeChallenge: generateCodeChallenge(generateCodeVerifier())
  })

  response = await fetch(authUrl, { redirect: 'manual', headers: { cookie: cookieHeader(jar) } })
  assert.equal(response.status, 303)
  updateCookies(jar, response)
  const interactionPath = new URL(response.headers.get('location'), baseUrl).pathname

  response = await fetch(`${baseUrl}${interactionPath}`, {
    redirect: 'manual',
    headers: { cookie: cookieHeader(jar) }
  })
  assert.equal(response.status, 200)
  assert.match(await response.text(), /name="username"/)
})

test('logs out and redirects to the registered post_logout_redirect_uri when id_token_hint is supplied', async () => {
  const metadata = await fetchMetadata()
  const { jar, code, codeVerifier } = await performLogin(metadata)
  const { id_token: idToken } = await exchangeCodeForTokens(metadata.token_endpoint, code, codeVerifier)
  const postLogoutState = `state-${crypto.randomUUID()}`

  const endSessionUrl = new URL(metadata.end_session_endpoint)
  endSessionUrl.searchParams.set('id_token_hint', idToken)
  endSessionUrl.searchParams.set('post_logout_redirect_uri', postLogoutRedirectUri)
  endSessionUrl.searchParams.set('state', postLogoutState)

  let response = await fetch(endSessionUrl, {
    redirect: 'manual',
    headers: { cookie: cookieHeader(jar) }
  })
  assert.equal(response.status, 200)
  updateCookies(jar, response)
  const logoutPage = await response.text()

  const action = logoutPage.match(/action="([^"]+)"/)?.[1]
  const xsrf = logoutPage.match(/name="xsrf" value="([^"]+)"/)?.[1]
  assert.ok(action, 'expected logout form action in the confirmation page')
  assert.ok(xsrf, 'expected an xsrf token in the confirmation page')

  response = await fetch(action, {
    method: 'POST',
    redirect: 'manual',
    headers: {
      cookie: cookieHeader(jar),
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: new URLSearchParams({ xsrf, logout: 'yes' }).toString()
  })
  assert.equal(response.status, 303)

  const location = new URL(response.headers.get('location'))
  assert.equal(location.origin + location.pathname, postLogoutRedirectUri)
  assert.equal(location.searchParams.get('state'), postLogoutState)
})

// Confirms POST /session/end is accepted (translated to an equivalent GET internally) while
// POST /auth remains unsupported, since oidc-provider only ever registers a GET route for /auth.
test('accepts a POST end_session request and applies the id_token_hint gate', async () => {
  const metadata = await fetchMetadata()
  const { jar, code, codeVerifier } = await performLogin(metadata)
  const { id_token: idToken } = await exchangeCodeForTokens(metadata.token_endpoint, code, codeVerifier)

  const response = await fetch(metadata.end_session_endpoint, {
    method: 'POST',
    redirect: 'manual',
    headers: {
      cookie: cookieHeader(jar),
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: new URLSearchParams({
      id_token_hint: idToken,
      post_logout_redirect_uri: postLogoutRedirectUri
    }).toString()
  })
  assert.equal(response.status, 200)
  const logoutPage = await response.text()
  assert.ok(logoutPage.match(/action="([^"]+)"/), 'expected logout form action in the confirmation page')
})

// Mirrors CIDM B2C: without id_token_hint, post_logout_redirect_uri is ignored and the
// provider's own success page is shown instead, even though the session still ends.
test('logs out and shows the sign-out success page instead of redirecting when id_token_hint is not supplied', async () => {
  const metadata = await fetchMetadata()
  const { jar } = await performLogin(metadata)

  const endSessionUrl = new URL(metadata.end_session_endpoint)
  endSessionUrl.searchParams.set('client_id', clientId)
  endSessionUrl.searchParams.set('post_logout_redirect_uri', postLogoutRedirectUri)

  let response = await fetch(endSessionUrl, {
    redirect: 'manual',
    headers: { cookie: cookieHeader(jar) }
  })
  assert.equal(response.status, 200)
  updateCookies(jar, response)
  const logoutPage = await response.text()

  const action = logoutPage.match(/action="([^"]+)"/)?.[1]
  const xsrf = logoutPage.match(/name="xsrf" value="([^"]+)"/)?.[1]
  assert.ok(action, 'expected logout form action in the confirmation page')
  assert.ok(xsrf, 'expected an xsrf token in the confirmation page')

  response = await fetch(action, {
    method: 'POST',
    redirect: 'manual',
    headers: {
      cookie: cookieHeader(jar),
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: new URLSearchParams({ xsrf, logout: 'yes' }).toString()
  })
  assert.equal(response.status, 303)
  updateCookies(jar, response)

  const location = new URL(response.headers.get('location'))
  assert.notEqual(location.origin + location.pathname, postLogoutRedirectUri)

  response = await fetch(location, {
    redirect: 'manual',
    headers: { cookie: cookieHeader(jar) }
  })
  assert.equal(response.status, 200)
  assert.match(await response.text(), /Sign-out Success/)

  // Regression: the session must still be fully destroyed, even without a redirect to the RP.
  const authUrl = buildAuthUrl(metadata.authorization_endpoint, {
    state: `state-${crypto.randomUUID()}`,
    nonce: `nonce-${crypto.randomUUID()}`,
    codeChallenge: generateCodeChallenge(generateCodeVerifier())
  })

  response = await fetch(authUrl, { redirect: 'manual', headers: { cookie: cookieHeader(jar) } })
  assert.equal(response.status, 303)
  updateCookies(jar, response)
  const interactionPath = new URL(response.headers.get('location'), baseUrl).pathname

  response = await fetch(`${baseUrl}${interactionPath}`, {
    redirect: 'manual',
    headers: { cookie: cookieHeader(jar) }
  })
  assert.equal(response.status, 200)
  assert.match(await response.text(), /name="username"/)
})

test('rejects authorization request with unknown client_id', async () => {
  const metadata = await fetchMetadata()
  const authUrl = new URL(metadata.authorization_endpoint)
  authUrl.searchParams.set('client_id', 'unknown-client')
  authUrl.searchParams.set('redirect_uri', redirectUri)
  authUrl.searchParams.set('response_type', 'code')
  authUrl.searchParams.set('scope', 'openid offline_access')
  authUrl.searchParams.set('code_challenge', generateCodeChallenge(generateCodeVerifier()))
  authUrl.searchParams.set('code_challenge_method', 'S256')
  authUrl.searchParams.set('state', `state-${crypto.randomUUID()}`)
  authUrl.searchParams.set('nonce', `nonce-${crypto.randomUUID()}`)

  const response = await fetch(authUrl, { redirect: 'manual' })
  assert(response.status >= 400, `expected error status, got ${response.status}`)
})

test('rejects authorization request with unknown redirect_uri', async () => {
  const metadata = await fetchMetadata()
  const testState = `state-${crypto.randomUUID()}`
  const authUrl = new URL(metadata.authorization_endpoint)
  authUrl.searchParams.set('client_id', clientId)
  authUrl.searchParams.set('redirect_uri', 'http://unknown.example.com/cb')
  authUrl.searchParams.set('response_type', 'code')
  authUrl.searchParams.set('scope', 'openid offline_access')
  authUrl.searchParams.set('code_challenge', generateCodeChallenge(generateCodeVerifier()))
  authUrl.searchParams.set('code_challenge_method', 'S256')
  authUrl.searchParams.set('state', testState)
  authUrl.searchParams.set('nonce', `nonce-${crypto.randomUUID()}`)

  const response = await fetch(authUrl, { redirect: 'manual' })
  assert.equal(response.status, 303)
  const location = new URL(response.headers.get('location'))
  assert.equal(location.origin + location.pathname, redirectUri)
  assert.equal(location.searchParams.get('error'), 'invalid_request')
  assert.ok(location.searchParams.get('error_description'))
  assert.equal(location.searchParams.get('state'), testState)
})

test('rejects authorization request with a missing serviceId', async () => {
  const metadata = await fetchMetadata()
  const testState = `state-${crypto.randomUUID()}`
  const authUrl = new URL(metadata.authorization_endpoint)
  authUrl.searchParams.set('client_id', clientId)
  authUrl.searchParams.set('redirect_uri', redirectUri)
  authUrl.searchParams.set('response_type', 'code')
  authUrl.searchParams.set('scope', 'openid offline_access')
  authUrl.searchParams.set('code_challenge', generateCodeChallenge(generateCodeVerifier()))
  authUrl.searchParams.set('code_challenge_method', 'S256')
  authUrl.searchParams.set('state', testState)
  authUrl.searchParams.set('nonce', `nonce-${crypto.randomUUID()}`)

  const response = await fetch(authUrl, { redirect: 'manual' })
  assert.equal(response.status, 303)
  const location = new URL(response.headers.get('location'))
  assert.equal(location.origin + location.pathname, redirectUri)
  assert.equal(location.searchParams.get('error'), 'server_error')
  assert.match(location.searchParams.get('error_description'), /ServiceId/)
  assert.equal(location.searchParams.get('state'), testState)
})
