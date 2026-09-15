import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { extractPolicy, POLICIES } from '../../../src/oidc/policy.js'

function createCtx ({ method = 'GET', path = '/auth', query = {} } = {}) {
  return {
    method,
    path,
    query,
    state: {},
    status: undefined,
    body: undefined
  }
}

async function runMiddleware (ctx) {
  let nextCalled = false
  const next = async () => { nextCalled = true }
  await extractPolicy(ctx, next)
  return nextCalled
}

describe('extractPolicy', () => {
  it('exposes the three canonical B2C policy identifiers', () => {
    assert.deepEqual(Object.keys(POLICIES).sort(), [
      'b2c_1a_signupsignin',
      'b2c_1a_signupsigninalt',
      'b2c_1a_signupsigninsfi'
    ])
  })

  it('recognises the path-segment form, strips it, and normalises to lowercase', async () => {
    const ctx = createCtx({ path: '/B2C_1A_SignUpSignIn/auth' })
    const nextCalled = await runMiddleware(ctx)

    assert.equal(nextCalled, true)
    assert.equal(ctx.path, '/auth')
    assert.equal(ctx.state.policy, 'b2c_1a_signupsignin')
    assert.equal(ctx.state.policyForm, 'path')
  })

  it('mirrors the path-segment policy into the query string for the authorize endpoint', async () => {
    const ctx = createCtx({ path: '/b2c_1a_signupsignin/auth' })
    await runMiddleware(ctx)

    assert.equal(ctx.query.p, 'b2c_1a_signupsignin')
  })

  it('does not mirror the path-segment policy into the query string for other endpoints', async () => {
    const ctx = createCtx({ path: '/b2c_1a_signupsignin/token' })
    await runMiddleware(ctx)

    assert.equal('p' in ctx.query, false)
  })

  it('recognises the query-parameter form and normalises to lowercase', async () => {
    const ctx = createCtx({
      path: '/token',
      query: { p: 'B2C_1A_SignUpSignInALT' }
    })
    const nextCalled = await runMiddleware(ctx)

    assert.equal(nextCalled, true)
    assert.equal(ctx.state.policy, 'b2c_1a_signupsigninalt')
    assert.equal(ctx.state.policyForm, 'query')
  })

  it('strips p from the query string for non-authorize endpoints', async () => {
    const ctx = createCtx({
      path: '/token',
      query: { p: 'b2c_1a_signupsignin', client_id: 'foo' }
    })
    await runMiddleware(ctx)

    assert.equal('p' in ctx.query, false)
    assert.equal(ctx.query.client_id, 'foo')
  })

  it('retains p in the query string for the authorize endpoint', async () => {
    const ctx = createCtx({
      path: '/auth',
      query: { p: 'b2c_1a_signupsignin', client_id: 'foo' }
    })
    await runMiddleware(ctx)

    assert.equal(ctx.query.p, 'b2c_1a_signupsignin')
  })

  it('normalizes the casing of p retained for the authorize endpoint', async () => {
    const ctx = createCtx({
      path: '/auth',
      query: { p: 'B2C_1A_SignUpSignIn', client_id: 'foo' }
    })
    await runMiddleware(ctx)

    assert.equal(ctx.query.p, 'b2c_1a_signupsignin')
  })

  it('returns a 404 error for an unrecognised query policy value', async () => {
    const ctx = createCtx({ path: '/auth', query: { p: 'not-a-real-policy' } })
    const nextCalled = await runMiddleware(ctx)

    assert.equal(nextCalled, false)
    assert.equal(ctx.status, 404)
    assert.equal(ctx.body.error, 'invalid_request')
  })

  it('returns a 404 error instead of throwing when p is repeated (parsed as an array)', async () => {
    const ctx = createCtx({ path: '/auth', query: { p: ['b2c_1a_signupsignin', 'b2c_1a_signupsignin'] } })
    const nextCalled = await runMiddleware(ctx)

    assert.equal(nextCalled, false)
    assert.equal(ctx.status, 404)
    assert.equal(ctx.body.error, 'invalid_request')
  })

  it('returns a 404 error for an unrecognised path-segment policy value', async () => {
    const ctx = createCtx({ path: '/b2c_1a_invalid/auth' })
    const nextCalled = await runMiddleware(ctx)

    assert.equal(nextCalled, false)
    assert.equal(ctx.status, 404)
    assert.equal(ctx.body.error, 'invalid_request')
  })

  it('rejects an inherited Object property name used as a query policy', async () => {
    const ctx = createCtx({ path: '/auth', query: { p: 'constructor' } })
    const nextCalled = await runMiddleware(ctx)

    assert.equal(nextCalled, false)
    assert.equal(ctx.status, 404)
  })

  it('passes through unchanged when no policy is present in either form', async () => {
    const ctx = createCtx({ path: '/auth', query: { client_id: 'foo' } })
    const nextCalled = await runMiddleware(ctx)

    assert.equal(nextCalled, true)
    assert.equal(ctx.path, '/auth')
    assert.equal(ctx.state.policy, undefined)
    assert.deepEqual(ctx.query, { client_id: 'foo' })
  })

  it('treats an unrelated leading path segment as ordinary routing, not a policy', async () => {
    const ctx = createCtx({ path: '/.well-known/openid-configuration' })
    const nextCalled = await runMiddleware(ctx)

    assert.equal(nextCalled, true)
    assert.equal(ctx.path, '/.well-known/openid-configuration')
    assert.equal(ctx.state.policy, undefined)
  })

  it('prefers the path-segment form over a simultaneous query form', async () => {
    const ctx = createCtx({
      path: '/b2c_1a_signupsignin/auth',
      query: { p: 'b2c_1a_signupsigninalt' }
    })
    await runMiddleware(ctx)

    assert.equal(ctx.state.policy, 'b2c_1a_signupsignin')
    assert.equal(ctx.state.policyForm, 'path')
    // mirrored onto the query string for extraParams, overwriting the stale query value
    assert.equal(ctx.query.p, 'b2c_1a_signupsignin')
  })
})
