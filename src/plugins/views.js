/**
 * Hapi Vision plugin with Nunjucks template engine
 */

import Vision from '@hapi/vision'
import nunjucks from 'nunjucks'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const viewsPath = path.join(__dirname, '../views')
const govukFrontendPath = path.join(__dirname, '../../node_modules/govuk-frontend/dist/govuk')

export default async function (server, config) {
  const nunjucksEnvironment = nunjucks.configure([viewsPath, govukFrontendPath], {
    autoescape: true,
    noCache: !config.isProduction
  })

  await server.register(Vision)

  server.views({
    engines: {
      njk: {
        compile: (source, options) => {
          const template = nunjucks.compile(source, nunjucksEnvironment, options.filename)
          return context => template.render(context)
        }
      }
    },
    path: viewsPath,
    defaultExtension: 'njk',
    isCached: config.isProduction
  })
}
