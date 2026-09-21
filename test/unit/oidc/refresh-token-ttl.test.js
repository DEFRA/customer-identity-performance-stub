import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { refreshTokenTtl } from '../../../src/oidc/refresh-token-ttl.js'

const config = { refreshTokenSeconds: 86400, refreshTokenRollingSeconds: 86400 }

describe('refreshTokenTtl', () => {
  it('returns the rolling cap for a freshly issued token', () => {
    assert.equal(refreshTokenTtl(0, config), 86400)
  })

  it('returns the remaining time up to the absolute cap as it elapses', () => {
    assert.equal(refreshTokenTtl(86000, config), 400)
  })

  it('never returns less than 1 once the absolute cap has passed', () => {
    assert.equal(refreshTokenTtl(90000, config), 1)
  })

  it('caps to the rolling window when it is shorter than the remaining absolute time', () => {
    assert.equal(refreshTokenTtl(0, { refreshTokenSeconds: 86400, refreshTokenRollingSeconds: 3600 }), 3600)
  })
})
