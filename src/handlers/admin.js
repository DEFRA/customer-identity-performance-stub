/**
 * Account management handlers for the Admin API
 */

import accountRepository from '../repositories/account-repository.js'

const guidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function isRecord (value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function badRequest (h, message) {
  return h.response({ error: 'bad_request', message }).code(400)
}

function notFound (h) {
  return h.response({ error: 'not_found' }).code(404)
}

function conflict (h) {
  return h.response({ error: 'conflict' }).code(409)
}

function hasDuplicateKeyCode (error) {
  return error?.code === 11000
}

function validateAccountPayload (payload, { pathSub, requireSub = false, patch = false } = {}) {
  if (!isRecord(payload)) {
    return 'The request body must be a JSON object'
  }
  if (Object.hasOwn(payload, '_id')) {
    return 'The _id field cannot be supplied'
  }
  if (requireSub && typeof payload.sub !== 'string') {
    return 'The sub field is required'
  }
  if (payload.sub !== undefined && !guidPattern.test(payload.sub)) {
    return 'The sub field must be a GUID'
  }
  if (pathSub && payload.sub !== undefined && payload.sub.toLowerCase() !== pathSub.toLowerCase()) {
    return 'The sub field must match the path'
  }
  if (payload.email !== undefined && typeof payload.email !== 'string') {
    return 'The email field must be a string'
  }
  if (patch && Object.keys(payload).length === 0) {
    return 'The request body must contain at least one field'
  }
  if (patch && Object.keys(payload).some((field) => field.includes('.') || field.startsWith('$'))) {
    return 'PATCH fields must be top-level account fields'
  }
  if (patch && (Object.hasOwn(payload, 'createdAt') || Object.hasOwn(payload, 'updatedAt'))) {
    return 'Account timestamps are managed by the server'
  }

  return null
}

function accountSubIsValid (sub) {
  return typeof sub === 'string' && guidPattern.test(sub)
}

async function respondToWrite (h, write) {
  try {
    return await write()
  } catch (error) {
    if (hasDuplicateKeyCode(error)) {
      return conflict(h)
    }
    throw error
  }
}

export async function listAccounts (request, h) {
  if (request.query.email !== undefined) {
    if (request.query.email === '') {
      return badRequest(h, 'The email query parameter must not be empty')
    }
    const account = await accountRepository.findByEmail(request.query.email)
    return account ? h.response(account).code(200) : notFound(h)
  }

  return h.response(await accountRepository.findAll()).code(200)
}

export async function getAccountBySub (request, h) {
  if (!accountSubIsValid(request.params.sub)) {
    return badRequest(h, 'The sub path parameter must be a GUID')
  }

  const account = await accountRepository.findBySub(request.params.sub)
  return account ? h.response(account).code(200) : notFound(h)
}

export async function createAccount (request, h) {
  const validationError = validateAccountPayload(request.payload, { requireSub: true })
  if (validationError) {
    return badRequest(h, validationError)
  }

  const account = await respondToWrite(h, async () => {
    const created = await accountRepository.create(request.payload)
    return h.response(created).code(201)
  })
  return account
}

export async function replaceAccount (request, h) {
  const { sub } = request.params
  if (!accountSubIsValid(sub)) {
    return badRequest(h, 'The sub path parameter must be a GUID')
  }
  const validationError = validateAccountPayload(request.payload, { pathSub: sub })
  if (validationError) {
    return badRequest(h, validationError)
  }

  const replacement = await respondToWrite(h, async () => {
    const replaced = await accountRepository.replaceBySub(sub, request.payload)
    return h.response(replaced).code(200)
  })
  return replacement
}

export async function patchAccount (request, h) {
  const { sub } = request.params
  if (!accountSubIsValid(sub)) {
    return badRequest(h, 'The sub path parameter must be a GUID')
  }
  const validationError = validateAccountPayload(request.payload, { pathSub: sub, patch: true })
  if (validationError) {
    return badRequest(h, validationError)
  }

  const updated = await respondToWrite(h, async () => {
    const account = await accountRepository.patchBySub(sub, request.payload)
    return account ? h.response(account).code(200) : notFound(h)
  })
  return updated
}

export async function deleteAccount (request, h) {
  if (!accountSubIsValid(request.params.sub)) {
    return badRequest(h, 'The sub path parameter must be a GUID')
  }

  const account = await accountRepository.deleteBySub(request.params.sub)
  return account ? h.response().code(204) : notFound(h)
}
