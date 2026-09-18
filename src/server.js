/**
 * Hapi server creation and configuration
 */

import Hapi from '@hapi/hapi'
import config from './config/index.js'
import { registerPlugins } from './plugins/index.js'
import routes from './routes/index.js'
import { connect, disconnect } from './db/index.js'
import { ensureOidcIndexes, ensureAccountIndexes } from './oidc/ensure-indexes.js'
import { seedAccountsFromFile } from './db/seed-accounts-from-file.js'
import logger from './logging/logger.js'

const server = Hapi.server({
  port: config.port,
  host: config.host
})

// Connect to MongoDB on startup
await connect()
await ensureOidcIndexes()
await ensureAccountIndexes()

if (config.seedFilePath) {
  await seedAccountsFromFile(config.seedFilePath)
}

// Register all plugins (views, static files, logging, etc.)
await registerPlugins(server, config)

// Register all routes
server.route(routes)

// Handle unhandled rejections
process.on('unhandledRejection', error => {
  logger.fatal({ err: error }, 'Unhandled rejection')
  process.exit(1)
})

// Handle graceful shutdown
process.on('SIGINT', async () => {
  logger.info('Shutting down...')
  await server.stop()
  await disconnect()
  process.exit(0)
})

process.on('SIGTERM', async () => {
  logger.info('Shutting down...')
  await server.stop()
  await disconnect()
  process.exit(0)
})

// Start server
await server.start()
logger.info(`Server running at ${server.info.uri}`)

export default server
