/**
 * hapi-pino plugin: request/access logging, sharing the app-wide pino instance so both
 * Hapi request logs and manual logger.* calls flow through the same output pipeline.
 */

import HapiPino from 'hapi-pino'
import { logger, redactPaths } from '../logging/logger.js'

export default async function (server) {
  await server.register({
    plugin: HapiPino,
    options: {
      instance: logger,
      redact: redactPaths,
      logPayload: false,
      logQueryParams: true
    }
  })
}
