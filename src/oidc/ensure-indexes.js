/**
 * OIDC provider MongoDB index setup, run once at startup
 */

import { getDb } from '../db/index.js'
import { caseInsensitiveCollation } from '../repositories/account-repository.js'
import config from '../config/index.js'
import logger from '../logging/logger.js'
import { isDeepStrictEqual } from 'node:util'

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

// Cosmos DB can return either error while collection metadata is being provisioned or repaired.
const isTransientMetadataError = (error) =>
  error.code === 1 &&
  /ServiceUnavailable|Detected stuck collection metadata/.test(error.errorResponse?.errmsg ?? error.message)

const maxIndexRetries = 20
const maxRetryDelayMs = 5000

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

// Mirrors MongoDB's default index-naming scheme, needed to find a same-name/different-key
// conflict (error 86) that a key-based lookup alone (error 85) would miss
const autoIndexName = (key) =>
  Object.entries(key).map(([field, direction]) => `${field}_${direction}`).join('_')

// Index options rejected by a particular Cosmos DB endpoint; remove only the unsupported
// option from affected indexes, without weakening unrelated index definitions.
const stripUnsupportedOption = (error, indexes, backend) => {
  // "Unique and compound indexes do not support nested paths" (CommandNotSupported)
  if (error.code === 115 && indexes.some((index) => index.unique)) {
    const strippedIndexes = indexes.map((index) => {
      if (index.unique && Object.keys(index.key).some((field) => field.includes('.'))) {
        const { unique, ...supportedIndex } = index
        return supportedIndex
      }
      return index
    })
    return strippedIndexes.some((index, position) => index !== indexes[position])
      ? strippedIndexes
      : null
  }

  // The Linux/WSL2 Cosmos DB Emulator rejects TTL even on _ts; real Cosmos DB must keep it, so
  // only the emulator backend falls back to no TTL (expired documents are not cleaned up)
  if (
    backend === 'cosmos-emulator' &&
    error.code === 2 &&
    /expireAfterSeconds|TTL index/.test(error.errorResponse?.errmsg ?? error.message) &&
    indexes.some((index) => 'expireAfterSeconds' in index)
  ) {
    logger.warn('Cosmos DB Emulator rejected the TTL index - expired documents will not be removed automatically')
    return indexes.map((index) => {
      if (!('expireAfterSeconds' in index)) return index
      const { expireAfterSeconds, ...supportedIndex } = index
      return supportedIndex
    })
  }

  // "collation" (InvalidIndexSpecificationOption) - Cosmos DB Emulator doesn't support custom
  // collations; email lookups fall back to an exact-match index there (see account-repository.js)
  if (error.code === 197 && indexes.some((index) => 'collation' in index)) {
    return indexes.map((index) => {
      if (!('collation' in index)) return index
      const { collation, ...supportedIndex } = index
      return supportedIndex
    })
  }

  return null
}

const comparableIndexOptions = [
  'unique',
  'sparse',
  'expireAfterSeconds',
  'collation',
  'partialFilterExpression'
]

const indexOptionsMatch = (existing, requested) =>
  comparableIndexOptions.every((option) => {
    if (option === 'unique' || option === 'sparse') {
      return Boolean(existing[option]) === Boolean(requested[option])
    }
    return isDeepStrictEqual(existing[option], requested[option])
  })

const getConflictingIndex = (requestedIndexes, existingIndexes, error) => {
  const conflicts = []

  for (const requested of requestedIndexes) {
    const name = requested.name ?? autoIndexName(requested.key)
    for (const existing of existingIndexes) {
      const sameName = existing.name === name
      const sameKey = isDeepStrictEqual(existing.key, requested.key)

      if ((sameName || sameKey) && (!sameKey || !indexOptionsMatch(existing, requested))) {
        conflicts.push(existing)
      }
    }
  }

  const errorMessage = error.errorResponse?.errmsg ?? error.message
  const namedConflict = errorMessage.match(/index with name:\s*([^\s]+)/i)?.[1]
  return conflicts.find((index) => index.name === namedConflict) ?? conflicts[0]
}

/**
 * Create indexes on a collection, replacing any pre-existing index that has the same
 * name/keys but conflicting options on MongoDB. Cosmos DB conflicts are never dropped
 * automatically because index operations can leave collection metadata stuck.
 * @param {import('mongodb').Collection} collection
 * @param {object[]} indexes
 * @param {'mongodb'|'cosmos'|'cosmos-emulator'} backend
 * @param {number} [attempt] - Current retry attempt, used internally for backoff
 * @returns {Promise<void>}
 */
async function createIndexesReplacingConflicts (collection, indexes, backend, attempt = 0) {
  try {
    await collection.createIndexes(indexes)
    logger.info(`mongo indexes created successfully for collection ${collection.collectionName}`)
  } catch (error) {
    logger.warn(`database indexes creation error for collection ${collection.collectionName}: ${error}`)

    if (isTransientMetadataError(error)) {
      if (attempt >= maxIndexRetries) {
        throw new Error(
          `Index creation for collection ${collection.collectionName} failed after ${maxIndexRetries} retries due to transient Cosmos DB metadata errors`,
          { cause: error }
        )
      }
      await delay(Math.min(500 * (attempt + 1), maxRetryDelayMs))
      return createIndexesReplacingConflicts(collection, indexes, backend, attempt + 1)
    }

    // Handle unsupported engine options
    const strippedIndexes = stripUnsupportedOption(error, indexes, backend)
    if (strippedIndexes) {
      return createIndexesReplacingConflicts(collection, strippedIndexes, backend, attempt)
    }

    // If it's not a conflict code we know how to fix, bubble it up
    if (!indexConflictCodes.has(error.code)) throw error

    if (backend !== 'mongodb') {
      throw new Error(
        `Incompatible index definition in Cosmos DB collection ${collection.collectionName}; startup will not drop indexes. Resolve the existing index in Cosmos DB before restarting.`,
        { cause: error }
      )
    }

    // MongoDB supports safe repair, but only drop the index identified as conflicting.
    const existing = await collection.indexes()
    const conflicting = getConflictingIndex(indexes, existing, error)
    if (!conflicting) throw error

    logger.info(`Dropping conflicting index ${conflicting.name} from collection ${collection.collectionName}`)
    await collection.dropIndex(conflicting.name)

    // Short delay and recurse back to the try/catch block safely
    if (attempt < maxIndexRetries) {
      await delay(Math.min(500 * (attempt + 1), maxRetryDelayMs))
      return createIndexesReplacingConflicts(collection, indexes, backend, attempt + 1)
    }

    throw new Error(
      `Index creation for collection ${collection.collectionName} failed after ${maxIndexRetries} retries`,
      { cause: error }
    )
  }
}

// Cosmos DB's Mongo API supports TTL indexes on its internal _ts (last-modified) field.
// Per-document TTL values override this fallback for OIDC documents (see mongodb-adapter.js).
const cosmosFallbackTtlSeconds = 60 * 60 * 24 * 30

/**
 * Create the indexes required by the OIDC provider's MongoDB adapter
 * @param {import('mongodb').Db} [db] - Database instance, injectable for testing
 * @returns {Promise<void>}
 */
export async function ensureOidcIndexes (db, backend = config.db.mongoBackend) {
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
      backend !== 'mongodb'
        ? {
            key: { _ts: 1 },
            expireAfterSeconds: cosmosFallbackTtlSeconds
          }
        : {
            key: { expiresAt: 1 },
            expireAfterSeconds: 0
          }
    ], backend)
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
export async function ensureAccountIndexes (db, backend = config.db.mongoBackend) {
  db ??= await getDb()

  await createIndexesReplacingConflicts(db.collection('accounts'), [
    { key: { sub: 1 }, unique: true },
    { key: { contactId: 1 }, unique: true },
    // sparse: SFI accounts have no uniqueReference at all, so multiple must be able to omit it
    { key: { uniqueReference: 1 }, unique: true, sparse: true },
    { key: { crn: 1 } },
    { key: { email: 1 }, unique: true, collation: caseInsensitiveCollation },
  ], backend)

  await createIndexesReplacingConflicts(db.collection('authContexts'), [
    backend !== 'mongodb'
      ? { key: { _ts: 1 }, expireAfterSeconds: authContextTtlSeconds }
      : { key: { createdAt: 1 }, expireAfterSeconds: authContextTtlSeconds }
  ], backend)
}
