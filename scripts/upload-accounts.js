#!/usr/bin/env node
/**
 * Pushes data/accounts.development.json (or a given file) into the accounts collection of
 * whichever MongoDB the app's own MONGO_URL/.env points at. Unlike the startup SEED_FILE_PATH
 * mechanism, this always overwrites existing accounts (matched by sub) with the file's current
 * contents, so it's meant for iterating on local seed data - not for production seeding.
 *
 * Usage:
 *   node scripts/upload-accounts.js [path/to/accounts.json] [--wipe]
 *
 *   --wipe   Delete all documents in the accounts collection first, for a completely fresh load
 */

import 'dotenv/config'
import { loadAccountsFromFile } from '../src/db/seed-accounts-from-file.js'
import { getDb, getClient } from '../src/db/client.js'

const args = process.argv.slice(2)
const wipe = args.includes('--wipe')
const path = args.find((arg) => !arg.startsWith('--')) ?? 'data/accounts.development.json'

const accounts = loadAccountsFromFile(path)
const db = await getDb()
const collection = db.collection('accounts')

if (wipe) {
  const { deletedCount } = await collection.deleteMany({})
  console.log(`Wiped ${deletedCount} existing account(s)`)
}

let inserted = 0
let updated = 0

for (const account of accounts) {
  const result = await collection.updateOne(
    { sub: account.sub },
    {
      $set: { ...account, updatedAt: new Date() },
      $setOnInsert: { createdAt: new Date() }
    },
    { upsert: true }
  )

  if (result.upsertedCount > 0) {
    inserted += 1
  } else if (result.modifiedCount > 0) {
    updated += 1
  }
}

console.log(`${path}: inserted ${inserted}, updated ${updated}, unchanged ${accounts.length - inserted - updated} (${accounts.length} total)`)

await getClient()?.close()
