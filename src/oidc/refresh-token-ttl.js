/**
 * Refresh token lifetime matching Azure AD B2C's absolute + rolling model: a rotated
 * refresh token is capped both by a per-use rolling window and by an absolute lifetime
 * measured from the very first token issued in the chain.
 */

export function refreshTokenTtl (totalLifetimeSeconds, { refreshTokenSeconds, refreshTokenRollingSeconds }) {
  const remainingAbsolute = refreshTokenSeconds - totalLifetimeSeconds
  return Math.max(1, Math.min(refreshTokenRollingSeconds, remainingAbsolute))
}
