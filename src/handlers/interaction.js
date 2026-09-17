/**
 * Handlers for the OIDC interaction routes (login page, silent consent)
 */

import { once } from 'events'
import provider from '../oidc/oidc-setup.js'
import accountRepository from '../repositories/account-repository.js'
import authContextRepository from '../repositories/auth-context-repository.js'

/**
 * Finish an interaction directly against the raw req/res, mirroring the OIDC callback handler
 * @param {import('http').IncomingMessage} req
 * @param {import('http').ServerResponse} res
 * @param {object} result
 * @param {object} [options]
 * @param {import('@hapi/hapi').ResponseToolkit} h
 */
async function finishInteraction (req, res, result, options, h) {
  await provider.interactionFinished(req, res, result, options)
  // avoid awaiting an event that may have already fired before we could listen for it
  if (!res.writableEnded) {
    await once(res, 'finish')
  }
  return res.writableEnded ? h.abandon : h.continue
}

export const viewInteraction = async ({ raw: { req, res } }, h) => {
  const details = await provider.interactionDetails(req, res)
  const { prompt, params, session, uid } = details

  if (prompt.name === 'login') {
    return h.view('interaction/login', {
      pageTitle: 'Sign in',
      uid,
      error: null
    })
  }

  if (prompt.name === 'consent') {
    const grant = new provider.Grant({ accountId: session.accountId, clientId: params.client_id })
    if (prompt.details.missingOIDCScope) {
      grant.addOIDCScope(prompt.details.missingOIDCScope.join(' '))
    }
    if (prompt.details.missingOIDCClaims) {
      grant.addOIDCClaims(prompt.details.missingOIDCClaims)
    }
    const grantId = await grant.save()
    await authContextRepository.save(grantId, { serviceId: params.serviceId, relationshipId: params.relationshipId })

    return finishInteraction(req, res, { consent: { grantId } }, { mergeWithLastSubmission: true }, h)
  }

  throw new Error(`Unsupported interaction prompt: ${prompt.name}`)
}

export const submitLogin = async ({ raw: { req, res }, payload }, h) => {
  const details = await provider.interactionDetails(req, res)
  const { username } = payload ?? {}

  const account = username ? await accountRepository.findByLoginIdentifier(username) : null

  if (account) {
    // acr/amr are session-level claims oidc-provider assembles itself from the login result
    // (they always override whatever claims() returns), not from the account claims directly.
    // CIDM's amr is a single string, not the array the OIDC spec suggests, and oidc-provider
    // passes the value through unchanged, so it is passed straight through here as a string.
    const result = { login: { accountId: account.sub, acr: details.params.p, amr: account.amr } }
    return finishInteraction(req, res, result, undefined, h)
  }

  return h.view('interaction/login', {
    pageTitle: 'Sign in',
    uid: details.uid,
    error: 'Enter a valid email address or CRN'
  })
}
