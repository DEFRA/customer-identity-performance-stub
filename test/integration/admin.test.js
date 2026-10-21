import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import test from 'node:test'

const baseUrl = process.env.TEST_BASE_URL || 'http://localhost:3000'
const adminApiKey = process.env.ADMIN_API_KEY || 'integration-test-admin-key'
const guid = () => crypto.randomUUID()

async function adminRequest (path, options = {}, { authenticate = true } = {}) {
  const headers = { ...options.headers }
  if (authenticate) {
    headers['api-key'] = adminApiKey
  }
  if (options.body !== undefined) {
    headers['content-type'] = 'application/json'
  }
  return fetch(`${baseUrl}${path}`, { ...options, headers })
}

function accountDocument (sub, email) {
  return {
    sub,
    email,
    contactId: guid(),
    uniqueReference: guid(),
    firstName: 'Admin',
    lastName: 'Test',
    crn: `admin-${guid()}`
  }
}

function newAccount (t, overrides = {}) {
  const sub = guid()
  const account = { ...accountDocument(sub, `admin-${sub}@example.test`), ...overrides }
  t.after(async () => {
    const response = await adminRequest(`/admin/accounts/${account.sub}`, { method: 'DELETE' })
    assert.ok([204, 404].includes(response.status), `Account cleanup returned ${response.status}`)
    await response.text()
  })
  return account
}

async function createAccount (t, overrides) {
  const document = newAccount(t, overrides)
  const response = await adminRequest('/admin/accounts', {
    method: 'POST',
    body: JSON.stringify(document)
  })
  assert.equal(response.status, 201)
  return response.json()
}

function assertMetadata (account) {
  assert.match(account._id, /^[0-9a-f]{24}$/)
  assert.equal(new Date(account.createdAt).toISOString(), account.createdAt)
  assert.equal(new Date(account.updatedAt).toISOString(), account.updatedAt)
}

test('Admin API requires the configured API key', async () => {
  const noKey = await adminRequest('/admin/accounts', {}, { authenticate: false })
  assert.equal(noKey.status, 401)
  assert.deepEqual(await noKey.json(), { error: 'unauthorized' })

  const wrongKey = await fetch(`${baseUrl}/admin/accounts`, {
    headers: { 'api-key': 'not-the-configured-key' }
  })
  assert.equal(wrongKey.status, 401)
})

test('Admin API rejects invalid account payloads and sub identifiers', async () => {
  const sub = guid()
  const invalidBodies = [
    [],
    { email: 'missing-sub@example.test' },
    { sub: 'not-a-guid', email: 'invalid@example.test' },
    { sub: guid(), email: 42 },
    { sub: guid(), _id: 'client-controlled-id' }
  ]

  for (const body of invalidBodies) {
    const response = await adminRequest('/admin/accounts', {
      method: 'POST',
      body: JSON.stringify(body)
    })
    assert.equal(response.status, 400)
  }

  const mismatchedPut = await adminRequest(`/admin/accounts/${sub}`, {
    method: 'PUT',
    body: JSON.stringify({ sub: guid(), email: 'mismatch@example.test' })
  })
  assert.equal(mismatchedPut.status, 400)

  const idInPut = await adminRequest(`/admin/accounts/${sub}`, {
    method: 'PUT',
    body: JSON.stringify({ _id: 'client-controlled-id', email: 'invalid@example.test' })
  })
  assert.equal(idInPut.status, 400)

  const invalidPatchBodies = [
    {},
    { sub: guid() },
    { 'profile.firstName': 'Nested' },
    { $unset: { email: '' } },
    { createdAt: '2024-01-01T00:00:00.000Z' },
    { _id: 'client-controlled-id' }
  ]
  for (const body of invalidPatchBodies) {
    const response = await adminRequest(`/admin/accounts/${sub}`, {
      method: 'PATCH',
      body: JSON.stringify(body)
    })
    assert.equal(response.status, 400)
  }

  const invalidPath = await adminRequest('/admin/accounts/not-a-guid')
  assert.equal(invalidPath.status, 400)
})

test('GET /admin/accounts returns an array of account documents', async (t) => {
  const first = await createAccount(t)
  const second = await createAccount(t)
  const response = await adminRequest('/admin/accounts')

  assert.equal(response.status, 200)
  const accounts = await response.json()
  assert.ok(Array.isArray(accounts))
  assert.deepEqual(accounts.find(({ sub }) => sub === first.sub), first)
  assert.deepEqual(accounts.find(({ sub }) => sub === second.sub), second)
})

test('GET /admin/accounts/{sub} returns the account document', async (t) => {
  const account = await createAccount(t)
  const response = await adminRequest(`/admin/accounts/${account.sub}`)

  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), account)
})

test('GET /admin/accounts/{sub} returns 404 for a missing account', async () => {
  const response = await adminRequest(`/admin/accounts/${guid()}`)
  assert.equal(response.status, 404)
})

test('GET /admin/accounts?email returns a single account case-insensitively', async (t) => {
  const account = await createAccount(t)
  const response = await adminRequest(`/admin/accounts?email=${encodeURIComponent(account.email.toUpperCase())}`)

  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), account)
})

test('GET /admin/accounts?email returns 404 for a missing email', async () => {
  const response = await adminRequest(`/admin/accounts?email=missing-${guid()}@example.test`)
  assert.equal(response.status, 404)
})

test('GET /admin/accounts?email returns 400 for an empty email', async () => {
  const response = await adminRequest('/admin/accounts?email=')
  assert.equal(response.status, 400)
})

test('POST /admin/accounts returns 201 with the persisted account and metadata', async (t) => {
  const document = newAccount(t)
  const response = await adminRequest('/admin/accounts', {
    method: 'POST',
    body: JSON.stringify(document)
  })

  assert.equal(response.status, 201)
  const created = await response.json()
  assertMetadata(created)
  assert.deepEqual(created, { ...document, _id: created._id, createdAt: created.createdAt, updatedAt: created.updatedAt })
  const stored = await adminRequest(`/admin/accounts/${document.sub}`)
  assert.equal(stored.status, 200)
  assert.deepEqual(await stored.json(), created)
})

test('POST /admin/accounts returns 409 for a duplicate sub', async (t) => {
  const existing = await createAccount(t)
  const duplicate = accountDocument(existing.sub, `duplicate-${guid()}@example.test`)
  const response = await adminRequest('/admin/accounts', {
    method: 'POST',
    body: JSON.stringify(duplicate)
  })

  assert.equal(response.status, 409)
  const stored = await adminRequest(`/admin/accounts/${existing.sub}`)
  assert.deepEqual(await stored.json(), existing)
})

test('POST /admin/accounts returns 409 for a duplicate email', async (t) => {
  const existing = await createAccount(t)
  const duplicate = newAccount(t, { email: existing.email.toUpperCase() })
  const response = await adminRequest('/admin/accounts', {
    method: 'POST',
    body: JSON.stringify(duplicate)
  })

  assert.equal(response.status, 409)
  assert.equal((await adminRequest(`/admin/accounts/${duplicate.sub}`)).status, 404)
})

test('PUT /admin/accounts/{sub} replaces the full document and invalidates cached lookups', async (t) => {
  const existing = await createAccount(t, { profile: { obsolete: true } })
  assert.equal((await adminRequest(`/admin/accounts/${existing.sub}`)).status, 200)
  assert.equal((await adminRequest(`/admin/accounts?email=${encodeURIComponent(existing.email)}`)).status, 200)
  const replacement = {
    sub: existing.sub,
    email: `replaced-${guid()}@example.test`,
    contactId: guid(),
    lastName: 'Replaced'
  }
  const response = await adminRequest(`/admin/accounts/${existing.sub}`, {
    method: 'PUT',
    body: JSON.stringify(replacement)
  })

  assert.equal(response.status, 200)
  const replaced = await response.json()
  assertMetadata(replaced)
  assert.deepEqual(replaced, {
    ...replacement,
    _id: existing._id,
    createdAt: existing.createdAt,
    updatedAt: replaced.updatedAt
  })
  const stored = await adminRequest(`/admin/accounts/${existing.sub}`)
  assert.deepEqual(await stored.json(), replaced)
  assert.equal((await adminRequest(`/admin/accounts?email=${encodeURIComponent(existing.email)}`)).status, 404)
  const newEmail = await adminRequest(`/admin/accounts?email=${encodeURIComponent(replacement.email)}`)
  assert.equal(newEmail.status, 200)
  assert.deepEqual(await newEmail.json(), replaced)
})

test('PUT /admin/accounts/{sub} creates a missing account with status 200', async (t) => {
  const document = newAccount(t)
  const response = await adminRequest(`/admin/accounts/${document.sub}`, {
    method: 'PUT',
    body: JSON.stringify(document)
  })

  assert.equal(response.status, 200)
  const created = await response.json()
  assertMetadata(created)
  assert.deepEqual(created, { ...document, _id: created._id, createdAt: created.createdAt, updatedAt: created.updatedAt })
  const stored = await adminRequest(`/admin/accounts/${document.sub}`)
  assert.equal(stored.status, 200)
  assert.deepEqual(await stored.json(), created)
})

test('PUT /admin/accounts/{sub} returns 409 without replacing an account on email conflict', async (t) => {
  const existing = await createAccount(t)
  const other = await createAccount(t)
  const response = await adminRequest(`/admin/accounts/${existing.sub}`, {
    method: 'PUT',
    body: JSON.stringify(accountDocument(existing.sub, other.email))
  })

  assert.equal(response.status, 409)
  const stored = await adminRequest(`/admin/accounts/${existing.sub}`)
  assert.deepEqual(await stored.json(), existing)
})

test('PATCH /admin/accounts/{sub} shallowly updates fields and invalidates cached lookups', async (t) => {
  const existing = await createAccount(t, { profile: { preferredName: 'Before', obsolete: true } })
  assert.equal((await adminRequest(`/admin/accounts/${existing.sub}`)).status, 200)
  assert.equal((await adminRequest(`/admin/accounts?email=${encodeURIComponent(existing.email)}`)).status, 200)
  const changes = {
    email: `patched-${guid()}@example.test`,
    crn: `patched-${guid()}`,
    profile: { preferredName: 'After' }
  }
  const response = await adminRequest(`/admin/accounts/${existing.sub}`, {
    method: 'PATCH',
    body: JSON.stringify(changes)
  })

  assert.equal(response.status, 200)
  const patched = await response.json()
  assertMetadata(patched)
  assert.deepEqual(patched, { ...existing, ...changes, updatedAt: patched.updatedAt })
  const stored = await adminRequest(`/admin/accounts/${existing.sub}`)
  assert.deepEqual(await stored.json(), patched)
  assert.equal((await adminRequest(`/admin/accounts?email=${encodeURIComponent(existing.email)}`)).status, 404)
  const newEmail = await adminRequest(`/admin/accounts?email=${encodeURIComponent(changes.email)}`)
  assert.equal(newEmail.status, 200)
  assert.deepEqual(await newEmail.json(), patched)
})

test('PATCH /admin/accounts/{sub} returns 404 for a missing account', async () => {
  const response = await adminRequest(`/admin/accounts/${guid()}`, {
    method: 'PATCH',
    body: JSON.stringify({ firstName: 'Missing' })
  })
  assert.equal(response.status, 404)
})

test('PATCH /admin/accounts/{sub} returns 409 without updating an account on email conflict', async (t) => {
  const existing = await createAccount(t)
  const other = await createAccount(t)
  const response = await adminRequest(`/admin/accounts/${existing.sub}`, {
    method: 'PATCH',
    body: JSON.stringify({ email: other.email })
  })

  assert.equal(response.status, 409)
  const stored = await adminRequest(`/admin/accounts/${existing.sub}`)
  assert.deepEqual(await stored.json(), existing)
})

test('DELETE /admin/accounts/{sub} returns 204 and invalidates cached lookups', async (t) => {
  const account = await createAccount(t)
  assert.equal((await adminRequest(`/admin/accounts/${account.sub}`)).status, 200)
  assert.equal((await adminRequest(`/admin/accounts?email=${encodeURIComponent(account.email)}`)).status, 200)
  const response = await adminRequest(`/admin/accounts/${account.sub}`, { method: 'DELETE' })

  assert.equal(response.status, 204)
  assert.equal(await response.text(), '')
  assert.equal((await adminRequest(`/admin/accounts/${account.sub}`)).status, 404)
  assert.equal((await adminRequest(`/admin/accounts?email=${encodeURIComponent(account.email)}`)).status, 404)
})

test('DELETE /admin/accounts/{sub} returns 404 for a missing account', async () => {
  const response = await adminRequest(`/admin/accounts/${guid()}`, { method: 'DELETE' })
  assert.equal(response.status, 404)
})
