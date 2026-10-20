import assert from 'node:assert/strict'
import { describe, it, mock } from 'node:test'

import { createCache } from '../../../src/cache/cache.js'
import config from '../../../src/config/index.js'
import { createAuthContextRepository } from '../../../src/repositories/auth-context-repository.js'

function createTestRepository ({
  cache = createCache({ maxEntries: 10 }),
  findOne = async () => null,
  updateOne = async () => {},
  ttlSeconds = 60
} = {}) {
  const collection = {
    findOne: mock.fn(findOne),
    updateOne: mock.fn(updateOne)
  }
  const db = { collection: mock.fn(() => collection) }
  const getDb = mock.fn(async () => db)
  const repository = createAuthContextRepository({ getDb, cache, ttlSeconds })

  return { repository, cache, collection, getDb }
}

describe('auth context repository cache', () => {
  it('uses the configured cache capacity', async () => {
    const originalMaxEntries = config.authContextCache.maxEntries
    config.authContextCache.maxEntries = 1
    const findOne = mock.fn(async (_query) => ({ createdAt: new Date() }))
    const collection = { findOne }
    const getDb = async () => ({ collection: () => collection })

    try {
      const repository = createAuthContextRepository({ getDb })

      await repository.findByGrantId('grant-1')
      await repository.findByGrantId('grant-2')
      await repository.findByGrantId('grant-1')

      assert.equal(findOne.mock.calls.length, 3)
    } finally {
      config.authContextCache.maxEntries = originalMaxEntries
    }
  })

  it('caches an existing context by grant ID', async () => {
    const context = { _id: 'grant-1', serviceId: 'service-1', createdAt: new Date() }
    const { repository, collection, getDb } = createTestRepository({
      findOne: async () => context
    })

    assert.equal(await repository.findByGrantId('grant-1'), context)
    assert.equal(await repository.findByGrantId('grant-1'), context)
    assert.equal(collection.findOne.mock.calls.length, 1)
    assert.equal(getDb.mock.calls.length, 1)
    assert.deepEqual(collection.findOne.mock.calls[0].arguments, [{ _id: 'grant-1' }])
  })

  it('does not cache missing contexts', async () => {
    const { repository, collection } = createTestRepository()

    assert.equal(await repository.findByGrantId('missing-grant'), null)
    assert.equal(await repository.findByGrantId('missing-grant'), null)
    assert.equal(collection.findOne.mock.calls.length, 2)
  })

  it('does not cache contexts without a valid unexpired creation time', async () => {
    const expiredContext = {
      _id: 'expired-grant',
      serviceId: 'service-1',
      createdAt: new Date(Date.now() - 61_000)
    }
    const { repository, collection } = createTestRepository({
      findOne: async () => expiredContext
    })

    assert.equal(await repository.findByGrantId('expired-grant'), expiredContext)
    assert.equal(await repository.findByGrantId('expired-grant'), expiredContext)
    assert.equal(collection.findOne.mock.calls.length, 2)
  })

  it('invalidates only the saved grant after a successful write', async () => {
    const cache = createCache({ maxEntries: 10 })
    const oldContext = { _id: 'grant-1', serviceId: 'old', createdAt: new Date() }
    const newContext = { _id: 'grant-1', serviceId: 'new', createdAt: new Date() }
    cache.set('grant-1', oldContext)
    const otherContext = { _id: 'grant-2', serviceId: 'other', createdAt: new Date() }
    cache.set('grant-2', otherContext)
    const { repository, collection } = createTestRepository({
      cache,
      findOne: async () => newContext
    })

    await repository.save('grant-1', { serviceId: 'new' })

    assert.equal(await repository.findByGrantId('grant-1'), newContext)
    assert.equal(await repository.findByGrantId('grant-2'), otherContext)
    assert.equal(collection.findOne.mock.calls.length, 1)
    assert.deepEqual(collection.updateOne.mock.calls[0].arguments[0], { _id: 'grant-1' })
    assert.equal(collection.updateOne.mock.calls[0].arguments[1].$set.serviceId, 'new')
    assert.equal('relationshipId' in collection.updateOne.mock.calls[0].arguments[1].$set, false)
  })

  it('keeps the cached context when saving fails', async () => {
    const context = { _id: 'grant-1', serviceId: 'cached', createdAt: new Date() }
    const cache = createCache({ maxEntries: 10 })
    cache.set('grant-1', context)
    const { repository, collection } = createTestRepository({
      cache,
      updateOne: async () => {
        throw new Error('write failed')
      }
    })

    await assert.rejects(repository.save('grant-1', { serviceId: 'new' }), /write failed/)
    assert.equal(await repository.findByGrantId('grant-1'), context)
    assert.equal(collection.findOne.mock.calls.length, 0)
  })

  it('bounds the cache entry lifetime by the context grant lifetime', async () => {
    const createdAt = new Date(Date.now() - 5_000)
    const context = { _id: 'grant-1', createdAt }
    const cache = createCache({ maxEntries: 10 })
    const set = cache.set
    let setCall
    cache.set = (...args) => {
      setCall = args
      return set(...args)
    }
    const { repository } = createTestRepository({
      cache,
      findOne: async () => context,
      ttlSeconds: 60
    })

    await repository.findByGrantId('grant-1')

    assert.equal(setCall[0], 'grant-1')
    assert.equal(setCall[1], context)
    assert.ok(setCall[2].ttlMs > 0)
    assert.ok(setCall[2].ttlMs <= 55_000)
  })
})
