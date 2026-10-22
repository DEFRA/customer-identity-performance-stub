import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import config from '../../../src/config/index.js'
import { ensureOidcIndexes, ensureAccountIndexes } from '../../../src/oidc/ensure-indexes.js'

describe('ensureOidcIndexes', () => {
  it('creates the OIDC indexes required by MongoDB', async () => {
    const calls = []
    const fakeDb = {
      collection (name) {
        return {
          collectionName: name,
          async createIndexes (indexes) {
            calls.push({ name, indexes })
          }
        }
      }
    }

    await ensureOidcIndexes(fakeDb, 'mongodb')

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
      assert.equal(indexes.some((index) => index.key._ts === 1), false)
    }
  })

  it('uses only the Cosmos _ts TTL index for OIDC collections', async () => {
    const calls = []
    const fakeDb = {
      collection (name) {
        return {
          collectionName: name,
          async createIndexes (indexes) {
            calls.push({ name, indexes })
          }
        }
      }
    }

    await ensureOidcIndexes(fakeDb, 'cosmos')

    for (const { indexes } of calls) {
      assert.equal(indexes.some((index) => index.key.expiresAt === 1), false)
      assert.equal(
        indexes.some((index) => index.key._ts === 1 && index.expireAfterSeconds === 30 * 24 * 60 * 60),
        true
      )
    }
  })

  it('drops only the conflicting index when repairing MongoDB definitions', async () => {
    let createAttempts = 0
    const dropped = []
    const sessionCollection = {
      collectionName: 'Session',
      async createIndexes () {
        createAttempts += 1
        if (createAttempts === 1) {
          const error = new Error('Index with name: payload.uid_1 already exists with different options')
          error.code = 85
          throw error
        }
      },
      async indexes () {
        return [
          { name: 'payload.uid_1', key: { 'payload.uid': 1 }, unique: false },
          { name: 'expiresAt_1', key: { expiresAt: 1 }, expireAfterSeconds: 0 }
        ]
      },
      async dropIndex (name) {
        dropped.push(name)
      }
    }
    const fakeDb = {
      collection (name) {
        return name === 'Session' ? sessionCollection : { collectionName: name, async createIndexes () {} }
      }
    }

    await ensureOidcIndexes(fakeDb, 'mongodb')

    assert.deepEqual(dropped, ['payload.uid_1'])
    assert.equal(createAttempts, 2)
  })

  it('does not inspect or drop conflicting Cosmos indexes and reports remediation', async () => {
    let indexesCalled = false
    let dropped = false
    const sessionCollection = {
      collectionName: 'Session',
      async createIndexes () {
        const error = new Error('Index already exists with different options')
        error.code = 85
        throw error
      },
      async indexes () {
        indexesCalled = true
        return []
      },
      async dropIndex () {
        dropped = true
      }
    }
    const fakeDb = {
      collection (name) {
        return name === 'Session' ? sessionCollection : { collectionName: name, async createIndexes () {} }
      }
    }

    await assert.rejects(
      ensureOidcIndexes(fakeDb, 'cosmos'),
      /Incompatible index definition in Cosmos DB collection Session; startup will not drop indexes/
    )
    assert.equal(indexesCalled, false)
    assert.equal(dropped, false)
  })

  it('retains TTL options when Cosmos rejects a TTL index instead of silently disabling expiry', async () => {
    const sessionCollection = {
      collectionName: 'Session',
      async createIndexes (indexes) {
        assert.equal(indexes.some((index) => index.key._ts === 1 && 'expireAfterSeconds' in index), true)
        const error = new Error('expireAfterSeconds is not supported')
        error.code = 2
        error.errorResponse = { errmsg: 'expireAfterSeconds is not supported' }
        throw error
      }
    }
    const fakeDb = {
      collection (name) {
        return name === 'Session' ? sessionCollection : { collectionName: name, async createIndexes () {} }
      }
    }

    await assert.rejects(ensureOidcIndexes(fakeDb, 'cosmos'), /expireAfterSeconds is not supported/)
  })

  it('retries without TTL only for the Cosmos DB Emulator backend when it rejects expireAfterSeconds', async () => {
    const calls = []
    const fakeDb = {
      collection (name) {
        return {
          collectionName: name,
          async createIndexes (indexes) {
            calls.push({ name, indexes })
            if (indexes.some((index) => 'expireAfterSeconds' in index)) {
              const error = new Error("The 'expireAfterSeconds' option is currently not supported.")
              error.code = 2
              error.errorResponse = { errmsg: error.message }
              throw error
            }
          }
        }
      }
    }

    await ensureOidcIndexes(fakeDb, 'cosmos-emulator')

    const session = calls.filter(({ name }) => name === 'Session')
    assert.equal(session.length, 2)
    assert.equal(session[1].indexes.some((index) => index.key._ts === 1 && !('expireAfterSeconds' in index)), true)
    assert.equal(session[1].indexes.some((index) => index.key['payload.uid'] === 1), true)
    assert.equal(session[1].indexes.some((index) => index.key.expiresAt === 1), false)
  })

  it('does not inspect or drop conflicting Cosmos DB Emulator indexes', async () => {
    let dropped = false
    const sessionCollection = {
      collectionName: 'Session',
      async createIndexes () {
        const error = new Error('Index already exists with different options')
        error.code = 85
        throw error
      },
      async indexes () { return [] },
      async dropIndex () { dropped = true }
    }
    const fakeDb = {
      collection (name) {
        return name === 'Session' ? sessionCollection : { collectionName: name, async createIndexes () {} }
      }
    }

    await assert.rejects(ensureOidcIndexes(fakeDb, 'cosmos-emulator'), /startup will not drop indexes/)
    assert.equal(dropped, false)
  })

  it('retries ServiceUnavailable and stuck-collection-metadata errors', async () => {
    const transientMessages = [
      'ServiceUnavailable while provisioning the collection',
      "Detected stuck collection metadata for 'Session'."
    ]

    for (const message of transientMessages) {
      let createAttempts = 0
      const fakeDb = {
        collection (name) {
          return {
            collectionName: name,
            async createIndexes () {
              createAttempts += 1
              if (createAttempts === 1) {
                const error = new Error(message)
                error.code = 1
                error.errorResponse = { errmsg: message }
                throw error
              }
            }
          }
        }
      }

      await ensureOidcIndexes(fakeDb, 'cosmos')

      assert.equal(createAttempts, 7)
    }
  })
})

describe('ensureAccountIndexes', () => {
  it('uses MongoDB TTL on authContexts and does not add TTL indexes to accounts', async () => {
    const calls = []
    const fakeDb = {
      collection (name) {
        return {
          collectionName: name,
          async createIndexes (indexes) {
            calls.push({ name, indexes })
          }
        }
      }
    }

    await ensureAccountIndexes(fakeDb, 'mongodb')

    const accountIndexes = calls.find(({ name }) => name === 'accounts').indexes
    const authContextIndexes = calls.find(({ name }) => name === 'authContexts').indexes
    assert.equal(accountIndexes.some((index) => 'expireAfterSeconds' in index), false)
    assert.equal(authContextIndexes.length, 1)
    assert.deepEqual(authContextIndexes[0], {
      key: { createdAt: 1 },
      expireAfterSeconds: config.oidc.ttl.refreshTokenSeconds
    })
  })

  it('uses Cosmos _ts TTL on authContexts and does not add TTL indexes to accounts', async () => {
    const calls = []
    const fakeDb = {
      collection (name) {
        return {
          collectionName: name,
          async createIndexes (indexes) {
            calls.push({ name, indexes })
          }
        }
      }
    }

    await ensureAccountIndexes(fakeDb, 'cosmos')

    const accountIndexes = calls.find(({ name }) => name === 'accounts').indexes
    const authContextIndexes = calls.find(({ name }) => name === 'authContexts').indexes
    assert.equal(accountIndexes.some((index) => 'expireAfterSeconds' in index), false)
    assert.deepEqual(authContextIndexes, [{
      key: { _ts: 1 },
      expireAfterSeconds: config.oidc.ttl.refreshTokenSeconds
    }])
  })

  it('retries without collation when Cosmos DB Emulator rejects the option on the email index', async () => {
    let lastIndexes
    const accountsCollection = {
      collectionName: 'accounts',
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
        return name === 'accounts' ? accountsCollection : { collectionName: name, async createIndexes () {} }
      }
    }

    await ensureAccountIndexes(fakeDb, 'cosmos')

    assert.equal(lastIndexes.some((index) => index.key.email === 1), true)
    assert.equal(lastIndexes.some((index) => 'collation' in index), false)
  })
})
