/**
 * OIDC provider MongoDB index setup, run once at startup
 */

import { getDb } from '../db/index.js'
import { caseInsensitiveCollation } from '../repositories/account-repository.js'
import config from '../config/index.js'
import logger from '../logging/logger.js'

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

  // Catch both Cosmos DB TTL variations (BadValue / Code 2)
  if (error.code === 2 && indexes.some((index) => 'expireAfterSeconds' in index)) {
    const errMsg = error.errorResponse?.errmsg ?? '';
    if (
      /expireAfterSeconds/.test(errMsg) || 
      /TTL index is already set up/.test(errMsg)
    ) {
      return indexes.map(({ expireAfterSeconds, ...index }) => index);
    }
  }

  // "collation" (InvalidIndexSpecificationOption) - Cosmos DB Emulator doesn't support custom
  // collations; email lookups fall back to an exact-match index there (see account-repository.js)
  if (error.code === 197 && indexes.some((index) => 'collation' in index)) {
    return indexes.map(({ collation, ...index }) => index)
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
    logger.info(`mongo indexes created successfully for collection ${collection.collectionName}`)
  } catch (error) {
    logger.warn(`mongo indexes creation error for collection ${collection.collectionName}: ${error} - code will retry with best effort`)

    // Handle transient service unavailabilities
    if (isTransientServiceUnavailable(error) && attempt < maxTransientRetries) {
      await delay(Math.min(500 * (attempt + 1), maxRetryDelayMs))
      return createIndexesReplacingConflicts(collection, indexes, attempt + 1)
    }

    // Handle unsupported engine options 
    const strippedIndexes = stripUnsupportedOption(error, indexes)
    if (strippedIndexes) {
      return createIndexesReplacingConflicts(collection, strippedIndexes, attempt)
    }

    // If it's not a conflict code we know how to fix, bubble it up
    if (!indexConflictCodes.has(error.code)) throw error

    // Resolve index conflicts by dropping the conflicting index
    const existing = await collection.indexes()
    for (const { key } of indexes) {
      const name = autoIndexName(key)
      const conflicting = existing.find((index) =>
        JSON.stringify(index.key) === JSON.stringify(key) || index.name === name)
      if (conflicting) {
        logger.info(`Dropping conflicting index ${conflicting.name} from collection ${collection.collectionName}`)
        await collection.dropIndex(conflicting.name)
      }
    }

    // Short delay and recurse back to the try/catch block safely
    if (attempt < maxTransientRetries) {
      await delay(Math.min(500 * (attempt + 1), maxRetryDelayMs))
      return createIndexesReplacingConflicts(collection, indexes, attempt + 1)
    }

    logger.error(`Index creation completely failed for collection ${collection.collectionName} after exhausting retries. Error: ${error}`)
  }
}

// Cosmos DB's Mongo API only supports TTL indexes on its internal _ts (last-modified) field,
// not arbitrary fields like expiresAt/createdAt - this ceiling is a Cosmos-only safety net for
// any document that ends up without a per-document ttl override (see mongodb-adapter.js).
// On real MongoDB, _ts is never populated, so this index is a harmless no-op there.
// NOTE: observed unreliable in practice on the Linux Cosmos DB Emulator specifically - expired
// documents can persist well past both the per-document ttl and this fallback ceiling. Not
// verified against a real Azure Cosmos DB for MongoDB account, which should honour it correctly.
const cosmosFallbackTtlSeconds = 60 * 60 * 24 * 30

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
      {
        key: { _ts: 1 },
        expireAfterSeconds: cosmosFallbackTtlSeconds,
      },
    ])
  }
}

// Matches oidc-provider's Grant TTL (see oidc-setup.js), the longest-lived artifact that
// could still reference this context's grantId, even though Session/RefreshToken are
// shorter-lived to mirror the real Defra CIDM B2C policy
const authContextTtlSeconds = config.oidc.ttl.refreshTokenSeconds

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
    { key: { email: 1 }, unique: true, collation: caseInsensitiveCollation },
  ])

  await createIndexesReplacingConflicts(db.collection('authContexts'), [
    { key: { createdAt: 1 }, expireAfterSeconds: authContextTtlSeconds },
    // Cosmos DB-only fallback - see cosmosFallbackTtlSeconds above, inert on real MongoDB
    { key: { _ts: 1 }, expireAfterSeconds: authContextTtlSeconds },
  ])
}
