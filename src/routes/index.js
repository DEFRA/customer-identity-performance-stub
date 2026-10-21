/**
 * Route registration hub
 * Centralizes all routes in one place
 */

import homeRoute from './home.js'
import oidcRoutes from './oidc.js'
import interactionRoutes from './interaction.js'
import healthRoutes from './health.js'
import cacheRoutes from './cache.js'

export default [
  homeRoute,
  ...oidcRoutes,
  ...interactionRoutes,
  ...healthRoutes,
  ...cacheRoutes
  // Additional routes registered here
]
