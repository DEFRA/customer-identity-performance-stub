import assert from 'node:assert/strict'
import test from 'node:test'

const baseUrl = process.env.TEST_BASE_URL || 'http://localhost:3000'

test('DELETE /cache/accounts returns 204 with no response body', async () => {
  const response = await fetch(`${baseUrl}/cache/accounts`, { method: 'DELETE' })

  assert.equal(response.status, 204)
  assert.equal(await response.text(), '')
})

test('DELETE /cache/auth-context returns 204 with no response body', async () => {
  const response = await fetch(`${baseUrl}/cache/auth-context`, { method: 'DELETE' })

  assert.equal(response.status, 204)
  assert.equal(await response.text(), '')
})
