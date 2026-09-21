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
    // console.error deliberately kept here - this runs at config module load time, before the logger (which itself depends on config) can exist
    console.error('Error parsing OIDC_CLIENTS environment variable:', error.message)
    return []
  }
}

const oidc = {
  issuer: process.env.OIDC_ISSUER || publicUrl,
  signingKey: process.env.SIGNING_KEY,
  clients: parseClientsFromEnv(),
  // Defaults match the real Defra CIDM Azure AD B2C policy's session/token lifetimes, so
  // these are exposed as env vars purely for convenience and can normally stay unset.
  ttl: {
    sessionSeconds: parseInt(process.env.SESSION_TTL_SECONDS || '1800', 10),
    idTokenSeconds: parseInt(process.env.ID_TOKEN_TTL_SECONDS || '1200', 10),
    accessTokenSeconds: parseInt(process.env.ACCESS_TOKEN_TTL_SECONDS || '1200', 10),
    refreshTokenSeconds: parseInt(process.env.REFRESH_TOKEN_TTL_SECONDS || '86400', 10),
    refreshTokenRollingSeconds: parseInt(process.env.REFRESH_TOKEN_ROLLING_TTL_SECONDS || '86400', 10)
  }
}

const db = {
  url: process.env.MONGO_URL || 'mongodb://localhost:27017',
  name: process.env.MONGO_DB_NAME || 'cidm-stub',
  timeout: parseInt(process.env.MONGO_TIMEOUT || '5000', 10)
}

// Path to a JSON seed file of account documents, upserted (by sub, non-destructively) at
// startup. Unset means the feature is off.
const seedFilePath = process.env.SEED_FILE_PATH

const log = {
  level: process.env.LOG_LEVEL || (isProduction ? 'info' : 'debug'),
  // oidc-provider's own event logging can be tuned independently of the app-wide level
  oidcLevel: process.env.OIDC_LOG_LEVEL || process.env.LOG_LEVEL || (isProduction ? 'info' : 'debug')
}

export default {
  port,
  host,
  isProduction,
  oidc,
  db,
  seedFilePath,
  log
}
