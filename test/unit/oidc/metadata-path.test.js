import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { buildCanonicalDiscoveryRequest, isLegacyDiscoveryPath } from '../../../src/oidc/metadata-path.js'

describe('buildCanonicalDiscoveryRequest', () => {
  it('builds the canonical /oidc-mounted request for a path-segment policy', () => {
    const result = buildCanonicalDiscoveryRequest({
      policyId: 'b2c_1a_signupsignin',
      rawUrl: '/b2c_1a_signupsignin/.well-known/openid-configuration'
    })

    assert.deepEqual(result, {
      url: '/b2c_1a_signupsignin/.well-known/openid-configuration',
      originalUrl: '/b2c_1a_signupsignin/oidc/.well-known/openid-configuration'
    })
  })

  it('omits the policy segment entirely when no policyId is given', () => {
    const result = buildCanonicalDiscoveryRequest({
      policyId: undefined,
      rawUrl: '/.well-known/openid-configuration'
    })

    assert.deepEqual(result, {
      url: '/.well-known/openid-configuration',
      originalUrl: '/oidc/.well-known/openid-configuration'
    })
  })

  it('preserves the query string on url but not on originalUrl', () => {
    const result = buildCanonicalDiscoveryRequest({
      policyId: undefined,
      rawUrl: '/.well-known/openid-configuration?p=b2c_1a_signupsignin'
    })

    assert.equal(result.url, '/.well-known/openid-configuration?p=b2c_1a_signupsignin')
    assert.equal(result.originalUrl, '/oidc/.well-known/openid-configuration')
  })

  it('preserves the query string alongside a path-segment policy', () => {
    const result = buildCanonicalDiscoveryRequest({
      policyId: 'b2c_1a_signupsignin',
      rawUrl: '/b2c_1a_signupsignin/.well-known/openid-configuration?foo=bar'
    })

    assert.equal(result.url, '/b2c_1a_signupsignin/.well-known/openid-configuration?foo=bar')
    assert.equal(result.originalUrl, '/b2c_1a_signupsignin/oidc/.well-known/openid-configuration')
  })
})

describe('isLegacyDiscoveryPath', () => {
  it('matches the query-parameter-form legacy discovery path', () => {
    assert.equal(isLegacyDiscoveryPath('/oidc/.well-known/openid-configuration'), true)
  })

  it('matches the path-segment-form legacy discovery path', () => {
    assert.equal(isLegacyDiscoveryPath('/b2c_1a_signupsignin/oidc/.well-known/openid-configuration'), true)
  })

  it('does not match other /oidc endpoints', () => {
    for (const pathname of [
      '/oidc/auth',
      '/oidc/token',
      '/oidc/jwks',
      '/oidc/session/end',
      '/b2c_1a_signupsignin/oidc/auth'
    ]) {
      assert.equal(isLegacyDiscoveryPath(pathname), false)
    }
  })

  it('does not match the new configurable discovery path', () => {
    assert.equal(isLegacyDiscoveryPath('/b2c_1a_signupsignin/.well-known/openid-configuration'), false)
    assert.equal(isLegacyDiscoveryPath('/.well-known/openid-configuration'), false)
  })

  it('does not match unrelated paths', () => {
    assert.equal(isLegacyDiscoveryPath('/health/live'), false)
  })
})
