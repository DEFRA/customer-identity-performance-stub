// Mirrors Azure AD B2C: RP-Initiated Logout only redirects back to post_logout_redirect_uri
// when id_token_hint is also supplied. Without it, the session still ends but the provider's
// own sign-out success page is shown instead of redirecting to the RP. oidc-provider has no
// configuration hook for this - stripping the param upstream is the only way to prevent
// end_session's confirm action from ever storing/using it.
export const requireIdTokenHintForPostLogoutRedirect = async (ctx, next) => {
  if (ctx.path !== '/session/end' || !['GET', 'POST'].includes(ctx.method)) {
    return next()
  }

  const params = ctx.method === 'GET' ? ctx.query : ctx.request.body

  if (params?.post_logout_redirect_uri !== undefined && !params?.id_token_hint) {
    delete params.post_logout_redirect_uri
  }

  return next()
}
