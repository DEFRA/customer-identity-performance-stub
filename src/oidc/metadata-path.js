const discoverySuffix = '/.well-known/openid-configuration'

// Matches the legacy discovery locations nested under /oidc, now intentionally 404'd in
// favour of the configurable OIDC_METADATA_PATH (which never has an /oidc segment).
const legacyDiscoveryPattern = /^\/(?:[^/]+\/)?oidc\/\.well-known\/openid-configuration$/

export const isLegacyDiscoveryPath = (pathname) => legacyDiscoveryPattern.test(pathname)

// Rewrites an incoming discovery request into the canonical /oidc-mounted shape oidc-provider
// expects, so its urlFor() mount-prefix inference keeps producing /oidc-prefixed endpoint URLs
// even though the discovery document itself isn't served from under /oidc.
export const buildCanonicalDiscoveryRequest = ({ policyId, rawUrl }) => {
  const [, search = ''] = rawUrl.split('?')
  const policySegment = policyId ? `/${policyId}` : ''
  const query = search ? `?${search}` : ''

  return {
    url: `${policySegment}${discoverySuffix}${query}`,
    originalUrl: `${policySegment}/oidc${discoverySuffix}`
  }
}
