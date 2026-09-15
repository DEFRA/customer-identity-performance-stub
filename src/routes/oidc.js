/**
 * OIDC routes
 */

import oidcHandler from '../handlers/oidc.js'

const config = { payload: { output: 'stream', parse: false } }

export default [
  // Query-parameter policy form: /oidc/*?p={policyId}
  {
    method: '*',
    path: '/oidc/{any*}',
    config,
    handler: oidcHandler
  },
  // Path-segment policy form: /{policyId}/oidc/*
  {
    method: '*',
    path: '/{policyId}/oidc/{any*}',
    config,
    handler: oidcHandler
  }
]
