import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { addConsentPromptForOfflineAccess } from '../../../src/oidc/authorize-request.js'

describe('addConsentPromptForOfflineAccess', () => {
  it('adds consent prompt to authorize request with offline_access scope', () => {
    const requestUrl = '/oidc/auth?client_id=foo&scope=openid+offline_access'

    const result = addConsentPromptForOfflineAccess('GET', requestUrl)

    assert.equal(result, '/oidc/auth?client_id=foo&scope=openid+offline_access&prompt=consent')
  })

  it('does not replace an existing authorize prompt', () => {
    const requestUrl = '/oidc/auth?client_id=foo&scope=openid+offline_access&prompt=login'

    const result = addConsentPromptForOfflineAccess('GET', requestUrl)

    assert.equal(result, requestUrl)
  })

  it('does not replace an empty existing authorize prompt', () => {
    const requestUrl = '/oidc/auth?client_id=foo&scope=openid+offline_access&prompt='

    const result = addConsentPromptForOfflineAccess('GET', requestUrl)

    assert.equal(result, requestUrl)
  })

  it('does not add consent prompt without offline_access scope', () => {
    const requestUrl = '/oidc/auth?client_id=foo&scope=openid'

    const result = addConsentPromptForOfflineAccess('GET', requestUrl)

    assert.equal(result, requestUrl)
  })

  it('does not add consent prompt outside authorize requests', () => {
    const requestUrl = '/oidc/token?scope=openid+offline_access'

    const result = addConsentPromptForOfflineAccess('GET', requestUrl)

    assert.equal(result, requestUrl)
  })

  it('adds consent prompt for the path-segment policy form', () => {
    const requestUrl = '/b2c_1a_signupsignin/oidc/auth?client_id=foo&scope=openid+offline_access'

    const result = addConsentPromptForOfflineAccess('GET', requestUrl)

    assert.equal(result, '/b2c_1a_signupsignin/oidc/auth?client_id=foo&scope=openid+offline_access&prompt=consent')
  })
})
