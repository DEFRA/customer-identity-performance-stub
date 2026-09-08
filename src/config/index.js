/**
 * Centralized configuration from environment variables
 */

const isProduction = process.env.NODE_ENV === 'production'
const port = process.env.PORT || 3000
const host = process.env.HOST || '0.0.0.0'
const publicUrl = process.env.PUBLIC_URL || `http://localhost:${port}`

/**
 * Parse OIDC clients from JSON environment variable.
 * Format: OIDC_CLIENTS='[{"client_id":"foo","client_secret":"bar","redirect_uris":["http://localhost:3001/cb"]}]'
 * If not provided, defaults to an empty array (no clients registered).
 */
const parseClientsFromEnv = () => {
  const clientsJson = process.env.OIDC_CLIENTS
  if (!clientsJson) {
    return []
  }
  try {
    return JSON.parse(clientsJson)
  } catch (error) {
    console.error('Error parsing OIDC_CLIENTS environment variable:', error.message)
    return []
  }
}

const oidc = {
  issuer: process.env.OIDC_ISSUER || publicUrl,
  signingKey: process.env.SIGNING_KEY,
  clients: parseClientsFromEnv()
}

const db = {
  url: process.env.MONGO_URL || 'mongodb://localhost:27017',
  name: process.env.MONGO_DB_NAME || 'cidm-stub',
  timeout: parseInt(process.env.MONGO_TIMEOUT || '5000', 10)
}

export default {
  port,
  host,
  isProduction,
  oidc,
  db
}
