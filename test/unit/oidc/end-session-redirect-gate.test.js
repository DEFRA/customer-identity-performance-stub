import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { requireIdTokenHintForPostLogoutRedirect } from '../../../src/oidc/end-session-redirect-gate.js'

function createCtx ({ method = 'GET', path = '/session/end', query = {} } = {}) {
  return {
    method,
    path,
    query
  }
}

// Mimics a real POST /session/end: the raw application/x-www-form-urlencoded payload is only
// available on the req stream, not pre-parsed anywhere.
function createPostCtx ({ path = '/session/end', query = {}, formBody }) {
  const chunks = [Buffer.from(formBody)]
  return {
    method: 'POST',
    path,
    query,
    request: { body: undefined },
    is: (type) => type === 'application/x-www-form-urlencoded',
    req: {
      readable: true,
      [Symbol.asyncIterator]: () => chunks[Symbol.iterator]()
    }
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
    const ctx = createPostCtx({
      formBody: 'post_logout_redirect_uri=https%3A%2F%2Fclient.example.com%2Flogout&client_id=foo'
    })
    const nextCalled = await runMiddleware(ctx)

    assert.equal(nextCalled, true)
    assert.equal(ctx.method, 'GET')
    assert.equal('post_logout_redirect_uri' in ctx.query, false)
    assert.equal(ctx.query.client_id, 'foo')
  })

  it('translates a POST into an equivalent GET, merging the form body into the query string', async () => {
    const ctx = createPostCtx({
      query: { existing: 'yes' },
      formBody: 'client_id=foo&id_token_hint=some.jwt.token'
    })
    await runMiddleware(ctx)

    assert.equal(ctx.method, 'GET')
    assert.equal(ctx.query.existing, 'yes')
    assert.equal(ctx.query.client_id, 'foo')
    assert.equal(ctx.query.id_token_hint, 'some.jwt.token')
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
