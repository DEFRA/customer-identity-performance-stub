/**
 * Account service
 * CRUD operations for accounts
 */

import { ObjectId } from 'mongodb'
import { getDb } from '../db/client.js'

const COLLECTION_NAME = 'accounts'

/**
 * Get or create the accounts collection
 * @returns {Promise<Collection>}
 */
async function getCollection () {
  const db = await getDb()
  return db.collection(COLLECTION_NAME)
}

/**
 * Create a new account
 * @param {object} account - Account data
 * @returns {Promise<object>} Created account with _id
 */
export async function create (account) {
  const collection = await getCollection()
  const result = await collection.insertOne({
    ...account,
    createdAt: new Date(),
    updatedAt: new Date()
  })
  return { _id: result.insertedId, ...account }
}

/**
 * Find account by ID
 * @param {string|ObjectId} id - Account ID
 * @returns {Promise<object|null>} Account or null if not found
 */
export async function findById (id) {
  const collection = await getCollection()
  const objectId = typeof id === 'string' ? new ObjectId(id) : id
  return collection.findOne({ _id: objectId })
}

/**
 * Find all accounts
 * @returns {Promise<array>} Array of accounts
 */
export async function findAll () {
  const collection = await getCollection()
  return collection.find({}).toArray()
}

/**
 * Update an account
 * @param {string|ObjectId} id - Account ID
 * @param {object} updates - Fields to update
 * @returns {Promise<object>} Updated account
 */
export async function update (id, updates) {
  const collection = await getCollection()
  const objectId = typeof id === 'string' ? new ObjectId(id) : id
  const result = await collection.findOneAndUpdate(
    { _id: objectId },
    { $set: { ...updates, updatedAt: new Date() } },
    { returnDocument: 'after' }
  )
  return result.value
}

/**
 * Delete an account
 * @param {string|ObjectId} id - Account ID
 * @returns {Promise<boolean>} True if the account was deleted
 */
export async function deleteById (id) {
  const collection = await getCollection()
  const objectId = typeof id === 'string' ? new ObjectId(id) : id
  const result = await collection.deleteOne({ _id: objectId })
  return result.deletedCount > 0
}

export default {
  create,
  findById,
  findAll,
  update,
  deleteById
}
