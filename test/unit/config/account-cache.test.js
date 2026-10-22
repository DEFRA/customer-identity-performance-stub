import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

const settingNames = [
  'ACCOUNT_CACHE_MAX_ENTRIES',
  'ACCOUNT_CACHE_TTL_MS',
  'AUTH_CONTEXT_CACHE_MAX_ENTRIES',
  'MONGO_BACKEND'
]
let importCount = 0

async function loadConfigWithSettings (settings) {
  const originalValues = Object.fromEntries(settingNames.map((name) => [name, process.env[name]]))

  for (const name of settingNames) {
    if (settings[name] === undefined) {
      delete process.env[name]
    } else {
      process.env[name] = settings[name]
    }
  }

  try {
    const configUrl = new URL(`../../../src/config/index.js?test=${importCount++}`, import.meta.url)
    return (await import(configUrl.href)).default
  } finally {
    for (const name of settingNames.filter((name) => name !== 'MONGO_BACKEND')) {
      if (originalValues[name] === undefined) {
        delete process.env[name]
      } else {
        process.env[name] = originalValues[name]
      }
    }
  }
}

describe('cache configuration', () => {
  it('uses the default capacity and TTL values when settings are unset', async () => {
    const config = await loadConfigWithSettings({})

    assert.deepEqual(config.accountCache, {
      maxEntries: 1000,
      ttlMs: 30_000
    })
    assert.deepEqual(config.authContextCache, {
      maxEntries: 1000
    })
    assert.equal(config.db.mongoBackend, 'mongodb')
  })

  it('uses configured positive integer capacity and TTL values', async () => {
    const config = await loadConfigWithSettings({
      ACCOUNT_CACHE_MAX_ENTRIES: '2500',
      ACCOUNT_CACHE_TTL_MS: '90000',
      AUTH_CONTEXT_CACHE_MAX_ENTRIES: '5000'
    })

    assert.deepEqual(config.accountCache, {
      maxEntries: 2500,
      ttlMs: 90_000
    })
    assert.deepEqual(config.authContextCache, {
      maxEntries: 5000
    })
  })

  it('rejects non-positive, non-integer, and unsafe values for every cache setting', async () => {
    const invalidValues = ['0', '-1', '1.5', 'invalid', '9007199254740992']

    for (const name of settingNames.filter((name) => name !== 'MONGO_BACKEND')) {
      for (const value of invalidValues) {
        await assert.rejects(
          loadConfigWithSettings({ [name]: value }),
          new RegExp(`${name} must be a positive integer`)
        )
      }
    }
  })

  it('selects the Cosmos backend case-insensitively', async () => {
    const config = await loadConfigWithSettings({ MONGO_BACKEND: '  COSMOS  ' })

    assert.equal(config.db.mongoBackend, 'cosmos')
  })

  it('selects the Cosmos DB Emulator backend', async () => {
    const config = await loadConfigWithSettings({ MONGO_BACKEND: 'Cosmos-Emulator' })

    assert.equal(config.db.mongoBackend, 'cosmos-emulator')
  })

  it('rejects unsupported MongoDB backend values', async () => {
    await assert.rejects(
      loadConfigWithSettings({ MONGO_BACKEND: 'documentdb' }),
      /MONGO_BACKEND must be one of 'mongodb', 'cosmos' or 'cosmos-emulator'/
    )
  })
})
