import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { describe, it, mock } from 'node:test'

import Hapi from '@hapi/hapi'
import pino from 'pino'

import {
  assertAdminApiKeyConfigured,
  isValidAdminApiKey,
  requireAdminApiKey
} from '../../../src/admin/auth.js'
import { redactPaths } from '../../../src/logging/logger.js'

describe('Admin API key authentication', () => {
  it('requires a non-blank key at startup', () => {
    assert.equal(assertAdminApiKeyConfigured('test-key'), undefined)
    assert.throws(() => assertAdminApiKeyConfigured(undefined), /ADMIN_API_KEY is required/)
    assert.throws(() => assertAdminApiKeyConfigured('  '), /ADMIN_API_KEY is required/)

    const env = { ...process.env }
    delete env.ADMIN_API_KEY
    const startup = spawnSync(
      process.execPath,
      ['--input-type=module', '-e', "import('./src/server.js')"],
      { cwd: process.cwd(), env, encoding: 'utf8' }
    )
    assert.notEqual(startup.status, 0)
    assert.match(startup.stderr, /ADMIN_API_KEY is required/)
  })

  it('matches exact keys and rejects absent or different keys', () => {
    assert.equal(isValidAdminApiKey('shared-secret', 'shared-secret'), true)
    assert.equal(isValidAdminApiKey('shared-secret-extra', 'shared-secret'), false)
    assert.equal(isValidAdminApiKey(undefined, 'shared-secret'), false)
    assert.equal(isValidAdminApiKey('shared-secret', undefined), false)
  })

  it('returns a takeover 401 for missing or invalid request keys', () => {
    const takeover = Symbol('takeover')
    const response = { code: mock.fn(() => response), takeover: mock.fn(() => takeover) }
    const h = { response: mock.fn(() => response), continue: Symbol('continue') }
    const authenticate = requireAdminApiKey('shared-secret')

    assert.equal(authenticate({ headers: {} }, h), takeover)
    assert.equal(h.response.mock.calls[0].arguments[0].error, 'unauthorized')
    assert.equal(response.code.mock.calls[0].arguments[0], 401)
  })

  it('accepts the api-key header on a Hapi route and rejects an invalid value', async () => {
    const server = Hapi.server()
    server.route({
      method: 'GET',
      path: '/admin/test',
      options: { pre: [{ method: requireAdminApiKey('shared-secret') }] },
      handler: () => ({ ok: true })
    })

    const valid = await server.inject({ url: '/admin/test', headers: { 'api-key': 'shared-secret' } })
    assert.equal(valid.statusCode, 200)
    const invalid = await server.inject({ url: '/admin/test', headers: { 'api-key': 'wrong' } })
    assert.equal(invalid.statusCode, 401)
  })

  it('redacts the api-key header from request logs', async () => {
    const lines = []
    const logger = pino({ redact: redactPaths }, { write: (line) => lines.push(JSON.parse(line)) })
    const server = Hapi.server()
    server.route({
      method: 'GET',
      path: '/',
      handler: (request) => {
        logger.info({ req: { headers: request.headers } })
        return ''
      }
    })

    await server.inject({ url: '/', headers: { 'api-key': 'shared-secret' } })
    assert.equal(lines.length, 1)
    assert.equal(JSON.stringify(lines[0]).includes('shared-secret'), false)
    assert.ok(Object.values(lines[0].req.headers).includes('[Redacted]'))
  })
})
