/**
 * MongoDB connection lifecycle management
 */

import { getDb } from './client.js'
import logger from '../logging/logger.js'

/**
 * Connect to MongoDB with error handling
 * @returns {Promise<void>}
 */
export async function connect () {
  try {
    // Initialize connection by accessing the database
    const db = await getDb()

    // Verify connection with a simple ping
    await db.admin().ping()
    logger.info('Connected to MongoDB successfully')
  } catch (error) {
    logger.error({ err: error }, 'Failed to connect to MongoDB')
    throw error
  }
}

/**
 * Disconnect from MongoDB gracefully
 * @returns {Promise<void>}
 */
export async function disconnect () {
  try {
    const { getClient } = await import('./client.js')
    const client = getClient()
    if (client) {
      await client.close()
      logger.info('Disconnected from MongoDB')
    }
  } catch (error) {
    logger.error({ err: error }, 'Error disconnecting from MongoDB')
  }
}

export default {
  connect,
  disconnect
}
