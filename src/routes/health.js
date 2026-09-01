/**
 * Health check routes
 * Liveness and readiness probes for container orchestration
 */

import { getDb } from '../db/index.js'

/**
 * Liveness probe - checks if process is running
 * Used by container orchestration to verify the process is alive
 */
export const livenessRoute = {
  method: 'GET',
  path: '/health/live',
  handler: (request, h) => {
    return h.response({ status: 'alive' }).code(200)
  }
}

/**
 * Readiness probe - checks if service is ready to receive traffic
 * Verifies:
 * - MongoDB connectivity
 */
export const readinessRoute = {
  method: 'GET',
  path: '/health/ready',
  handler: async (request, h) => {
    try {
      const db = await getDb()
      // Verify MongoDB connection with a ping
      await db.admin().ping()
      return h.response({ status: 'ready', database: 'connected' }).code(200)
    } catch (error) {
      return h.response({
        status: 'not_ready',
        database: 'disconnected',
        error: error.message
      }).code(503)
    }
  }
}

export default [livenessRoute, readinessRoute]
