import { OIDC_CLAIMS } from './claims.js'

const hiddenDiscoveryMetadataFields = [
  'authorization_response_iss_parameter_supported',
  'claim_types_supported',
  'claims_parameter_supported',
  'code_challenge_methods_supported',
  'grant_types_supported',
  'request_uri_parameter_supported'
]

const policyEndpointFields = [
  'authorization_endpoint',
  'token_endpoint',
  'end_session_endpoint',
  'jwks_uri'
]

// embeds the resolved policy into each endpoint URI, matching the ?p= form the
// discovery document was fetched with. The path-segment form needs no rewriting here: since
// our Hapi handler sets req.originalUrl before stripping anything, oidc-provider's own
// urlFor() already infers the policy segment as part of its mount prefix and includes it.
const applyPolicyToEndpoints = (body, policy) => {
  for (const field of policyEndpointFields) {
    const url = new URL(body[field])
    url.searchParams.set('p', policy)
    body[field] = url.toString()
  }
}

export const filterDiscoveryMetadata = async (ctx, next) => {
  await next()

  if (ctx.path !== '/.well-known/openid-configuration' || typeof ctx.body !== 'object') {
    return
  }

  for (const field of hiddenDiscoveryMetadataFields) {
    delete ctx.body[field]
  }

  ctx.body.claims_supported = OIDC_CLAIMS

  if (ctx.state.policy && ctx.state.policyForm === 'query') {
    applyPolicyToEndpoints(ctx.body, ctx.state.policy)
  }
}
