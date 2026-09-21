import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { ensureOidcIndexes, ensureAccountIndexes } from '../../../src/oidc/ensure-indexes.js'

describe('ensureOidcIndexes', () => {
  it('creates indexes only for the collections used by the current oidc-setup', async () => {
    const calls = []
    const fakeDb = {
      collection (name) {
        return {
          async createIndexes (indexes) {
            calls.push({ name, indexes })
          }
        }
      }
    }

    await ensureOidcIndexes(fakeDb)

    assert.deepEqual(
      calls.map(({ name }) => name).sort(),
      ['AccessToken', 'AuthorizationCode', 'Grant', 'Interaction', 'RefreshToken', 'Session']
    )

    const grantIdIndexed = calls
      .filter(({ indexes }) => indexes.some((index) => index.key['payload.grantId']))
      .map(({ name }) => name)
      .sort()
    assert.deepEqual(grantIdIndexed, ['AccessToken', 'AuthorizationCode', 'RefreshToken'])

    const uniqueUidIndexed = calls
      .filter(({ indexes }) => indexes.some((index) => index.key['payload.uid'] && index.unique))
      .map(({ name }) => name)
    assert.deepEqual(uniqueUidIndexed, ['Session'])

    for (const { indexes } of calls) {
      assert.equal(
        indexes.some((index) => index.key.expiresAt === 1 && index.expireAfterSeconds === 0),
        true
      )
      // Cosmos DB-only fallback TTL index, inert on real MongoDB - see ensure-indexes.js
      assert.equal(
        indexes.some((index) => index.key._ts === 1 && typeof index.expireAfterSeconds === 'number'),
        true
      )
    }
  })

  it('drops and recreates an index that conflicts with a pre-existing definition', async () => {
    let createAttempts = 0
    let dropped
    const sessionCollection = {
      async createIndexes (indexes) {
        createAttempts += 1
        if (createAttempts === 1) {
          const error = new Error('Index already exists with different options')
          error.code = 85
          throw error
        }
      },
      async indexes () {
        return [{ name: 'payload.uid_1', key: { 'payload.uid': 1 }, unique: true }]
      },
      async dropIndex (name) {
        dropped = name
      }
    }
    const fakeDb = {
      collection (name) {
        return name === 'Session' ? sessionCollection : { async createIndexes () {} }
      }
    }

    await ensureOidcIndexes(fakeDb)

    assert.equal(dropped, 'payload.uid_1')
    assert.equal(createAttempts, 2)
  })

  it('retries without the unique option when Cosmos DB rejects a unique nested-path index', async () => {
    let lastIndexes
    const sessionCollection = {
      async createIndexes (indexes) {
        lastIndexes = indexes
        if (indexes.some((index) => index.unique)) {
          const error = new Error('Unique and compound indexes do not support nested paths.')
          error.code = 115
          throw error
        }
      }
    }
    const fakeDb = {
      collection (name) {
        return name === 'Session' ? sessionCollection : { async createIndexes () {} }
      }
    }

    await ensureOidcIndexes(fakeDb)

    assert.equal(lastIndexes.some((index) => index.key['payload.uid']), true)
    assert.equal(lastIndexes.some((index) => index.unique), false)
  })

  it('retries without expireAfterSeconds when Cosmos DB rejects the TTL option', async () => {
    let lastIndexes
    const fakeDb = {
      collection () {
        return {
          async createIndexes (indexes) {
            lastIndexes = indexes
            if (indexes.some((index) => 'expireAfterSeconds' in index)) {
              const error = new Error("The 'expireAfterSeconds' option is currently not supported.")
              error.code = 2
              throw error
            }
          }
        }
      }
    }

    await ensureOidcIndexes(fakeDb)

    assert.equal(lastIndexes.some((index) => index.key.expiresAt === 1), true)
    assert.equal(lastIndexes.some((index) => index.key._ts === 1), true)
    assert.equal(lastIndexes.some((index) => 'expireAfterSeconds' in index), false)
  })

  it('retries without collation when Cosmos DB Emulator rejects the option on the email index', async () => {
    let lastIndexes
    const accountsCollection = {
      async createIndexes (indexes) {
        lastIndexes = indexes
        if (indexes.some((index) => 'collation' in index)) {
          const error = new Error('collation')
          error.code = 197
          throw error
        }
      }
    }
    const fakeDb = {
      collection (name) {
        return name === 'accounts' ? accountsCollection : { async createIndexes () {} }
      }
    }

    await ensureAccountIndexes(fakeDb)

    assert.equal(lastIndexes.some((index) => index.key.email === 1), true)
    assert.equal(lastIndexes.some((index) => 'collation' in index), false)
  })
})
