import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { requireIdTokenHintForPostLogoutRedirect } from '../../../src/oidc/end-session-redirect-gate.js'

function createCtx ({ method = 'GET', path = '/session/end', query = {}, body = {} } = {}) {
  return {
    method,
    path,
    query,
    request: { body }
  }
}

async function runMiddleware (ctx) {
  let nextCalled = false
  const next = async () => { nextCalled = true }
  await requireIdTokenHintForPostLogoutRedirect(ctx, next)
  return nextCalled
}

describe('requireIdTokenHintForPostLogoutRedirect', () => {
  it('passes through requests outside the end_session endpoint', async () => {
    const ctx = createCtx({
      path: '/auth',
      query: { post_logout_redirect_uri: 'https://client.example.com/logout' }
    })
    const nextCalled = await runMiddleware(ctx)

    assert.equal(nextCalled, true)
    assert.equal(ctx.query.post_logout_redirect_uri, 'https://client.example.com/logout')
  })

  it('strips post_logout_redirect_uri from the query string on GET when id_token_hint is absent', async () => {
    const ctx = createCtx({
      query: { post_logout_redirect_uri: 'https://client.example.com/logout', client_id: 'foo' }
    })
    const nextCalled = await runMiddleware(ctx)

    assert.equal(nextCalled, true)
    assert.equal('post_logout_redirect_uri' in ctx.query, false)
    assert.equal(ctx.query.client_id, 'foo')
  })

  it('strips post_logout_redirect_uri from the request body on POST when id_token_hint is absent', async () => {
    const ctx = createCtx({
      method: 'POST',
      body: { post_logout_redirect_uri: 'https://client.example.com/logout', client_id: 'foo' }
    })
    const nextCalled = await runMiddleware(ctx)

    assert.equal(nextCalled, true)
    assert.equal('post_logout_redirect_uri' in ctx.request.body, false)
    assert.equal(ctx.request.body.client_id, 'foo')
  })

  it('leaves post_logout_redirect_uri untouched when id_token_hint is present', async () => {
    const ctx = createCtx({
      query: {
        post_logout_redirect_uri: 'https://client.example.com/logout',
        id_token_hint: 'some.jwt.token'
      }
    })
    const nextCalled = await runMiddleware(ctx)

    assert.equal(nextCalled, true)
    assert.equal(ctx.query.post_logout_redirect_uri, 'https://client.example.com/logout')
  })

  it('leaves the request untouched when post_logout_redirect_uri is absent', async () => {
    const ctx = createCtx({ query: { client_id: 'foo' } })
    const nextCalled = await runMiddleware(ctx)

    assert.equal(nextCalled, true)
    assert.deepEqual(ctx.query, { client_id: 'foo' })
  })
})
