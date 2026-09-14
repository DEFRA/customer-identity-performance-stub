/**
 * OIDC interaction routes (login page, silent consent)
 */

import { viewInteraction, submitLogin } from '../handlers/interaction.js'

export default [
  {
    method: 'GET',
    path: '/auth/interaction/{uid}',
    handler: viewInteraction
  },
  {
    method: 'POST',
    path: '/auth/interaction/{uid}/login',
    handler: submitLogin
  }
]
