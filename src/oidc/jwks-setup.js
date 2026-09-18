/**
 * Builds the JWKS used to sign tokens: a stable key from SIGNING_KEY, or an
 * ephemeral one generated at startup when SIGNING_KEY is not set.
 */

import { calculateJwkThumbprint, exportJWK, generateKeyPair, importPKCS8 } from 'jose'
import logger from '../logging/logger.js'

const ALG = 'RS256'

export async function buildJwks (signingKeyBase64) {
  let privateKey

  if (signingKeyBase64) {
    const pem = Buffer.from(signingKeyBase64, 'base64').toString('utf8')
    privateKey = await importPKCS8(pem, ALG, { extractable: true })
    logger.info('JWKS: using SIGNING_KEY (stable across restarts)')
  } else {
    ({ privateKey } = await generateKeyPair(ALG, { extractable: true }))
    logger.warn('JWKS: no SIGNING_KEY set - generated an ephemeral key; tokens will not survive a restart')
  }

  const jwk = await exportJWK(privateKey)
  jwk.use = 'sig'
  jwk.alg = ALG
  jwk.kid = await calculateJwkThumbprint(jwk)

  return { keys: [jwk] }
}
