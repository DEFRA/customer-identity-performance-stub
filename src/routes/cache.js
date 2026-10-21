/**
 * Cache management routes
 */

import { clearCache as clearAccountCache } from '../repositories/account-repository.js'
import { clearCache as clearAuthContextCache } from '../repositories/auth-context-repository.js'

export default [
  {
    method: 'DELETE',
    path: '/cache/accounts',
    handler: (request, h) => {
      clearAccountCache()
      return h.response().code(204)
    }
  },
  {
    method: 'DELETE',
    path: '/cache/auth-context',
    handler: (request, h) => {
      clearAuthContextCache()
      return h.response().code(204)
    }
  }
]
