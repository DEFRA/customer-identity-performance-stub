/**
 * Hapi Inert plugin for static file serving
 */

import Inert from '@hapi/inert'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const publicAssetsPath = path.join(__dirname, '../../public/assets')

export default async function (server) {
  await server.register(Inert)

  server.route({
    method: 'GET',
    path: '/assets/{param*}',
    handler: {
      directory: {
        path: publicAssetsPath,
        index: false
      }
    }
  })
}
