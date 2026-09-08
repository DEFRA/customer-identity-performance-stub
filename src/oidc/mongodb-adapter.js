import { getDb } from '../db/index.js'

class MongoAdapter {
  /**
   * Create a new MongoAdapter
   * @param {string} name - The collection name
   */
  constructor (name) {
    this.name = name
  }

  /**
   * Upsert a document
   * NOTE: the payload for Session model may contain client_id as keys, make sure you do not use
   *   dots (".") in your client_id value charset.
   * @param {string} _id - The document ID
   * @param {object} payload - The payload to upsert
   * @param {number} expiresIn - The expiration time in seconds
   */
  async upsert (_id, payload, expiresIn) {
    let expiresAt

    if (expiresIn) {
      expiresAt = new Date(Date.now() + (expiresIn * 1000))
    }

    const coll = await this.coll()
    await coll.updateOne(
      { _id },
      { $set: { payload, ...(expiresAt ? { expiresAt } : {}) } },
      { upsert: true }
    )
  }

  /**
   * Find a document by ID
   * @param {string} _id - The document ID
   * @returns {Promise<object|undefined>}
   */
  async find (_id) {
    const coll = await this.coll()
    const result = await coll.find(
      { _id },
      { projection: { payload: 1 } }
    ).limit(1).next()

    if (!result) return undefined
    return result.payload
  }

  /**
   * Find a document by user code
   * @param {string} userCode - The user code
   * @returns {Promise<object|undefined>}
   */
  async findByUserCode (userCode) {
    const coll = await this.coll()
    const result = await coll.find(
      { 'payload.userCode': userCode },
      { projection: { payload: 1 } }
    ).limit(1).next()

    if (!result) return undefined
    return result.payload
  }

  /**
   * Find a document by UID
   * @param {string} uid - The user ID
   * @returns {Promise<object|undefined>}
   */
  async findByUid (uid) {
    const coll = await this.coll()
    const result = await coll.find(
      { 'payload.uid': uid },
      { projection: { payload: 1 } }
    ).limit(1).next()

    if (!result) return undefined
    return result.payload
  }

  /**
   * Destroy a document by ID
   * @param {string} _id - The document ID
   */
  async destroy (_id) {
    const coll = await this.coll()
    await coll.deleteOne({ _id })
  }

  /**
   * Revoke all documents with a given grant ID
   * @param {string} grantId - The grant ID
   */
  async revokeByGrantId (grantId) {
    const coll = await this.coll()
    await coll.deleteMany({ 'payload.grantId': grantId })
  }

  /**
   * Mark a document as consumed
   * @param {string} _id - The document ID
   */
  async consume (_id) {
    const coll = await this.coll()
    await coll.findOneAndUpdate(
      { _id },
      { $set: { 'payload.consumed': Math.floor(Date.now() / 1000) } }
    )
  }

  /**
   * Get a collection reference
   * @param {string} [name=this.name] - The collection name
   * @returns {Promise<object>}
   */
  async coll (name = this.name) {
    const db = await getDb()
    return db.collection(name)
  }
}

export { MongoAdapter }
