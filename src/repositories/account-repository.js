/**
 * Account repository
 * CRUD operations for accounts (data access layer)
 */

import { ObjectId } from 'mongodb'
import { createCache } from '../cache/cache.js'
import config from '../config/index.js'
import { getDb } from '../db/client.js'

const COLLECTION_NAME = 'accounts'

// Shared with the email index's collation in ensure-indexes.js - a query's collation must
// match an index's collation exactly for MongoDB to use that index for it
export const caseInsensitiveCollation = { locale: 'en', strength: 2 }

/**
 * Create an account repository
 * @param {object} [options]
 * @param {Function} [options.getDb] - Database getter, injectable for testing
 * @param {object} [options.cache] - Cache instance, injectable for testing
 * @returns {object}
 */
export function createAccountRepository ({
  getDb: getDatabase = getDb,
  cache = createCache({ maxEntries: config.accountCache.maxEntries })
} = {}) {
  /**
   * Get or create the accounts collection
   * @returns {Promise<Collection>}
   */
  async function getCollection () {
    const db = await getDatabase()
    return db.collection(COLLECTION_NAME)
  }

  function accountCacheKey (id) {
    return `account:${id}`
  }

  function lookupCacheKey (type, value) {
    return `lookup:${type}:${value}`
  }

  function cacheAccount (account, lookupKey) {
    if (!(account?._id instanceof ObjectId)) {
      return
    }

    const id = account._id.toHexString()
    const options = { ttlMs: config.accountCache.ttlMs }
    cache.set(accountCacheKey(id), account, options)

    if (typeof account.sub === 'string') {
      cache.set(lookupCacheKey('sub', account.sub), id, options)
    }
    if (typeof account.email === 'string') {
      cache.set(lookupCacheKey('email', account.email), id, options)
    }
    if (lookupKey) {
      cache.set(lookupKey, id, options)
    }
  }

  function invalidateAccount (id) {
    const objectId = typeof id === 'string' ? new ObjectId(id) : id
    if (objectId instanceof ObjectId) {
      cache.delete(accountCacheKey(objectId.toHexString()))
    }
  }

  function invalidateAccountLookups (account) {
    if (typeof account?.sub === 'string') {
      cache.delete(lookupCacheKey('sub', account.sub))
    }
    if (typeof account?.email === 'string') {
      cache.delete(lookupCacheKey('email', account.email))
      cache.delete(lookupCacheKey('login', account.email))
    }
    if (typeof account?.crn === 'string') {
      cache.delete(lookupCacheKey('login', account.crn))
    }
  }

  async function findCachedAccountByLookup (key, find) {
    const cachedId = cache.get(key)
    if (cachedId !== undefined) {
      const cachedAccount = cache.get(accountCacheKey(cachedId))
      if (cachedAccount !== undefined) {
        return cachedAccount
      }

      cache.delete(key)
    }

    const account = await find()
    if (account) {
      cacheAccount(account, key)
    }
    return account
  }

  /**
   * Create a new account
   * @param {object} account - Account data
   * @returns {Promise<object>} Created account with _id
   */
  async function create (account) {
    const collection = await getCollection()
    const document = {
      ...account,
      createdAt: new Date(),
      updatedAt: new Date()
    }
    const result = await collection.insertOne(document)
    invalidateAccountLookups(document)
    return { ...document, _id: result.insertedId }
  }

  /**
   * Find account by ID
   * @param {string|ObjectId} id - Account ID
   * @returns {Promise<object|null>} Account or null if not found
   */
  async function findById (id) {
    const objectId = typeof id === 'string' ? new ObjectId(id) : id

    if (!(objectId instanceof ObjectId)) {
      const collection = await getCollection()
      return collection.findOne({ _id: objectId })
    }

    const key = accountCacheKey(objectId.toHexString())
    const cachedAccount = cache.get(key)
    if (cachedAccount !== undefined) {
      return cachedAccount
    }

    const collection = await getCollection()
    const account = await collection.findOne({ _id: objectId })
    if (account) {
      cacheAccount(account)
    }
    return account
  }

  /**
   * Find all accounts
   * @returns {Promise<array>} Array of accounts
   */
  async function findAll () {
    const collection = await getCollection()
    return collection.find({}).toArray()
  }

  /**
   * Update an account
   * @param {string|ObjectId} id - Account ID
   * @param {object} updates - Fields to update
   * @returns {Promise<object>} Updated account
   */
  async function update (id, updates) {
    const collection = await getCollection()
    const objectId = typeof id === 'string' ? new ObjectId(id) : id
    const existingAccount = await collection.findOne({ _id: objectId })
    const updatedAccount = await collection.findOneAndUpdate(
      { _id: objectId },
      { $set: { ...updates, updatedAt: new Date() } },
      { returnDocument: 'after' }
    )
    if (updatedAccount) {
      invalidateAccount(objectId)
      invalidateAccountLookups(existingAccount)
      invalidateAccountLookups(updatedAccount)
    }
    return updatedAccount
  }

  /**
   * Delete an account
   * @param {string|ObjectId} id - Account ID
   * @returns {Promise<boolean>} True if the account was deleted
   */
  async function deleteById (id) {
    const collection = await getCollection()
    const objectId = typeof id === 'string' ? new ObjectId(id) : id
    const existingAccount = await collection.findOne({ _id: objectId })
    const result = await collection.deleteOne({ _id: objectId })
    if (result.deletedCount > 0) {
      invalidateAccount(objectId)
      invalidateAccountLookups(existingAccount)
    }
    return result.deletedCount > 0
  }

  /**
   * Find an account by its token subject identifier
   * @param {string} sub - Account sub claim
   * @returns {Promise<object|null>} Account or null if not found
   */
  async function findBySub (sub) {
    if (typeof sub !== 'string') {
      const collection = await getCollection()
      return collection.findOne({ sub })
    }

    return findCachedAccountByLookup(lookupCacheKey('sub', sub), async () => {
      const collection = await getCollection()
      return collection.findOne({ sub })
    })
  }

  /**
   * Find an account by email address, using the account email index's collation
   * @param {string} email
   * @returns {Promise<object|null>}
   */
  async function findByEmail (email) {
    return findCachedAccountByLookup(lookupCacheKey('email', email), async () => {
      const collection = await getCollection()
      return collection.findOne({ email }, { collation: caseInsensitiveCollation })
    })
  }

  /**
   * Replace or create an account identified by its subject
   * @param {string} sub
   * @param {object} account
   * @returns {Promise<object|null>}
   */
  async function replaceBySub (sub, account) {
    const collection = await getCollection()
    const existingAccount = await collection.findOne({ sub })
    const replacement = { ...account, sub }
    delete replacement._id

    const now = new Date()
    replacement.createdAt = existingAccount?.createdAt ?? now
    replacement.updatedAt = now

    const replacedAccount = await collection.findOneAndReplace(
      { sub },
      replacement,
      { upsert: true, returnDocument: 'after' }
    )

    invalidateAccountLookups(existingAccount)
    invalidateAccountLookups(replacedAccount)
    if (existingAccount?._id) {
      invalidateAccount(existingAccount._id)
    }
    if (replacedAccount?._id) {
      invalidateAccount(replacedAccount._id)
    }
    return replacedAccount
  }

  /**
   * Apply a shallow update to an account identified by its subject
   * @param {string} sub
   * @param {object} fields
   * @returns {Promise<object|null>}
   */
  async function patchBySub (sub, fields) {
    const collection = await getCollection()
    const existingAccount = await collection.findOne({ sub })
    if (!existingAccount) {
      return null
    }

    const updatedAccount = await collection.findOneAndUpdate(
      { sub },
      { $set: { ...fields, updatedAt: new Date() } },
      { returnDocument: 'after' }
    )
    if (updatedAccount) {
      invalidateAccount(existingAccount._id)
      invalidateAccountLookups(existingAccount)
      invalidateAccountLookups(updatedAccount)
    }
    return updatedAccount
  }

  /**
   * Delete an account by its subject
   * @param {string} sub
   * @returns {Promise<object|null>} Deleted account or null
   */
  async function deleteBySub (sub) {
    const collection = await getCollection()
    const deletedAccount = await collection.findOneAndDelete({ sub })
    if (deletedAccount) {
      invalidateAccount(deletedAccount._id)
      invalidateAccountLookups(deletedAccount)
    }
    return deletedAccount
  }

  /**
   * Find an account by the identifier entered at login (email, case-insensitive, or CRN)
   * @param {string} identifier - Submitted email address or CRN
   * @returns {Promise<object|null>} Account or null if not found
   */
  async function findByLoginIdentifier (identifier) {
    const find = async () => {
      const collection = await getCollection()
      return collection.findOne(
        { $or: [{ email: identifier }, { crn: identifier }] },
        { collation: caseInsensitiveCollation }
      )
    }

    if (typeof identifier !== 'string') {
      return find()
    }

    return findCachedAccountByLookup(lookupCacheKey('login', identifier), find)
  }

  function clearCache () {
    cache.clear()
  }

  return {
    create,
    findById,
    findAll,
    update,
    deleteById,
    findBySub,
    findByEmail,
    findByLoginIdentifier,
    replaceBySub,
    patchBySub,
    deleteBySub,
    clearCache
  }
}

const accountRepository = createAccountRepository()

export const create = accountRepository.create
export const findById = accountRepository.findById
export const findAll = accountRepository.findAll
export const update = accountRepository.update
export const deleteById = accountRepository.deleteById
export const findBySub = accountRepository.findBySub
export const findByEmail = accountRepository.findByEmail
export const findByLoginIdentifier = accountRepository.findByLoginIdentifier
export const replaceBySub = accountRepository.replaceBySub
export const patchBySub = accountRepository.patchBySub
export const deleteBySub = accountRepository.deleteBySub
export const clearCache = accountRepository.clearCache

export default accountRepository
