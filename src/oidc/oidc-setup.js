import * as oidc from 'oidc-provider'

import config from '../config/index.js'
import { buildJwks } from './jwks-setup.js'
import { filterDiscoveryMetadata } from './metadata.js'
import { MongoAdapter } from './mongodb-adapter.js'
import { renderView } from './render.js'
import { redirectUnregisteredRedirectUri } from './redirect-uri-validation.js'
import { requireIdTokenHintForPostLogoutRedirect } from './end-session-redirect-gate.js'
import { extractPolicy } from './policy.js'
import { OIDC_CLAIMS } from './claims.js'
import { buildAccountClaims } from './claim-factory.js'
import accountRepository from '../repositories/account-repository.js'
import authContextRepository from '../repositories/auth-context-repository.js'
import { registerEventLogging } from './event-logging.js'
import { logger } from '../logging/logger.js'
import { refreshTokenTtl } from './refresh-token-ttl.js'

const guidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export const providerConfiguration = {
  adapter: MongoAdapter,
  clients: config.oidc.clients,
  clientDefaults: {
    grant_types: ['authorization_code', 'refresh_token']
  },
  clientAuthMethods: [
    'client_secret_post',
    'client_secret_basic'
  ],
  responseTypes: ['code'],
  pkce: {
    required: () => true
  },
  enabledJWA: {
    idTokenSigningAlgValues: ['RS256']
  },
  // Matches the real Defra CIDM Azure AD B2C policy's rolling session and token lifetimes
  ttl: {
    Session: () => config.oidc.ttl.sessionSeconds,
    IdToken: () => config.oidc.ttl.idTokenSeconds,
    AccessToken: () => config.oidc.ttl.accessTokenSeconds,
    // token.totalLifetime() tracks elapsed time since the first token in the rotation chain,
    // surviving rotation - this is what lets us enforce B2C's separate absolute/rolling caps
    RefreshToken: (ctx, token) => refreshTokenTtl(token.totalLifetime(), config.oidc.ttl),
    // A Grant must outlive every RefreshToken that references it, so tie it to the same
    // absolute cap rather than oidc-provider's unrelated 14-day default
    Grant: () => config.oidc.ttl.refreshTokenSeconds,
    // No B2C equivalent to align to - kept at oidc-provider's own default, set explicitly
    // only to silence its "default ttl.* function called" startup notice
    Interaction: () => 60 * 60
  },
  // B2C issues a new refresh token on every redemption - match that instead of oidc-provider's
  // default heuristic (which only rotates confidential-client tokens once 70% of ttl has passed)
  rotateRefreshToken: () => true,
  scopes: ['openid', 'offline_access'],
  // Policy identifier and service/relationship selection preserved into the interaction
  // session for the authorize flow. This runs after redirect_uri/client_id are already
  // validated, so oidc-provider can safely deliver the error back to the client's redirect_uri itself.
  extraParams: {
    p: null,
    relationshipId: null,
    async serviceId (ctx, value) {
      if (!value || !guidPattern.test(value)) {
        throw new oidc.errors.CustomOIDCProviderError(
          'server_error',
          'ServiceId is invalid: The ServiceId must not be null or empty.\r\nThe ServiceId must be a valid GUID.'
        )
      }
    }
  },
  claims: {
    openid: OIDC_CLAIMS
  },
  subjectTypes: [
    'pairwise'
  ],
  features: {
    dPoP: { enabled: false },
    pushedAuthorizationRequests: { enabled: false },
    userinfo: { enabled: false },
    devInteractions: { enabled: false },
    rpInitiatedLogout: {
      enabled: true,
      // Skip the sign-out confirmation prompt and log the user out immediately
      logoutSource: async (ctx, form) => {
        // Inject logout=yes so the provider fully destroys the session, not just the client grant
        const formWithLogout = form.replace('</form>', '<input type="hidden" name="logout" value="yes"/></form>')
        ctx.body = `<!DOCTYPE html><html><head><title>Signing out</title></head><body>${formWithLogout}<script>document.forms[0].submit()</script></body></html>`
      },
      postLogoutSuccessSource: async (ctx) => {
        ctx.body = renderView('interaction/logout-success', { pageTitle: 'Sign-out Success' })
      }
    }
  },
  pairwiseIdentifier: async (ctx, accountId) => accountId,
  interactions: {
    url (ctx, interaction) {
      return `/auth/interaction/${interaction.uid}`
    }
  },
  findAccount: async (ctx, id, token) => {
    const account = await accountRepository.findBySub(id)
    if (!account) {
      return undefined
    }

    return {
      accountId: account.sub,
      async claims () {
        // token carries the grantId once tokens are actually being issued; absent during the
        // initial login-time lookup, when claims() isn't invoked yet
        const context = token ? await authContextRepository.findByGrantId(token.grantId) : {}
        return buildAccountClaims(account, context ?? {})
      }
    }
  },
  jwks: await buildJwks(config.oidc.signingKey)
}

const provider = new oidc.Provider(config.oidc.issuer, providerConfiguration)

// Independently tunable via OIDC_LOG_LEVEL, since oidc-provider's event volume can be noisy
const oidcLogger = logger.child({ component: 'oidc-provider' }, { level: config.log.oidcLevel })
registerEventLogging(provider, oidcLogger)

provider.use(extractPolicy)
provider.use(redirectUnregisteredRedirectUri((id) => provider.Client.find(id)))
provider.use(requireIdTokenHintForPostLogoutRedirect)
provider.use(filterDiscoveryMetadata)

export default provider
