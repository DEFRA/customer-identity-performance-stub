import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { FormBodyTooLargeError, readFormBody } from '../../../src/oidc/read-form-body.js'

function createCtx ({ method = 'POST', formBody, body } = {}) {
  const chunks = formBody === undefined ? [] : [Buffer.from(formBody)]
  return {
    method,
    request: { body },
    is: (type) => type === 'application/x-www-form-urlencoded',
    req: {
      readable: true,
      [Symbol.asyncIterator]: () => chunks[Symbol.iterator]()
    }
  }
}

describe('readFormBody', () => {
  it('returns the already-populated body unchanged', async () => {
    const ctx = createCtx({ body: { client_id: 'foo' } })
    const body = await readFormBody(ctx)

    assert.deepEqual(body, { client_id: 'foo' })
  })

  it('returns undefined for non-POST requests', async () => {
    const ctx = createCtx({ method: 'GET', formBody: 'client_id=foo' })
    const body = await readFormBody(ctx)

    assert.equal(body, undefined)
  })

  it('parses a single-valued urlencoded body', async () => {
    const ctx = createCtx({ formBody: 'client_id=foo&redirect_uri=https%3A%2F%2Fclient.example.com%2Fcb' })
    const body = await readFormBody(ctx)

    assert.equal(body.client_id, 'foo')
    assert.equal(body.redirect_uri, 'https://client.example.com/cb')
    assert.equal(ctx.request.body, body)
  })

  it('preserves repeated keys as arrays, matching oidc-provider own duplicate handling', async () => {
    const ctx = createCtx({ formBody: 'client_id=a&client_id=b' })
    const body = await readFormBody(ctx)

    assert.deepEqual(body.client_id, ['a', 'b'])
  })

  it('throws FormBodyTooLargeError instead of buffering a body over the 56 KiB limit', async () => {
    const formBody = `client_id=${'a'.repeat(56 * 1024 + 1)}`
    const ctx = createCtx({ formBody })

    await assert.rejects(() => readFormBody(ctx), FormBodyTooLargeError)
  })
})
