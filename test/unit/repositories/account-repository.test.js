import assert from 'node:assert/strict'
import { describe, it, mock } from 'node:test'
import { ObjectId } from 'mongodb'

import { createCache } from '../../../src/cache/cache.js'
import config from '../../../src/config/index.js'
import { caseInsensitiveCollation, createAccountRepository } from '../../../src/repositories/account-repository.js'

function createTestRepository ({
  cache = createCache({ maxEntries: 20 }),
  findOne = async () => null,
  findAccounts = async () => [],
  insertOne = async () => ({ insertedId: new ObjectId() }),
  findOneAndUpdate = async () => null,
  findOneAndReplace = async () => null,
  findOneAndDelete = async () => null,
  deleteOne = async () => ({ deletedCount: 0 })
} = {}) {
  const collection = {
    findOne: mock.fn(findOne),
    find: mock.fn(() => ({ toArray: mock.fn(findAccounts) })),
    insertOne: mock.fn(insertOne),
    findOneAndUpdate: mock.fn(findOneAndUpdate),
    findOneAndReplace: mock.fn(findOneAndReplace),
    findOneAndDelete: mock.fn(findOneAndDelete),
    deleteOne: mock.fn(deleteOne)
  }
  const db = { collection: mock.fn(() => collection) }
  const getDb = mock.fn(async () => db)
  const repository = createAccountRepository({ getDb, cache })

  return { repository, collection, getDb }
}

function createCacheWithSetSpy () {
  const cache = createCache({ maxEntries: 20 })
  const setCalls = []
  const set = cache.set
  cache.set = (...args) => {
    setCalls.push(args)
    return set(...args)
  }
  return { cache, setCalls }
}

describe('account repository cache', () => {
  it('caches login results using the configured TTL and reuses them by subject', async () => {
    const id = new ObjectId()
    const account = { _id: id, sub: 'subject-1' }
    const { cache, setCalls } = createCacheWithSetSpy()
    const { repository, collection, getDb } = createTestRepository({
      cache,
      findOne: async () => account
    })

    assert.equal(await repository.findByLoginIdentifier('user@example.test'), account)
    assert.equal(await repository.findByLoginIdentifier('user@example.test'), account)
    assert.equal(await repository.findBySub('subject-1'), account)

    assert.equal(collection.findOne.mock.calls.length, 1)
    assert.equal(getDb.mock.calls.length, 1)
    assert.deepEqual(collection.findOne.mock.calls[0].arguments, [
      { $or: [{ email: 'user@example.test' }, { crn: 'user@example.test' }] },
      { collation: caseInsensitiveCollation }
    ])
    assert.deepEqual(setCalls, [[
      `account:${id.toHexString()}`,
      account,
      { ttlMs: config.accountCache.ttlMs }
    ], [
      'lookup:sub:subject-1',
      id.toHexString(),
      { ttlMs: config.accountCache.ttlMs }
    ], [
      'lookup:login:user@example.test',
      id.toHexString(),
      { ttlMs: config.accountCache.ttlMs }
    ]])
  })

  it('keeps subject and login lookup keys separate', async () => {
    const subjectAccount = { _id: new ObjectId(), sub: 'same-key', firstName: 'Subject' }
    const loginAccount = { _id: new ObjectId(), sub: 'login-result', firstName: 'Login' }
    const { repository, collection } = createTestRepository({
      findOne: async (query) => query.sub ? subjectAccount : loginAccount
    })

    assert.equal(await repository.findBySub('same-key'), subjectAccount)
    assert.equal(await repository.findByLoginIdentifier('same-key'), loginAccount)
    assert.equal(await repository.findBySub('same-key'), subjectAccount)
    assert.equal(await repository.findByLoginIdentifier('same-key'), loginAccount)

    assert.equal(collection.findOne.mock.calls.length, 2)
  })

  it('does not normalize login keys and preserves the original identifier for Mongo collation', async () => {
    const account = { _id: new ObjectId(), sub: 'subject-1' }
    const { repository, collection } = createTestRepository({
      findOne: async () => account
    })

    assert.equal(await repository.findByLoginIdentifier('User@Example.test'), account)
    assert.equal(await repository.findByLoginIdentifier('user@example.test'), account)

    assert.equal(collection.findOne.mock.calls.length, 2)
    assert.deepEqual(collection.findOne.mock.calls.map(({ arguments: [query] }) => query.$or[0].email), [
      'User@Example.test',
      'user@example.test'
    ])
  })

  it('uses the same cache entry for string and ObjectId account IDs', async () => {
    const id = new ObjectId()
    const account = { _id: id, sub: 'subject-1' }
    const { repository, collection } = createTestRepository({
      findOne: async () => account
    })

    assert.equal(await repository.findById(id.toHexString()), account)
    assert.equal(await repository.findById(id), account)

    assert.equal(collection.findOne.mock.calls.length, 1)
    assert.deepEqual(collection.findOne.mock.calls[0].arguments, [{ _id: id }])
    assert.equal(await repository.findBySub('subject-1'), account)
    assert.equal(collection.findOne.mock.calls.length, 1)
  })

  it('does not cache missing accounts', async () => {
    const { repository, collection } = createTestRepository({
      findOne: async () => null
    })

    assert.equal(await repository.findBySub('missing'), null)
    assert.equal(await repository.findBySub('missing'), null)

    assert.equal(collection.findOne.mock.calls.length, 2)
  })

  it('does not cache findAll results', async () => {
    const accounts = [{ sub: 'subject-1' }]
    const { repository, collection } = createTestRepository({
      findAccounts: async () => accounts
    })

    assert.equal(await repository.findAll(), accounts)
    assert.equal(await repository.findAll(), accounts)

    assert.equal(collection.find.mock.calls.length, 2)
  })

  it('clears all cached accounts so subsequent lookups read from MongoDB', async () => {
    const account = { _id: new ObjectId(), sub: 'subject-1' }
    const { repository, collection } = createTestRepository({
      findOne: async () => account
    })

    assert.equal(await repository.findBySub('subject-1'), account)
    repository.clearCache()
    assert.equal(await repository.findBySub('subject-1'), account)

    assert.equal(collection.findOne.mock.calls.length, 2)
  })

  it('keeps unrelated cached accounts after creating an account', async () => {
    const existingAccount = { _id: new ObjectId(), sub: 'subject-1' }
    const insertedId = new ObjectId()
    const { repository, collection } = createTestRepository({
      findOne: async () => existingAccount,
      insertOne: async () => ({ insertedId })
    })

    assert.equal(await repository.findBySub('subject-1'), existingAccount)
    const created = await repository.create({ sub: 'subject-2' })
    assert.equal(await repository.findBySub('subject-1'), existingAccount)

    assert.equal(created._id, insertedId)
    assert.equal(created.sub, 'subject-2')
    assert.ok(created.createdAt instanceof Date)
    assert.ok(created.updatedAt instanceof Date)
    assert.equal(collection.findOne.mock.calls.length, 1)
  })

  it('invalidates only the updated account and leaves unrelated accounts cached', async () => {
    const updatedId = new ObjectId()
    const unrelatedId = new ObjectId()
    const existingAccount = { _id: updatedId, sub: 'subject-1' }
    const updatedAccount = { _id: updatedId, sub: 'subject-1', firstName: 'Updated' }
    const unrelatedAccount = { _id: unrelatedId, sub: 'subject-2' }
    let currentAccount = existingAccount
    const { repository, collection } = createTestRepository({
      findOne: async (query) => {
        if (query._id) {
          return query._id.equals(updatedId) ? currentAccount : unrelatedAccount
        }
        return query.sub === 'subject-1' ? currentAccount : unrelatedAccount
      },
      findOneAndUpdate: async () => updatedAccount
    })

    assert.equal(await repository.findBySub('subject-1'), existingAccount)
    assert.equal(await repository.findBySub('subject-2'), unrelatedAccount)
    assert.equal(await repository.update(updatedId, { firstName: 'Updated' }), updatedAccount)
    currentAccount = updatedAccount
    assert.equal(await repository.findBySub('subject-1'), updatedAccount)
    assert.equal(await repository.findBySub('subject-2'), unrelatedAccount)

    assert.equal(collection.findOne.mock.calls.length, 4)
  })

  it('invalidates only a successfully deleted account and keeps unrelated accounts cached', async () => {
    const deletedId = new ObjectId()
    const unrelatedId = new ObjectId()
    const account = { _id: deletedId, sub: 'subject-1' }
    const unrelatedAccount = { _id: unrelatedId, sub: 'subject-2' }
    let currentAccount = account
    let deleteCount = 0
    const { repository, collection } = createTestRepository({
      findOne: async (query) => {
        if (query._id) {
          return query._id.equals(deletedId) ? currentAccount : unrelatedAccount
        }
        return query.sub === 'subject-1' ? currentAccount : unrelatedAccount
      },
      deleteOne: async () => ({ deletedCount: deleteCount })
    })

    assert.equal(await repository.findBySub('subject-1'), account)
    assert.equal(await repository.findBySub('subject-2'), unrelatedAccount)
    assert.equal(await repository.deleteById(deletedId), false)
    assert.equal(await repository.findBySub('subject-1'), account)

    deleteCount = 1
    assert.equal(await repository.deleteById(deletedId), true)
    currentAccount = null
    assert.equal(await repository.findBySub('subject-1'), null)
    assert.equal(await repository.findBySub('subject-2'), unrelatedAccount)

    assert.equal(collection.findOne.mock.calls.length, 5)
  })

  it('finds accounts by email with the configured collation and caches successful results', async () => {
    const account = { _id: new ObjectId(), sub: 'subject-1', email: 'user@example.test' }
    const { repository, collection } = createTestRepository({
      findOne: async () => account
    })

    assert.equal(await repository.findByEmail('user@example.test'), account)
    assert.equal(await repository.findByEmail('user@example.test'), account)

    assert.equal(collection.findOne.mock.calls.length, 1)
    assert.deepEqual(collection.findOne.mock.calls[0].arguments, [
      { email: 'user@example.test' },
      { collation: caseInsensitiveCollation }
    ])
  })

  it('replaces by sub, preserves createdAt, and invalidates old lookup keys', async () => {
    const id = new ObjectId()
    const createdAt = new Date('2024-01-01T00:00:00.000Z')
    const oldAccount = {
      _id: id,
      sub: 'subject-1',
      email: 'old@example.test',
      crn: 'old-crn',
      createdAt
    }
    const replacedAccount = {
      _id: id,
      sub: 'subject-1',
      email: 'new@example.test',
      crn: 'new-crn',
      createdAt
    }
    let currentAccount = oldAccount
    const { repository, collection } = createTestRepository({
      findOne: async (query) => {
        if (query.sub) {
          return currentAccount
        }
        if (query.email) {
          return query.email === currentAccount?.email ? currentAccount : null
        }
        if (query.$or) {
          return query.$or.some(({ crn, email }) => crn === currentAccount?.crn || email === currentAccount?.email)
            ? currentAccount
            : null
        }
        return null
      },
      findOneAndReplace: async (_query, replacement, options) => {
        assert.equal(replacement.sub, 'subject-1')
        assert.equal(replacement.createdAt, createdAt)
        assert.ok(replacement.updatedAt instanceof Date)
        assert.deepEqual(options, { upsert: true, returnDocument: 'after' })
        currentAccount = replacedAccount
        return replacedAccount
      }
    })

    await repository.findBySub('subject-1')
    await repository.findByEmail('old@example.test')
    await repository.findByLoginIdentifier('old-crn')
    assert.equal(await repository.replaceBySub('subject-1', {
      email: 'new@example.test',
      crn: 'new-crn',
      createdAt: new Date('2025-01-01T00:00:00.000Z')
    }), replacedAccount)

    assert.equal(await repository.findByEmail('old@example.test'), null)
    assert.equal(await repository.findByLoginIdentifier('old-crn'), null)
    assert.equal(await repository.findByEmail('new@example.test'), replacedAccount)
    assert.equal(collection.findOneAndReplace.mock.calls.length, 1)
  })

  it('upserts a replacement with server timestamps when the subject does not exist', async () => {
    const id = new ObjectId()
    const insertedAccount = { _id: id, sub: 'subject-2' }
    const { repository, collection } = createTestRepository({
      findOneAndReplace: async (_query, replacement, options) => {
        assert.ok(replacement.createdAt instanceof Date)
        assert.equal(replacement.createdAt, replacement.updatedAt)
        assert.equal(options.upsert, true)
        return insertedAccount
      }
    })

    assert.equal(await repository.replaceBySub('subject-2', { sub: 'subject-2' }), insertedAccount)
    assert.equal(collection.findOneAndReplace.mock.calls.length, 1)
  })

  it('patches top-level fields, preserves createdAt, and invalidates changed email and CRN keys', async () => {
    const id = new ObjectId()
    const createdAt = new Date('2024-01-01T00:00:00.000Z')
    let currentAccount = {
      _id: id,
      sub: 'subject-1',
      email: 'old@example.test',
      crn: 'old-crn',
      createdAt
    }
    const updatedAccount = {
      ...currentAccount,
      email: 'new@example.test',
      crn: 'new-crn'
    }
    const { repository, collection } = createTestRepository({
      findOne: async (query) => {
        if (query.sub) {
          return currentAccount
        }
        if (query.email) {
          return query.email === currentAccount?.email ? currentAccount : null
        }
        if (query.$or) {
          return query.$or.some(({ crn, email }) => crn === currentAccount?.crn || email === currentAccount?.email)
            ? currentAccount
            : null
        }
        return null
      },
      findOneAndUpdate: async (_query, update, options) => {
        assert.deepEqual(update.$set.email, 'new@example.test')
        assert.deepEqual(update.$set.crn, 'new-crn')
        assert.equal(Object.hasOwn(update.$set, 'createdAt'), false)
        assert.ok(update.$set.updatedAt instanceof Date)
        assert.deepEqual(options, { returnDocument: 'after' })
        currentAccount = updatedAccount
        return updatedAccount
      }
    })

    await repository.findBySub('subject-1')
    await repository.findByEmail('old@example.test')
    await repository.findByLoginIdentifier('old-crn')
    assert.equal(await repository.patchBySub('subject-1', {
      email: 'new@example.test',
      crn: 'new-crn'
    }), updatedAccount)

    assert.equal(await repository.findByEmail('old@example.test'), null)
    assert.equal(await repository.findByLoginIdentifier('old-crn'), null)
    assert.equal(await repository.findByEmail('new@example.test'), updatedAccount)
    assert.equal(collection.findOneAndUpdate.mock.calls.length, 1)
  })

  it('does not issue a MongoDB update when patching a missing subject', async () => {
    const { repository, collection } = createTestRepository()

    assert.equal(await repository.patchBySub('missing', { firstName: 'Updated' }), null)
    assert.equal(collection.findOneAndUpdate.mock.calls.length, 0)
  })

  it('deletes by sub and invalidates the deleted account and its lookup aliases', async () => {
    const deletedAccount = {
      _id: new ObjectId(),
      sub: 'subject-1',
      email: 'user@example.test',
      crn: 'account-crn'
    }
    let currentAccount = deletedAccount
    const { repository, collection } = createTestRepository({
      findOne: async (query) => {
        if (query.sub) {
          return currentAccount
        }
        if (query.email) {
          return query.email === currentAccount?.email ? currentAccount : null
        }
        if (query.$or) {
          return query.$or.some(({ crn, email }) => crn === currentAccount?.crn || email === currentAccount?.email)
            ? currentAccount
            : null
        }
        return null
      },
      findOneAndDelete: async () => {
        currentAccount = null
        return deletedAccount
      }
    })

    await repository.findBySub('subject-1')
    await repository.findByEmail('user@example.test')
    await repository.findByLoginIdentifier('account-crn')
    assert.equal(await repository.deleteBySub('subject-1'), deletedAccount)
    assert.equal(await repository.findBySub('subject-1'), null)
    assert.equal(await repository.findByEmail('user@example.test'), null)
    assert.equal(await repository.findByLoginIdentifier('account-crn'), null)
    assert.equal(collection.findOneAndDelete.mock.calls.length, 1)
  })
})
