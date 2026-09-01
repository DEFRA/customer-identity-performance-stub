/**
 * Hapi server creation and configuration
 */

import Hapi from '@hapi/hapi'
import config from './config/index.js'
import { registerPlugins } from './plugins/index.js'
import routes from './routes/index.js'
import { connect, disconnect } from './db/index.js'

const server = Hapi.server({
  port: config.port,
  host: config.host
})

// Connect to MongoDB on startup
await connect()

// Register all plugins (views, static files, logging, etc.)
await registerPlugins(server, config)

// Register all routes
server.route(routes)

// Handle unhandled rejections
process.on('unhandledRejection', error => {
  console.error(error)
  process.exit(1)
})

// Handle graceful shutdown
process.on('SIGINT', async () => {
  console.log('Shutting down...')
  await server.stop()
  await disconnect()
  process.exit(0)
})

process.on('SIGTERM', async () => {
  console.log('Shutting down...')
  await server.stop()
  await disconnect()
  process.exit(0)
})

// Start server
await server.start()
console.log(`Server running at ${server.info.uri}`)

export default server
