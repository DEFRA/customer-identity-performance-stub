/**
 * Database module entry point
 * Exports client and connection lifecycle functions
 */

export { getDb, getClient } from './client.js'
export { connect, disconnect } from './connect.js'
