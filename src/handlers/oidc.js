/**
 * Handlers for oidc routes
 */

import { once } from 'events'
import { addConsentPromptForOfflineAccess } from '../oidc/authorize-request.js'
import { buildCanonicalDiscoveryRequest, isLegacyDiscoveryPath } from '../oidc/metadata-path.js'
import provider from '../oidc/oidc-setup.js'

const callback = provider.callback()

const invokeProvider = async (req, res) => {
  await callback(req, res)
  if (!res.writableEnded) {
    await once(res, 'finish')
  }
}

export default async ({ raw: { req, res } }, h) => {
  if (isLegacyDiscoveryPath(req.url.split('?')[0])) {
    return h.response().code(404)
  }

  req.url = addConsentPromptForOfflineAccess(req.method, req.url)
  req.originalUrl = req.url
  req.url = req.url.replace('/oidc', '')

  await invokeProvider(req, res)

  req.url = req.url.replace('/', '/oidc')
  delete req.originalUrl

  return res.writableEnded ? h.abandon : h.continue
}

// Dedicated handler for the configurable OIDC_METADATA_PATH route: rewrites the request into
// the canonical /oidc-mounted shape before delegating, so generated endpoint URLs stay correct.
export const metadataHandler = async ({ raw: { req, res }, params }, h) => {
  const { url, originalUrl } = buildCanonicalDiscoveryRequest({ policyId: params.policyId, rawUrl: req.url })
  req.url = url
  req.originalUrl = originalUrl

  await invokeProvider(req, res)

  delete req.originalUrl

  return res.writableEnded ? h.abandon : h.continue
}
