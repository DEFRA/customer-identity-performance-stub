/**
 * Auth context repository
 * Carries serviceId/relationshipId from the authorization request through to claims(),
 * since oidc-provider only re-exposes the grantId (not the original extraParams) at token
 * issuance time. Keyed by grantId, which is stable across a grant's access/refresh tokens.
 */

import { createCache } from '../cache/cache.js'
import config from '../config/index.js'
import { getDb } from '../db/client.js'

const COLLECTION_NAME = 'authContexts'

/**
 * Create an auth context repository
 * @param {object} [options]
 * @param {Function} [options.getDb]
 * @param {object} [options.cache]
 * @param {number} [options.ttlSeconds]
 * @returns {object}
 */
export function createAuthContextRepository ({
  getDb: getDatabase = getDb,
  cache = createCache({ maxEntries: config.authContextCache.maxEntries }),
  ttlSeconds = config.oidc.ttl.refreshTokenSeconds
} = {}) {
  async function getCollection () {
    const db = await getDatabase()
    return db.collection(COLLECTION_NAME)
  }

  /**
   * Save the serviceId/relationshipId requested for a grant
   * @param {string} grantId
   * @param {object} context
   * @param {string} [context.serviceId]
   * @param {string} [context.relationshipId]
   * @returns {Promise<void>}
   */
  async function save (grantId, { serviceId, relationshipId } = {}) {
    const collection = await getCollection()
    // omit absent fields entirely - the mongodb driver serializes `undefined` values as BSON
    // null, which would make findByGrantId's result fail the `=== undefined` check downstream
    const fields = { createdAt: new Date() }
    if (serviceId !== undefined) fields.serviceId = serviceId
    if (relationshipId !== undefined) fields.relationshipId = relationshipId

    await collection.updateOne(
      { _id: grantId },
      { $set: fields },
      { upsert: true }
    )
    cache.delete(grantId)
  }

  /**
   * Find context for a grant, caching it only until its grant lifetime expires
   * @param {string} grantId
   * @returns {Promise<object|null>}
   */
  async function findByGrantId (grantId) {
    const cachedContext = cache.get(grantId)
    if (cachedContext !== undefined) {
      return cachedContext
    }

    const collection = await getCollection()
    const context = await collection.findOne({ _id: grantId })
    if (context?.createdAt instanceof Date) {
      const remainingTtlMs = context.createdAt.getTime() + (ttlSeconds * 1000) - Date.now()
      if (Number.isFinite(remainingTtlMs) && remainingTtlMs > 0) {
        cache.set(grantId, context, { ttlMs: remainingTtlMs })
      }
    }
    return context
  }

  return {
    save,
    findByGrantId
  }
}

const authContextRepository = createAuthContextRepository()

export const save = authContextRepository.save
export const findByGrantId = authContextRepository.findByGrantId

export default {
  save,
  findByGrantId
}
