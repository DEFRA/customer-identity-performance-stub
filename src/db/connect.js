/**
 * MongoDB connection lifecycle management
 */

import { getDb } from './client.js'

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
    console.log('Connected to MongoDB successfully')
  } catch (error) {
    console.error('Failed to connect to MongoDB:', error.message)
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
      console.log('Disconnected from MongoDB')
    }
  } catch (error) {
    console.error('Error disconnecting from MongoDB:', error.message)
  }
}

export default {
  connect,
  disconnect
}
