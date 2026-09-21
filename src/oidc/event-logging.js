/**
 * oidc-provider emits events on the provider instance rather than accepting a logger option
 * directly - this wires the ones worth surfacing into the given logger.
 */

const ERROR_EVENTS = [
  'server_error',
  'authorization.error',
  'grant.error',
  'revocation.error',
  'introspection.error',
  'end_session.error',
  'backchannel.error'
]

const LIFECYCLE_EVENTS = [
  'authorization.success',
  'grant.success',
  'end_session.success'
]

// ctx.req is the same raw Node req hapi-pino tagged with an id, letting these logs be
// correlated back to the outer Hapi access-log line despite bypassing Hapi's handler.
const reqId = (ctx) => ctx?.req?.id

export function registerEventLogging (provider, logger) {
  for (const event of ERROR_EVENTS) {
    provider.on(event, (ctx, error) => {
      logger.error({ event, reqId: reqId(ctx), err: error }, `oidc-provider: ${event}`)
    })
  }

  for (const event of LIFECYCLE_EVENTS) {
    provider.on(event, (ctx) => {
      logger.info({ event, reqId: reqId(ctx) }, `oidc-provider: ${event}`)
    })
  }
}
