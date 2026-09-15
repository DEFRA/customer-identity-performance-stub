/**
 * Route registration hub
 * Centralizes all routes in one place
 */

import homeRoute from './home.js'
import oidcRoutes from './oidc.js'
import interactionRoutes from './interaction.js'
import healthRoutes from './health.js'

export default [
  homeRoute,
  ...oidcRoutes,
  ...interactionRoutes,
  ...healthRoutes
  // Additional routes registered here
]
