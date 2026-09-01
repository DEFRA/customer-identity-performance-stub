import assert from 'node:assert/strict'
import test from 'node:test'

const baseUrl = process.env.TEST_BASE_URL || 'http://localhost:3000'

test('GET /health/live returns alive status', async () => {
  const response = await fetch(`${baseUrl}/health/live`)

  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), { status: 'alive' })
})

test('GET /health/ready returns connected status', async () => {
  const response = await fetch(`${baseUrl}/health/ready`)

  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), {
    status: 'ready',
    database: 'connected'
  })
})
