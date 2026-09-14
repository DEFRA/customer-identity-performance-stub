/**
 * Standalone Nunjucks renderer for views used outside of the Hapi request lifecycle
 * (e.g. oidc-provider's raw Koa middleware, such as postLogoutSuccessSource).
 */

import nunjucks from 'nunjucks'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const viewsPath = path.join(__dirname, '../views')
const govukFrontendPath = path.join(__dirname, '../../node_modules/govuk-frontend/dist/govuk')

const nunjucksEnvironment = nunjucks.configure([viewsPath, govukFrontendPath], {
  autoescape: true
})

export const renderView = (view, context) => nunjucksEnvironment.render(`${view}.njk`, context)
