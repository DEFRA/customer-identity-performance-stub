/**
 * MongoDB client singleton
 * Provides a single persistent connection to MongoDB for the app lifetime
 */

import { MongoClient } from 'mongodb'
import config from '../config/index.js'

let mongoClient = null
let database = null

/**
 * Get or create the MongoDB database instance
 * @returns {Promise<Db>} MongoDB database instance
 */
export async function getDb () {
  if (database) {
    return database
  }

  if (!mongoClient) {
    mongoClient = new MongoClient(config.db.url, {
      connectTimeoutMS: config.db.timeout,
      serverSelectionTimeoutMS: config.db.timeout
    })
  }

  database = mongoClient.db(config.db.name)
  return database
}

/**
 * Get the underlying MongoClient instance
 * @returns {MongoClient|null} MongoDB client or null if not connected
 */
export function getClient () {
  return mongoClient
}

export default {
  getDb,
  getClient
}
