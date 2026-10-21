/**
 * Account management routes
 */

import config from '../config/index.js'
import {
  createAccount,
  deleteAccount,
  getAccountBySub,
  listAccounts,
  patchAccount,
  replaceAccount
} from '../handlers/admin.js'
import { requireAdminApiKey } from '../admin/auth.js'

const adminRoute = (method, path, handler) => ({
  method,
  path,
  options: { pre: [{ method: requireAdminApiKey(config.adminApiKey) }] },
  handler
})

export default [
  adminRoute('GET', '/admin/accounts', listAccounts),
  adminRoute('GET', '/admin/accounts/{sub}', getAccountBySub),
  adminRoute('POST', '/admin/accounts', createAccount),
  adminRoute('PUT', '/admin/accounts/{sub}', replaceAccount),
  adminRoute('PATCH', '/admin/accounts/{sub}', patchAccount),
  adminRoute('DELETE', '/admin/accounts/{sub}', deleteAccount)
]
