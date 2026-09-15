// HTML-escape attribute values to prevent injection via state, redirect_uri, or other parameters
const escapeHtml = (str) => {
  if (!str) return ''
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

// Mirrors Azure AD B2C: unregistered redirect_uri for a known client redirects
// to that client's first registered redirect_uri with error/error_description,
// rather than a raw 400 (unknown client_id still falls through to 400). POST /auth is not
// supported (oidc-provider only registers GET by default), so this only handles GET.
export const redirectUnregisteredRedirectUri = (findClient) => async (ctx, next) => {
  if (ctx.path !== '/auth' || ctx.method !== 'GET') {
    return next()
  }

  const params = ctx.query
  const clientId = params?.client_id
  const redirectUri = params?.redirect_uri
  const responseMode = params?.response_mode
  const responseType = params?.response_type
  const state = params?.state

  if (!clientId || !redirectUri) {
    return next()
  }

  const client = await findClient(clientId)

  if (!client) {
    return next()
  }

  const registeredUris = client.redirectUris || []
  const [fallbackUri] = registeredUris

  if (registeredUris.includes(redirectUri) || !fallbackUri) {
    return next()
  }

  // Determine effective response_mode: explicit, else fragment for token/id_token response_types, else query
  const effectiveMode = responseMode ||
    (responseType?.includes('token') || responseType?.includes('id_token') ? 'fragment' : 'query')

  const errorParams = new URLSearchParams()
  errorParams.set('error', 'invalid_request')
  errorParams.set('error_description', 'The redirect_uri is not registered for this client')
  if (state) {
    errorParams.set('state', state)
  }

  if (effectiveMode === 'fragment') {
    const location = new URL(fallbackUri)
    location.hash = errorParams.toString()
    ctx.redirect(location.toString())
    ctx.status = 303
  } else if (effectiveMode === 'form_post') {
    const html = `
      <!DOCTYPE html>
      <html>
      <head><title>Submitting form...</title></head>
      <body onload="document.forms[0].submit()">
        <form method="post" action="${escapeHtml(fallbackUri)}">
          <input type="hidden" name="error" value="invalid_request"/>
          <input type="hidden" name="error_description" value="The redirect_uri is not registered for this client"/>
          ${state ? `<input type="hidden" name="state" value="${escapeHtml(state)}"/>` : ''}
        </form>
      </body>
      </html>
    `
    ctx.type = 'text/html'
    ctx.body = html
  } else if (effectiveMode === 'query') {
    const location = new URL(fallbackUri)
    location.search = errorParams.toString()
    ctx.redirect(location.toString())
    ctx.status = 303
  } else {
    // Unrecognized response_mode: fall through to oidc-provider's normal 400
    return next()
  }
}
