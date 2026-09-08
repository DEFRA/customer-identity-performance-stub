/**
 * Handlers for oidc routes
 */

import { once } from 'events'
import { addConsentPromptForOfflineAccess } from '../oidc/authorize-request.js'
import provider from '../oidc/oidc-setup.js'

const callback = provider.callback()

export default async ({ raw: { req, res } }, h) => {
  req.url = addConsentPromptForOfflineAccess(req.method, req.url)
  req.originalUrl = req.url
  req.url = req.url.replace('/oidc', '')

  await callback(req, res)
  if (!res.writableEnded) {
    await once(res, 'finish')
  }

  req.url = req.url.replace('/', '/oidc')
  delete req.originalUrl

  return res.writableEnded ? h.abandon : h.continue
}
