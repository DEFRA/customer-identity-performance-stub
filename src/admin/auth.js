/**
 * Admin API key authentication helpers
 */

import { createHash, timingSafeEqual } from 'node:crypto'

export function assertAdminApiKeyConfigured (apiKey) {
  if (typeof apiKey !== 'string' || apiKey.trim() === '') {
    throw new Error('ADMIN_API_KEY is required')
  }
}

export function isValidAdminApiKey (providedKey, configuredKey) {
  if (typeof providedKey !== 'string' || typeof configuredKey !== 'string') {
    return false
  }

  const providedDigest = createHash('sha256').update(providedKey).digest()
  const configuredDigest = createHash('sha256').update(configuredKey).digest()
  return timingSafeEqual(providedDigest, configuredDigest)
}

export function requireAdminApiKey (configuredKey) {
  return (request, h) => {
    if (!isValidAdminApiKey(request.headers['api-key'], configuredKey)) {
      return h.response({ error: 'unauthorized' }).code(401).takeover()
    }

    return h.continue
  }
}
