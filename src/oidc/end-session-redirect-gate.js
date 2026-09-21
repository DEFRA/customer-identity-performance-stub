// Mirrors CIDM B2C: RP-Initiated Logout only redirects back to post_logout_redirect_uri
// when id_token_hint is also supplied. Without it, the session still ends but the provider's
// own sign-out success page is shown instead of redirecting to the RP. oidc-provider has no
// configuration hook for this - stripping the param upstream is the only way to prevent
// end_session's confirm action from ever storing/using it.
import { FormBodyTooLargeError, formBodyTooLargeResponse, readFormBody } from './read-form-body.js'

export const requireIdTokenHintForPostLogoutRedirect = async (ctx, next) => {
  if (ctx.path !== '/session/end' || !['GET', 'POST'].includes(ctx.method)) {
    return next()
  }

  // oidc-provider only registers a GET route for /session/end unless enableHttpPostMethods is
  // enabled, which requires cookies.long.sameSite=none - and that breaks the session cookie
  // entirely over plain HTTP (as used locally here). Instead, POST is supported by translating
  // the request into an equivalent GET before oidc-provider's own router ever sees it.
  if (ctx.method === 'POST') {
    let body
    try {
      body = await readFormBody(ctx)
    } catch (err) {
      if (err instanceof FormBodyTooLargeError) {
        return formBodyTooLargeResponse(ctx)
      }
      throw err
    }

    for (const [key, value] of Object.entries(body ?? {})) {
      ctx.query[key] = value
    }
    ctx.method = 'GET'
  }

  const params = ctx.query

  if (params.post_logout_redirect_uri !== undefined && !params.id_token_hint) {
    delete params.post_logout_redirect_uri
  }

  return next()
}
