/**
 * Plugin registration hub
 * Centralizes all Hapi plugins in one place for clarity and testability
 */

import viewsPlugin from './views.js'
import staticFilesPlugin from './static-files.js'

/**
 * Register all plugins
 * @param {Hapi.Server} server
 * @param {object} config
 */
export async function registerPlugins (server, config) {
  await viewsPlugin(server, config)
  await staticFilesPlugin(server, config)
  // Additional plugins registered here as needed
}
