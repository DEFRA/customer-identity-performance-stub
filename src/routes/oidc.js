/**
 * OIDC routes
 */

import config from '../config/index.js'
import oidcHandler, { metadataHandler } from '../handlers/oidc.js'

const routeConfig = { payload: { output: 'stream', parse: false } }

const routes = [
  // Query-parameter policy form: /oidc/*?p={policyId}
  {
    method: '*',
    path: '/oidc/{any*}',
    config: routeConfig,
    handler: oidcHandler
  },
  // Path-segment policy form: /{policyId}/oidc/*
  {
    method: '*',
    path: '/{policyId}/oidc/{any*}',
    config: routeConfig,
    handler: oidcHandler
  }
]

if (config.oidc.metadataPath) {
  routes.push({
    method: '*',
    path: config.oidc.metadataPath,
    config: routeConfig,
    handler: metadataHandler
  })
}

export default routes
