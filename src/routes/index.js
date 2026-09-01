/**
 * Route registration hub
 * Centralizes all routes in one place
 */

import homeRoute from './home.js'
import healthRoutes from './health.js'

export default [
  homeRoute,
  ...healthRoutes
  // Additional routes registered here
]
