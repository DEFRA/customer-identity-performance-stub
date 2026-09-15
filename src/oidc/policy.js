// B2C policy identifiers this stub recognises, keyed by their canonical lowercase
// form. Short names are for labelling/logging only - matching is always case-insensitive.
export const POLICIES = {
  b2c_1a_signupsignin: 'SignUpSignIn',
  b2c_1a_signupsigninalt: 'SignUpSignInALT',
  b2c_1a_signupsigninsfi: 'SignUpSignInSFI'
}

const invalidPolicyResponse = (ctx) => {
  ctx.status = 404
  ctx.body = { error: 'invalid_request', error_description: 'Unrecognized policy identifier' }
}

// Resolves the policy identifier from either the path-segment form
// (/{policyId}/oidc/*) or the query-parameter form (?p={policyId}), strips it so
// oidc-provider's own router sees the path it expects, and stores the resolved value on
// ctx.state.policy for downstream use (discovery document overrides, interaction session).
// No other component in the codebase parses the URL for policy information.
export const extractPolicy = async (ctx, next) => {
  const [, firstSegment, ...rest] = ctx.path.split('/')
  const normalizedFirstSegment = firstSegment?.toLowerCase()

  if (normalizedFirstSegment && Object.hasOwn(POLICIES, normalizedFirstSegment)) {
    ctx.state.policy = normalizedFirstSegment
    ctx.state.policyForm = 'path'
    ctx.path = `/${rest.join('/')}`

    // extraParams only reads from the query string, so mirror the path-segment policy there
    // too, on the authorize endpoint (GET only - POST /auth is not supported), to preserve it
    // into the interaction session
    if (ctx.path === '/auth') {
      ctx.query.p = normalizedFirstSegment
    }

    return next()
  }

  // path-segment looks like it was intended as a policy identifier (b2c_1a_* pattern)
  // but doesn't match a known policy — reject it as a 404, not a normal routing miss
  if (normalizedFirstSegment && /^b2c_1a_/.test(normalizedFirstSegment)) {
    return invalidPolicyResponse(ctx)
  }

  if (ctx.query.p !== undefined) {
    const normalizedQueryPolicy = typeof ctx.query.p === 'string' ? ctx.query.p.toLowerCase() : ''

    if (!Object.hasOwn(POLICIES, normalizedQueryPolicy)) {
      return invalidPolicyResponse(ctx)
    }

    ctx.state.policy = normalizedQueryPolicy
    ctx.state.policyForm = 'query'

    // Retained only for the authorize endpoint (GET only - POST /auth is not supported), where
    // it must be registered as an extraParam so oidc-provider preserves it into the interaction
    // session; stripped everywhere else to avoid tripping strict param whitelisting on other
    // endpoints.
    if (ctx.path === '/auth') {
      ctx.query.p = normalizedQueryPolicy
    } else {
      delete ctx.query.p
    }
  }

  return next()
}
