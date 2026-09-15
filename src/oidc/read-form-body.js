// No upstream body-parser is registered in this app, so ctx.request.body is never populated by
// Koa itself. oidc-provider's own selective_body reads ctx.req directly and, if it finds the
// stream already consumed, falls back to ctx.req.body / ctx.request.body - so reading the raw
// stream once here and caching the result on ctx.request.body keeps both sides working.
import { parse as parseQuerystring } from 'node:querystring'

// Matches oidc-provider's own url-encoded body size cap (lib/shared/selective_body.js)
const LIMIT = 56 * 1024

export class FormBodyTooLargeError extends Error {}

// Mirrors oidc-provider's own invalid_request shape for a body exceeding LIMIT
export const formBodyTooLargeResponse = (ctx) => {
  ctx.status = 400
  ctx.body = { error: 'invalid_request', error_description: 'request entity too large' }
}

export const readFormBody = async (ctx) => {
  if (ctx.request.body !== undefined) {
    return ctx.request.body
  }

  if (ctx.method !== 'POST' || !ctx.is('application/x-www-form-urlencoded') || !ctx.req.readable) {
    return undefined
  }

  const chunks = []
  let received = 0
  for await (const chunk of ctx.req) {
    received += chunk.length
    if (received > LIMIT) {
      throw new FormBodyTooLargeError('request entity too large')
    }
    chunks.push(chunk)
  }

  // querystring.parse (unlike URLSearchParams) preserves repeated keys as arrays, matching
  // oidc-provider's own body parsing so its duplicate-parameter rejection still applies
  const body = parseQuerystring(Buffer.concat(chunks).toString('utf8'))
  ctx.request.body = body

  return body
}
