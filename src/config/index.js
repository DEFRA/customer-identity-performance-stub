/**
 * Centralized configuration from environment variables
 */

const isProduction = process.env.NODE_ENV === 'production'
const port = process.env.PORT || 3000
const host = process.env.HOST || '0.0.0.0'

const db = {
  url: process.env.MONGO_URL || 'mongodb://localhost:27017',
  name: process.env.MONGO_DB_NAME || 'cidm-stub',
  timeout: parseInt(process.env.MONGO_TIMEOUT || '5000', 10)
}

export default {
  port,
  host,
  isProduction,
  db
}
