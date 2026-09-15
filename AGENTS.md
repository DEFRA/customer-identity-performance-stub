# AGENTS.md

Guidance for AI coding agents working on the DEFRA CIDM Stub.

## Dev environment tips
- Use Node.js 24 LTS. The package declares `>=24 <25`.
- Use `npm`, not `pnpm` or `yarn`; scripts and lockfile expectations are npm-based.
- Start local development with `npm install`, `npm run build`, `cp .env.example .env`, then `npm run dev`.
- For the recommended local stack, use `npm run compose:up`; stop it with `npm run compose:down`.
- For Cosmos DB Emulator testing, use `npm run compose:cosmos:up` and the matching `compose:cosmos:*` scripts.
- Build GOV.UK Frontend assets with `npm run build`; for Sass watch mode use `npm run watch:css`.
- Keep generated public assets under `public/assets/` aligned with the Sass and GOV.UK Frontend source setup.
- Update the README when behavior, setup, commands, environment variables, or supported OIDC behavior changes.

## Project conventions
- Follow the Defra Software Development Standards and GOV.UK Design System guidance.
- Prefer existing `govuk-frontend` components and styles for UI work.
- The application is an ESM Node.js app using Hapi, Nunjucks, MongoDB, `jose`, and `oidc-provider`.
- Keep OIDC behavior close to Azure AD B2C external behavior where the README or tests define it.
- This stub is for local development, performance, load, and integration testing only. Do not make changes that imply production identity-provider suitability.
- The MongoDB driver is deliberately pinned to `~6.21.0` for compatibility across MongoDB, Cosmos DB Emulator, Azure Cosmos DB for MongoDB, and Azure DocumentDB targets. Do not upgrade it casually.
- When adding environment variables, update `.env.example` and the README if the variable is user-facing.

## OIDC behavior notes
- Authorization Code + PKCE is supported; PKCE is mandatory and `S256` is the supported challenge method.
- Refresh tokens are supported when `offline_access` is requested.
- Client credentials, implicit flow, and device code are out of scope.
- Policy IDs are case-insensitive and should continue to support both path-segment and query-parameter endpoint forms.
- For a known client with an unregistered `redirect_uri`, preserve the B2C-like fallback behavior: redirect or respond to the first valid registered redirect URI for that client and honor the requested `response_mode`. This is an exception to the standard `oidc-provider` behavior that would return a HTTP 400 error instead.
- RP-Initiated Logout only redirects to `post_logout_redirect_uri` when `id_token_hint` is also supplied (B2C-like); without it the session still ends but the user sees the provider's own sign-out success page instead of being redirected to the RP.
- `POST /session/end` is supported: the request is translated into an equivalent GET (form body merged into the query string) before `oidc-provider`'s own router sees it. `POST /auth` is intentionally NOT supported - `oidc-provider` only registers a GET route for `/auth` unless `enableHttpPostMethods` is enabled, which requires `cookies.long.sameSite=none`; modern browsers reject `SameSite=None` cookies without `Secure`, which would break the session cookie entirely over the plain HTTP used locally. Do not enable `enableHttpPostMethods` or add POST handling back to `/auth`.
- B2C policies (`b2c_1a_signupsignin`, `b2c_1a_signupsigninalt`, `b2c_1a_signupsigninsfi`, case-insensitive) are extracted from either the path-segment form (`/{policyId}/oidc/*`) or the query-parameter form (`?p={policyId}`) by a single pre-middleware; no other component parses the URL for policy information. Policies are a routing/labelling construct only - the same account lookup and token building logic runs regardless of policy. An unrecognized policy value returns a 404 error. The resolved policy is reflected in issued ID tokens as the `acr` claim, and in the per-policy discovery document's endpoint URIs (in the same form used to fetch it) and `claims_supported`.

## Testing instructions
- Run unit tests with `npm run test:unit`.
- Run integration tests against an already-running app with `npm run test:integration`.
- Run the full local integration flow with `npm run test:integration:local`; it starts Docker Compose, waits for readiness, runs tests, and cleans up.
- Use `npm run test:integration:local` when the integration OIDC client should be provisioned automatically; `npm run compose:test:up` only starts the stack and requires `OIDC_CLIENTS` to be set.
- The integration auth flow expects the default test client unless overridden: `CLIENT_ID=integration-test-client`, `CLIENT_SECRET=integration-test-secret`, and redirect URI `http://localhost:3001/cb`.
- Use one-off environment prefixes for local test overrides, for example `TEST_USERNAME=testuser@example.com npm run test:integration:local`.
- Keep integration coverage balanced. Prefer focused unit tests for response-mode permutations and edge cases unless the end-to-end wiring is the risk being tested.
- Add or update tests for behavior changes, especially OIDC request validation, token shape, policy routing, health checks, database adapters, and Docker-backed startup behavior.
- When you have fixed a bug check if there is any new unit or integration test worth adding as well.

## Validation before handoff
- Run `npm run lint` after JavaScript changes.
- Run `npm run build` after Sass, GOV.UK asset, or frontend template changes.
- Run the narrowest relevant test first, then broaden when the changed behavior crosses module or integration boundaries.
- For changes affecting Docker, MongoDB, health checks, or OIDC end-to-end flows, prefer `npm run test:integration:local` before handing off.
- Check `.github/workflows/` when aligning work with pull request validation.
- Call out if any validation would fail when running the pull request validation in `.github/workflows/`.

## Git and PR instructions
- Never execute git commands that change repository status: commits, branch creation, rebase, merge, stash etc. I.e. only run git commands to read the repository data.
- Never try to create PRs.

## Security
- Call out if any file that might contain sensitive data has been git staged, like the `.env` file for example.