/**
 * OIDC provider MongoDB index setup, run once at startup
 */

import { getDb } from '../db/index.js'
import { caseInsensitiveCollation } from '../repositories/account-repository.js'

const grantable = new Set([
  'AccessToken',
  'AuthorizationCode',
  'RefreshToken',
])

// Only the models actually reachable given the enabled features in oidc-setup.js
const collectionNames = [
  'Session',
  'AccessToken',
  'AuthorizationCode',
  'RefreshToken',
  'Grant',
  'Interaction',
]

// MongoDB error codes for a pre-existing index with the same name/keys but
// different options (e.g. an older deployment's unique payload.uid_1 index)
const indexConflictCodes = new Set([85, 86])

// Cosmos DB implicitly provisions a container on each collection's first createIndexes
// call, and can respond with a transient ServiceUnavailable if provisioning is briefly
// overloaded - this can happen per-collection, not just for the very first one
const isTransientServiceUnavailable = (error) =>
  error.code === 1 && /ServiceUnavailable/.test(error.errorResponse?.errmsg ?? '')

const maxTransientRetries = 20
const maxRetryDelayMs = 5000

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

// Mirrors MongoDB's default index-naming scheme, needed to find a same-name/different-key
// conflict (error 86) that a key-based lookup alone (error 85) would miss
const autoIndexName = (key) =>
  Object.entries(key).map(([field, direction]) => `${field}_${direction}`).join('_')

// Index options Cosmos DB's older Mongo API wire versions reject; stripped only from
// the offending index and retried, so real MongoDB and newer Cosmos DB for MongoDB
// accounts still get the full behaviour (unique constraint, TTL cleanup)
const stripUnsupportedOption = (error, indexes) => {
  // "Unique and compound indexes do not support nested paths" (CommandNotSupported)
  if (error.code === 115 && indexes.some((index) => index.unique)) {
    return indexes.map(({ unique, ...index }) => index)
  }

  // "The 'expireAfterSeconds' option is currently not supported." (BadValue)
  if (error.code === 2 && indexes.some((index) => 'expireAfterSeconds' in index)) {
    return indexes.map(({ expireAfterSeconds, ...index }) => index)
  }

  return null
}

/**
 * Create indexes on a collection, replacing any pre-existing index that has the same
 * name/keys but conflicting options, and stripping any option Cosmos DB doesn't support
 * @param {import('mongodb').Collection} collection
 * @param {object[]} indexes
 * @param {number} [attempt] - Current retry attempt, used internally for backoff
 * @returns {Promise<void>}
 */
async function createIndexesReplacingConflicts (collection, indexes, attempt = 0) {
  try {
    await collection.createIndexes(indexes)
  } catch (error) {
    if (isTransientServiceUnavailable(error) && attempt < maxTransientRetries) {
      await delay(Math.min(500 * (attempt + 1), maxRetryDelayMs))
      return createIndexesReplacingConflicts(collection, indexes, attempt + 1)
    }

    const strippedIndexes = stripUnsupportedOption(error, indexes)
    if (strippedIndexes) {
      return createIndexesReplacingConflicts(collection, strippedIndexes, attempt)
    }

    if (!indexConflictCodes.has(error.code)) throw error

    const existing = await collection.indexes()
    for (const { key } of indexes) {
      const name = autoIndexName(key)
      const conflicting = existing.find((index) =>
        JSON.stringify(index.key) === JSON.stringify(key) || index.name === name)
      if (conflicting) await collection.dropIndex(conflicting.name)
    }

    await collection.createIndexes(indexes)
  }
}

/**
 * Create the indexes required by the OIDC provider's MongoDB adapter
 * @param {import('mongodb').Db} [db] - Database instance, injectable for testing
 * @returns {Promise<void>}
 */
export async function ensureOidcIndexes (db) {
  db ??= await getDb()

  // sequential, not parallel: Cosmos DB provisions a container per collection on first
  // use, and creating several concurrently can trip its transient ServiceUnavailable
  for (const name of collectionNames) {
    await createIndexesReplacingConflicts(db.collection(name), [
      ...(grantable.has(name)
        ? [{
            key: { 'payload.grantId': 1 },
          }]
        : []),
      ...(name === 'Session'
        ? [{
            key: { 'payload.uid': 1 },
            unique: true,
          }]
        : []),
      {
        key: { expiresAt: 1 },
        expireAfterSeconds: 0,
      },
    ])
  }
}

// Matches oidc-provider's default Grant/RefreshToken/Session TTL (14 days) - the longest-lived
// artifact that could still reference this context's grantId, since ttl isn't overridden here
const authContextTtlSeconds = 60 * 60 * 24 * 14

/**
 * Create the indexes required by the accounts collection and the authContexts collection
 * used to carry serviceId/relationshipId from the authorization request through to claims()
 * @param {import('mongodb').Db} [db] - Database instance, injectable for testing
 * @returns {Promise<void>}
 */
export async function ensureAccountIndexes (db) {
  db ??= await getDb()

  await createIndexesReplacingConflicts(db.collection('accounts'), [
    { key: { sub: 1 }, unique: true },
    { key: { contactId: 1 }, unique: true },
    // sparse: SFI accounts have no uniqueReference at all, so multiple must be able to omit it
    { key: { uniqueReference: 1 }, unique: true, sparse: true },
    { key: { crn: 1 } },
    { key: { email: 1 }, collation: caseInsensitiveCollation },
  ])

  await createIndexesReplacingConflicts(db.collection('authContexts'), [
    { key: { createdAt: 1 }, expireAfterSeconds: authContextTtlSeconds },
  ])
}
