/**
 * Auth context repository
 * Carries serviceId/relationshipId from the authorization request through to claims(),
 * since oidc-provider only re-exposes the grantId (not the original extraParams) at token
 * issuance time. Keyed by grantId, which is stable across a grant's access/refresh tokens.
 */

import { getDb } from '../db/client.js'

const COLLECTION_NAME = 'authContexts'

/**
 * @returns {Promise<Collection>}
 */
async function getCollection () {
  const db = await getDb()
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
export async function save (grantId, { serviceId, relationshipId } = {}) {
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
}

/**
 * @param {string} grantId
 * @returns {Promise<object|null>}
 */
export async function findByGrantId (grantId) {
  const collection = await getCollection()
  return collection.findOne({ _id: grantId })
}

export default {
  save,
  findByGrantId
}
