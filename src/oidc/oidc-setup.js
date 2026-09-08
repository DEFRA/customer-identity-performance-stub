import * as oidc from 'oidc-provider'

import config from '../config/index.js'
import { buildJwks } from './jwks-setup.js'
import { filterDiscoveryMetadata } from './metadata.js'
import { MongoAdapter } from './mongodb-adapter.js'
import { renderView } from './render.js'
import { redirectUnregisteredRedirectUri } from './redirect-uri-validation.js'

// Hardcoded - will be replaced with accounts stored in the database
export const TEST_ACCOUNT = {
  username: 'testuser@example.com',
  claims: {
    sub: 'testuser',
    contactId: 'contact-1',
    email: 'testuser@example.com',
    firstName: 'Test',
    lastName: 'User',
    serviceId: 'service-1',
    correlationId: 'correlation-1',
    sessionId: 'session-1',
    uniqueReference: 'unique-1',
    loa: 1,
    aal: 1,
    enrolmentCount: 1,
    enrolmentRequestCount: 0,
    currentRelationshipId: 'relationship-1',
    relationships: [],
    roles: [],
    amr: ['pwd']
  }
}

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
  scopes: ['openid', 'offline_access'],
  claims: {
    openid: [
      'sub',
      'contactId',
      'email',
      'firstName',
      'lastName',
      'serviceId',
      'correlationId',
      'sessionId',
      'uniqueReference',
      'loa',
      'aal',
      'enrolmentCount',
      'enrolmentRequestCount',
      'currentRelationshipId',
      'relationships',
      'roles',
      'amr',
      'iss',
      'iat',
      'exp',
      'aud',
      'acr',
      'nonce',
      'auth_time'
    ]
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
  findAccount: async (ctx, id) => {
    const claims = id === TEST_ACCOUNT.claims.sub ? TEST_ACCOUNT.claims : { sub: id, email: `${id}@example.com` }
    return {
      accountId: id,
      async claims () {
        return claims
      }
    }
  },
  jwks: await buildJwks(config.oidc.signingKey)
}

const provider = new oidc.Provider(config.oidc.issuer, providerConfiguration)

provider.use(redirectUnregisteredRedirectUri((id) => provider.Client.find(id)))
provider.use(filterDiscoveryMetadata)

export default provider
