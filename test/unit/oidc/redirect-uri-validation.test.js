import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { redirectUnregisteredRedirectUri } from '../../../src/oidc/redirect-uri-validation.js'

const client = {
  redirectUris: ['https://client.example.com/cb', 'https://client.example.com/cb2']
}

function createCtx ({ method = 'GET', path = '/auth', query = {}, body = {} } = {}) {
  return {
    method,
    path,
    query,
    request: { body },
    status: undefined,
    type: undefined,
    body: undefined,
    redirect (location) {
      this._redirectedTo = location
    }
  }
}

async function runMiddleware (findClient, ctx) {
  let nextCalled = false
  const next = async () => { nextCalled = true }
  await redirectUnregisteredRedirectUri(findClient)(ctx, next)
  return nextCalled
}

describe('redirectUnregisteredRedirectUri', () => {
  it('passes through requests outside the authorize endpoint', async () => {
    const ctx = createCtx({ path: '/token' })
    const nextCalled = await runMiddleware(async () => client, ctx)

    assert.equal(nextCalled, true)
    assert.equal(ctx._redirectedTo, undefined)
  })

  it('passes through when client_id or redirect_uri is missing', async () => {
    const ctx = createCtx({ query: { client_id: 'foo' } })
    const nextCalled = await runMiddleware(async () => client, ctx)

    assert.equal(nextCalled, true)
  })

  it('passes through unknown client_id (falls through to the normal 400)', async () => {
    const ctx = createCtx({ query: { client_id: 'unknown', redirect_uri: 'https://evil.example.com/cb' } })
    const nextCalled = await runMiddleware(async () => undefined, ctx)

    assert.equal(nextCalled, true)
  })

  it('passes through when the redirect_uri is already registered', async () => {
    const ctx = createCtx({
      query: { client_id: 'foo', redirect_uri: 'https://client.example.com/cb' }
    })
    const nextCalled = await runMiddleware(async () => client, ctx)

    assert.equal(nextCalled, true)
  })

  it('passes through when the client has no registered redirect_uris', async () => {
    const ctx = createCtx({
      query: { client_id: 'foo', redirect_uri: 'https://evil.example.com/cb' }
    })
    const nextCalled = await runMiddleware(async () => ({ redirectUris: [] }), ctx)

    assert.equal(nextCalled, true)
  })

  it('redirects to the fallback uri via query mode by default', async () => {
    const ctx = createCtx({
      query: {
        client_id: 'foo',
        redirect_uri: 'https://evil.example.com/cb',
        state: 'xyz'
      }
    })
    const nextCalled = await runMiddleware(async () => client, ctx)

    assert.equal(nextCalled, false)
    assert.equal(ctx.status, 303)
    const location = new URL(ctx._redirectedTo)
    assert.equal(location.origin + location.pathname, 'https://client.example.com/cb')
    assert.equal(location.searchParams.get('error'), 'invalid_request')
    assert.ok(location.searchParams.get('error_description'))
    assert.equal(location.searchParams.get('state'), 'xyz')
    assert.equal(location.hash, '')
  })

  it('omits state from the query redirect when not supplied', async () => {
    const ctx = createCtx({
      query: { client_id: 'foo', redirect_uri: 'https://evil.example.com/cb' }
    })
    await runMiddleware(async () => client, ctx)

    const location = new URL(ctx._redirectedTo)
    assert.equal(location.searchParams.has('state'), false)
  })

  it('redirects via fragment mode when response_mode=fragment is explicit', async () => {
    const ctx = createCtx({
      query: {
        client_id: 'foo',
        redirect_uri: 'https://evil.example.com/cb',
        response_mode: 'fragment',
        state: 'xyz'
      }
    })
    const nextCalled = await runMiddleware(async () => client, ctx)

    assert.equal(nextCalled, false)
    assert.equal(ctx.status, 303)
    const location = new URL(ctx._redirectedTo)
    assert.equal(location.search, '')
    const hashParams = new URLSearchParams(location.hash.slice(1))
    assert.equal(hashParams.get('error'), 'invalid_request')
    assert.equal(hashParams.get('state'), 'xyz')
  })

  it('infers fragment mode from a token response_type without an explicit response_mode', async () => {
    const ctx = createCtx({
      query: {
        client_id: 'foo',
        redirect_uri: 'https://evil.example.com/cb',
        response_type: 'id_token token'
      }
    })
    await runMiddleware(async () => client, ctx)

    const location = new URL(ctx._redirectedTo)
    assert.equal(location.search, '')
    assert.ok(location.hash.includes('error=invalid_request'))
  })

  it('renders an auto-submitting form for form_post mode, escaping state', async () => {
    const ctx = createCtx({
      query: {
        client_id: 'foo',
        redirect_uri: 'https://evil.example.com/cb',
        response_mode: 'form_post',
        state: '"><script>alert(1)</script>'
      }
    })
    const nextCalled = await runMiddleware(async () => client, ctx)

    assert.equal(nextCalled, false)
    assert.equal(ctx.type, 'text/html')
    assert.ok(ctx.body.includes('action="https://client.example.com/cb"'))
    assert.ok(ctx.body.includes('name="error" value="invalid_request"'))
    assert.ok(!ctx.body.includes('<script>alert(1)</script>'))
    assert.ok(ctx.body.includes('&lt;script&gt;'))
  })

  it('omits the state input for form_post mode when state is not supplied', async () => {
    const ctx = createCtx({
      query: {
        client_id: 'foo',
        redirect_uri: 'https://evil.example.com/cb',
        response_mode: 'form_post'
      }
    })
    await runMiddleware(async () => client, ctx)

    assert.ok(!ctx.body.includes('name="state"'))
  })

  it('falls through to the next handler for an unrecognized response_mode', async () => {
    const ctx = createCtx({
      query: {
        client_id: 'foo',
        redirect_uri: 'https://evil.example.com/cb',
        response_mode: 'web_message'
      }
    })
    const nextCalled = await runMiddleware(async () => client, ctx)

    assert.equal(nextCalled, true)
    assert.equal(ctx._redirectedTo, undefined)
  })

  it('reads parameters from the request body for POST requests', async () => {
    const ctx = createCtx({
      method: 'POST',
      body: { client_id: 'foo', redirect_uri: 'https://evil.example.com/cb', state: 'xyz' }
    })
    const nextCalled = await runMiddleware(async () => client, ctx)

    assert.equal(nextCalled, false)
    assert.equal(ctx.status, 303)
  })
})
