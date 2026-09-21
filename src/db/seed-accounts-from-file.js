/**
 * Startup seed file loader - inserts accounts from a JSON file into the accounts collection
 * without overwriting anything already there (per-account upsert keyed by sub, insert-only).
 */

import { readFileSync } from 'node:fs'
import { getDb } from './client.js'
import logger from '../logging/logger.js'

/**
 * @param {string} path
 * @returns {object[]} Parsed account documents
 */
export function loadAccountsFromFile (path) {
  let raw
  try {
    raw = readFileSync(path, 'utf-8')
  } catch (error) {
    throw new Error(`Could not read SEED_FILE_PATH "${path}": ${error.message}`, { cause: error })
  }

  let accounts
  try {
    accounts = JSON.parse(raw)
  } catch (error) {
    throw new Error(`SEED_FILE_PATH "${path}" is not valid JSON: ${error.message}`, { cause: error })
  }

  if (!Array.isArray(accounts)) {
    throw new Error(`SEED_FILE_PATH "${path}" must contain a JSON array of account documents`)
  }

  return accounts
}

/**
 * Inserts any accounts from the file that don't already exist (matched by sub). Existing
 * accounts are left completely untouched - $setOnInsert only ever applies on insert.
 * @param {string} path
 * @param {import('mongodb').Db} [db] - Database instance, injectable for testing
 * @returns {Promise<{ inserted: number, total: number }>}
 */
export async function seedAccountsFromFile (path, db) {
  db ??= await getDb()
  const accounts = loadAccountsFromFile(path)
  const collection = db.collection('accounts')

  let inserted = 0
  for (const account of accounts) {
    const result = await collection.updateOne(
      { sub: account.sub },
      { $setOnInsert: { ...account, createdAt: new Date(), updatedAt: new Date() } },
      { upsert: true }
    )
    if (result.upsertedCount > 0) {
      inserted += 1
    }
  }

  logger.info(`Seed file ${path}: inserted ${inserted} of ${accounts.length} account(s) (${accounts.length - inserted} already existed)`)

  return { inserted, total: accounts.length }
}

export default { loadAccountsFromFile, seedAccountsFromFile }
