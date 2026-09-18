import assert from 'node:assert/strict'
import { describe, it, mock } from 'node:test'

import { MongoAdapter } from '../../../src/oidc/mongodb-adapter.js'

function createAdapter () {
  const adapter = new MongoAdapter('TestModel')
  const updateOne = mock.fn(async () => {})
  adapter.coll = async () => ({ updateOne })
  return { adapter, updateOne }
}

describe('MongoAdapter#upsert', () => {
  it('sets expiresAt and a Cosmos DB-only ttl override when expiresIn is given', async () => {
    const { adapter, updateOne } = createAdapter()

    await adapter.upsert('id-1', { some: 'payload' }, 120)

    const [, update] = updateOne.mock.calls[0].arguments
    assert.ok(update.$set.expiresAt instanceof Date)
    assert.equal(update.$set.ttl, 120)
  })

  it('sets neither expiresAt nor ttl when expiresIn is omitted', async () => {
    const { adapter, updateOne } = createAdapter()

    await adapter.upsert('id-1', { some: 'payload' })

    const [, update] = updateOne.mock.calls[0].arguments
    assert.equal('expiresAt' in update.$set, false)
    assert.equal('ttl' in update.$set, false)
  })

  it('floors a fractional expiresIn for the ttl override', async () => {
    const { adapter, updateOne } = createAdapter()

    await adapter.upsert('id-1', { some: 'payload' }, 120.7)

    const [, update] = updateOne.mock.calls[0].arguments
    assert.equal(update.$set.ttl, 120)
  })
})
