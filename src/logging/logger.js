/**
 * Shared pino logger instance, reused by hapi-pino (request/access logs) and by manual
 * logger.* calls in places without a Hapi request (config parsing, db connection, startup).
 */

import pino from 'pino'
import config from '../config/index.js'

// Fields never written to log output, regardless of level - this is an auth server, so
// tokens/secrets/cookies must not leak into logs even at debug level.
export const redactPaths = [
  'req.headers.authorization',
  'req.headers.cookie',
  'res.headers["set-cookie"]',
  'client_secret',
  'password'
]

// Adding an Application Insights (or any other) sink later only means appending one more
// target here, gated by its own env var - nothing else in this module needs to change.
function buildTargets () {
  const targets = [
    config.isProduction
      ? { target: 'pino/file', options: { destination: 1 } }
      : { target: 'pino-pretty', options: { colorize: true } }
  ]

  return targets
}

export const logger = pino({
  level: config.log.level,
  redact: redactPaths,
  transport: { targets: buildTargets() }
})

export default logger
