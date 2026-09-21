import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { loadAccountsFromFile, seedAccountsFromFile } from '../../../src/db/seed-accounts-from-file.js'

async function withTempFile (content, fn) {
  const dir = mkdtempSync(path.join(tmpdir(), 'seed-accounts-'))
  const filePath = path.join(dir, 'seed.json')
  writeFileSync(filePath, content)
  try {
    return await fn(filePath)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

function fakeCollection (existingSubs = []) {
  const upserted = []
  return {
    upserted,
    async updateOne (filter, update, options) {
      assert.equal(options.upsert, true)
      assert.deepEqual(Object.keys(update), ['$setOnInsert'])
      const alreadyExists = existingSubs.includes(filter.sub)
      if (!alreadyExists) {
        upserted.push(update.$setOnInsert)
      }
      return { upsertedCount: alreadyExists ? 0 : 1 }
    }
  }
}

describe('loadAccountsFromFile', () => {
  it('parses a JSON array of accounts', async () => {
    await withTempFile('[{"sub":"a"},{"sub":"b"}]', (filePath) => {
      assert.deepEqual(loadAccountsFromFile(filePath), [{ sub: 'a' }, { sub: 'b' }])
    })
  })

  it('throws when the file does not exist', () => {
    assert.throws(() => loadAccountsFromFile('/nonexistent/seed.json'), /Could not read SEED_FILE_PATH/)
  })

  it('throws when the file is not valid JSON', async () => {
    await withTempFile('not json', (filePath) => {
      assert.throws(() => loadAccountsFromFile(filePath), /is not valid JSON/)
    })
  })

  it('throws when the file does not contain a JSON array', async () => {
    await withTempFile('{"sub":"a"}', (filePath) => {
      assert.throws(() => loadAccountsFromFile(filePath), /must contain a JSON array/)
    })
  })
})

describe('seedAccountsFromFile', () => {
  it('inserts accounts that do not already exist', async () => {
    await withTempFile('[{"sub":"new-1"},{"sub":"new-2"}]', async (filePath) => {
      const collection = fakeCollection([])
      const fakeDb = { collection: () => collection }

      const result = await seedAccountsFromFile(filePath, fakeDb)

      assert.deepEqual(result, { inserted: 2, total: 2 })
      assert.deepEqual(collection.upserted.map((a) => a.sub), ['new-1', 'new-2'])
    })
  })

  it('leaves existing accounts untouched, only inserting new ones', async () => {
    await withTempFile('[{"sub":"existing"},{"sub":"new"}]', async (filePath) => {
      const collection = fakeCollection(['existing'])
      const fakeDb = { collection: () => collection }

      const result = await seedAccountsFromFile(filePath, fakeDb)

      assert.deepEqual(result, { inserted: 1, total: 2 })
      assert.deepEqual(collection.upserted.map((a) => a.sub), ['new'])
    })
  })

  it('only ever uses $setOnInsert, never $set, so existing documents cannot be modified', async () => {
    await withTempFile('[{"sub":"a"}]', async (filePath) => {
      const collection = fakeCollection([])
      const fakeDb = { collection: () => collection }

      await seedAccountsFromFile(filePath, fakeDb)
    })
  })
})
