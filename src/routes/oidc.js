/**
 * OIDC route
 */

import oidcHandler from '../handlers/oidc.js'

export default {
  method: '*',
  path: '/oidc/{any*}',
  config: { payload: { output: 'stream', parse: false } },
  handler: oidcHandler
}
