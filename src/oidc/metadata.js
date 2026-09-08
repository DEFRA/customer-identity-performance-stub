const hiddenDiscoveryMetadataFields = [
  'authorization_response_iss_parameter_supported',
  'claim_types_supported',
  'claims_parameter_supported',
  'code_challenge_methods_supported',
  'grant_types_supported',
  'request_uri_parameter_supported'
]

export const filterDiscoveryMetadata = async (ctx, next) => {
  await next()

  if (ctx.path !== '/.well-known/openid-configuration' || typeof ctx.body !== 'object') {
    return
  }

  for (const field of hiddenDiscoveryMetadataFields) {
    delete ctx.body[field]
  }
}
