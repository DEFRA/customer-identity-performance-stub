# Defra CIDM Stub

A Defra Customer Identity Management (CIDM) stub that replicates Azure AD B2C for local development and testing. This stub provides a complete OIDC provider implementation for teams integrating with Defra CIDM, eliminating the need to test against live production infrastructure.

## Overview

The stub accurately replicates CIDM's external OIDC behavior—endpoints, token structure, and claim shapes—enabling realistic testing without adding load to production systems or creating unintended side effects.

**Scope**: Local development and testing only. Not suitable for production use.

## Table of Contents

- [Prerequisites](#prerequisites)
- [Quick Start](#quick-start)
  - [Option 1: Docker Compose (Recommended)](#option-1-docker-compose-recommended)
  - [Option 2: Local Development](#option-2-local-development)
- [Getting Started with OIDC](#getting-started-with-oidc)
- [Features and Limitations](#features-and-limitations)
- [Technology Stack](#technology-stack)
- [Project Structure](#project-structure)
- [Account Model](#account-model)
- [Configuration](#configuration)
- [Data Management](#data-management)
- [Running Outside Docker Compose](#running-outside-docker-compose)
- [Development](#development)
- [Supported OIDC Flows](#supported-oidc-flows)
- [Endpoints](#endpoints)
- [Troubleshooting](#troubleshooting)
- [License](#license)

## Prerequisites

To run the stub locally you need:

- Node.js 24 LTS and npm
- Docker with Docker Compose v2 (`docker compose`)
- OpenSSL, if you want to generate a stable signing key for token validation across restarts

The default local stack uses port `3000` for the stub and port `27017` for MongoDB. The Azure Cosmos DB Emulator option also exposes `8081` and `10255`.

## Quick Start

### Option 1: Docker Compose (Recommended)

Docker Compose is provided only for local development orchestration.

```sh
cp .env.example .env
npm run compose:up
```

The stub runs at `http://localhost:3000` with MongoDB available inside Docker at `mongodb://db:27017`. The `db` service requires auth using fixed dev-only credentials (`mongoadmin`/`secret`), matching `.env.example`, so local behaviour is closer to deployed environments.

Docker Compose also mounts [`data/accounts.development.json`](data/accounts.development.json) into the container and loads it at startup, so a fresh stack has test accounts ready to use.

#### Azure Cosmos DB Emulator

To run against the Azure Cosmos DB Emulator for MongoDB instead of the default MongoDB container:

```sh
npm run compose:cosmos:up
```

The override replaces the `db` service with the Linux emulator, enables its MongoDB 4.2 endpoint, and supplies the emulator connection string to the stub automatically. The application remains available at `http://localhost:3000`; the emulator exposes its data explorer at `https://localhost:8081/_explorer/index.html` and its MongoDB endpoint at `localhost:10255`.

Use the matching scripts to manage either stack:

| Action | MongoDB | Azure Cosmos DB Emulator |
|--------|---------|--------------------------|
| Start or update | `npm run compose:up` | `npm run compose:cosmos:up` |
| Recreate | `npm run compose:reset` | `npm run compose:cosmos:reset` |
| Remove | `npm run compose:down` | `npm run compose:cosmos:down` |

The `reset` scripts remove and recreate the selected stack. This deletes locally persisted emulator data; MongoDB data remains in its named volume.

The emulator uses a self-signed certificate. Certificate validation is disabled only in the local emulator connection string and must not be used for remote or production database connections. The emulator can take a minute or more to become healthy and requires more memory than the standard MongoDB container.

TTL-based expiry (sessions, tokens, grants, etc.) is best-effort on the Linux Cosmos DB Emulator specifically - its per-document TTL override has been observed not to reliably delete expired documents even after many minutes, unlike real MongoDB or Azure Cosmos DB for MongoDB. Don't rely on the emulator to verify expiry behavior; use the default MongoDB stack or a real Cosmos DB for MongoDB account for that.

The emulator also rejects the case-insensitive `collation` option used on the `accounts.email` index; account login email matching falls back to case-sensitive on the emulator specifically, unlike real MongoDB or Azure Cosmos DB for MongoDB.

The emulator image deliberately uses the floating `latest` tag. Pull the current image before starting when you need to test against the latest emulator release:

```sh
docker compose -f docker-compose.yaml -f docker-compose.cosmos.yaml pull db
```

Stop and restart the selected stack without recreating its containers to retain emulator data:

```sh
docker compose -f docker-compose.yaml -f docker-compose.cosmos.yaml stop
docker compose -f docker-compose.yaml -f docker-compose.cosmos.yaml start
```

Remove the emulator stack with the same file selection used to start it:

```sh
npm run compose:cosmos:down
```

Running the `down` script removes the emulator container and its locally persisted data. The default MongoDB stack uses a named volume, so its data survives `npm run compose:down` unless that volume is removed separately.

### Option 2: Local Development

```sh
npm install
npm run build
cp .env.example .env
npm run dev
```

This requires a local MongoDB with matching auth:

```sh
docker run -d --name cidm-stub-db -p 27017:27017 -e MONGO_INITDB_ROOT_USERNAME=mongoadmin -e MONGO_INITDB_ROOT_PASSWORD=secret mongo:8
```

When running the Node.js app on the host, set `MONGO_URL` in `.env` to use `localhost` rather than Docker's internal `db` hostname:

```env
MONGO_URL=mongodb://mongoadmin:secret@localhost:27017/?authSource=admin
```

For concurrent Sass compilation:

```sh
npm run watch:css
```

## Getting Started with OIDC

Register consuming applications with the `OIDC_CLIENTS` environment variable. It must be a JSON array; each client needs a `client_id`, `client_secret`, and at least one registered redirect URI.

```env
OIDC_CLIENTS='[{"client_id":"local-test-client","client_secret":"local-test-secret","redirect_uris":["http://localhost:3001/cb"]}]'
```

Authorization requests use the usual OIDC parameters plus the Defra CIDM policy and service context:

- `p` - policy ID, for example `b2c_1a_signupsignin`
- `serviceId` - service GUID used to filter the roles returned in the token
- `relationshipId` - optional relationship ID; when supplied, the token's `relationships` and `roles` claims are narrowed to that relationship

The supported policy IDs are `b2c_1a_signupsignin`, `b2c_1a_signupsigninalt`, and `b2c_1a_signupsigninsfi`.

To smoke-test the full authorization-code flow against a running stub, use:

```sh
CLIENT_ID=local-test-client CLIENT_SECRET=local-test-secret TEST_USERNAME=alice.standard@example.com node scripts/test-oidc-auth-code-flow.js
```

The client values must match a client registered through `OIDC_CLIENTS`, and the selected `TEST_USERNAME` must exist in the `accounts` collection.

## Features and Limitations

- **OIDC Authorization Code Flow** — with PKCE enforcement (S256 only) ✅
- **Refresh Token Flow** — when `offline_access` scope requested ✅
- **Token Signing** — RS256 JWS matching Azure AD B2C format; set `SIGNING_KEY` (base64 PKCS#8 PEM) environment variable for a key stable across restarts, otherwise an ephemeral key is generated per-process ✅
- **Policy Routing** — supports policy-scoped discovery and endpoint URLs ✅
- **Test Account Management** — JSON seed-file based account loading ✅
- **MongoDB Persistence** — OIDC grants, sessions, clients, and test accounts ✅
- **In-Memory Cache** — efficient lookup for high-throughput testing ❌
- **Admin API** — creating/managing test identities over HTTP ❌

✅: implemented  
❌: TODO

This stub is intentionally limited to local development, integration testing, and performance testing. It is not a production identity provider and must not be used in place of real Defra CIDM or real security controls.

## Technology Stack

| Concern | Choice |
|---------|--------|
| Runtime | Node.js 24 LTS |
| Framework | Hapi.js v21 |
| OIDC Library | `node-oidc-provider` |
| Database | MongoDB |
| Signing | RS256 (JOSE/JWK) |
| Logging | `pino` / `hapi-pino` |
| Container | Docker (multi-stage build) |
| Local Orchestration | Docker Compose |

### MongoDB Driver Compatibility

The MongoDB Node.js driver is deliberately pinned to `~6.21.0` rather than upgraded to the latest 7.x release. Driver 6.21 is fully compatible with MongoDB server versions 4.2 through 8.0, allowing the stub to use one driver across the Azure Cosmos DB Emulator's MongoDB 4.2 endpoint, Azure Cosmos DB for MongoDB v7, and Azure DocumentDB with MongoDB 8.0 compatibility. The latest 7.x driver releases do not retain the same MongoDB 4.2 coverage required by the emulator.

See the official [MongoDB Node.js driver compatibility table](https://www.mongodb.com/docs/drivers/compatibility/?driver-language=javascript&javascript-driver-framework=nodejs) before changing this dependency. Azure services implement MongoDB-compatible APIs, so changes must also be tested against each target service rather than relying on the MongoDB server matrix alone.

## Project Structure

```text
data/                Test account seed data (JSON documents loaded at startup via SEED_FILE_PATH)
src/
  config/            Environment and configuration
  db/                MongoDB connection and lifecycle
  handlers/          Route handlers and business logic
  oidc/              OIDC provider setup and utilities
  plugins/           Hapi plugins (views, static files)
  repositories/      Data access layer (repositories)
  routes/            Route definitions
  views/             Nunjucks templates
  assets/sass/       Sass source files
  index.js           Application entry point
  server.js          Hapi server setup
public/assets/       Built CSS and GOV.UK Frontend assets
scripts/             Development and testing utility scripts
test/
  unit/              Unit tests
  integration/       Integration tests
```

## Account Model

Each test account is a single MongoDB document in the `accounts` collection. The document shape is deliberately aligned with the token claim shape: whatever relationships, roles, and enrolments you put on the account are what comes back in the ID token, subject to the requested `serviceId` and optional `relationshipId`. If you need a token with a specific combination of relationships and roles, set the account up that way - there is no separate mapping or transformation layer to work around.

A side effect of this is that there are no schema migrations. If the CIDM token format changes, the seed data and any account documents you load into MongoDB must be updated to match.

### Document Structure

| Field | Type | Required | Maps to claim |
|-------|------|----------|----------------|
| `sub` | string (GUID) | Yes | `sub` |
| `email` | string | Yes | `email` |
| `firstName` | string | Yes | `firstName` |
| `lastName` | string | Yes | `lastName` |
| `contactId` | string | Yes | `contactId` |
| `uniqueReference` | string | No | `uniqueReference` (omitted from the token if absent) |
| `loa` | number (0–3) | Yes | `loa` |
| `amr` | string | Yes | `amr` |
| `relationships` | array | Yes | `relationships` and `roles` (formatted, see below) |

Each entry in `relationships` contains:

| Field | Type | Required | Description |
|-------|------|----------|--------------|
| `relationshipId` | string | Yes | Unique ID. UUID for Standard/ALT; numeric string for SFI. |
| `organisationId` | string | No | Organisation ID. UUID for Standard/ALT; numeric string for SFI. Omit entirely for `Citizen` relationships, which have no organisation. |
| `organisationName` | string | No | Organisation display name. Omit for `Citizen` relationships. |
| `organisationLoa` | number (0–3) | No | Organisation level of assurance. Omit for `Citizen` relationships. |
| `relationship` | string | Yes | `Citizen`, `Employee`, `Agent`, or `External` (SFI only), matching the types used by Defra CIDM. |
| `relationshipLoa` | number (0–3) | Yes | Relationship level of assurance. |
| `roles` | array | Yes | Roles granted via this relationship (can be empty). |
| `enrolmentRequestCount` | number | Yes | Static "count" of enrolment requests assigned to the user for this relationship. |

Each entry in `roles` contains:

| Field | Type | Required | Description |
|-------|------|----------|--------------|
| `serviceId` | string (GUID) | Yes | The service this role applies to. Only roles whose `serviceId` matches the requesting service are returned in the token. |
| `roleName` | string | Yes | e.g. `Standard User`, `Finance Officer`, `Certifier`. |
| `status` | number (1–7) | Yes | Enrolment status. |

Minimal account example:

```json
{
  "sub": "a1b2c3d4-0001-0001-0001-000000000001",
  "email": "alice.standard@example.com",
  "firstName": "Alice",
  "lastName": "Standard",
  "contactId": "a1b2c3d4-0001-0001-0001-aabbccdd0001",
  "loa": 2,
  "amr": "scp",
  "relationships": [
    {
      "relationshipId": "r1b2c3d4-0001-0001-0001-000000000001",
      "organisationId": "o1b2c3d4-0001-0001-0001-000000000001",
      "organisationName": "Acme Farm Ltd",
      "organisationLoa": 2,
      "relationship": "Employee",
      "relationshipLoa": 2,
      "roles": [
        {
          "serviceId": "b6f7b9be-4b3e-4b1a-9c3a-111111111111",
          "roleName": "Finance Officer",
          "status": 3
        }
      ],
      "enrolmentRequestCount": 0
    }
  ]
}
```

### Claim Derivation

On the token, `relationships` and `roles` are each flattened into arrays of colon-delimited strings:

- `relationships`: `relationshipId:organisationId:organisationName:organisationLoa:relationship:relationshipLoa`
- `roles`: `relationshipId:roleName:status`

This matches Defra CIDM's format. A few other claims are derived rather than copied straight from the account:

- `amr` - copied from the account as a single string value
- `serviceId` - copied from the authorization request
- `enrolmentCount` — total number of roles matching the requesting `serviceId`, summed across all of the account's relationships (not just the current one)
- `enrolmentRequestCount` — unrelated to `serviceId` (relationships have no per-service breakdown for it), simply summed across all relationships
- `currentRelationshipId` — the `relationshipId` requested at authorization, if supplied, otherwise the first relationship

Only relationships with at least one role matching the requested `serviceId` are returned at all - a relationship the account has no role in for that service is left out of the `relationships` claim entirely, not just filtered out of `roles`. When the authorization request also supplies a `relationshipId`, the result is narrowed further to that single relationship (if it has a matching role); otherwise all matching relationships are included, and `currentRelationshipId` defaults to the first of them.

See [`data/accounts.development.json`](data/accounts.development.json) for worked examples covering different shapes of data.

## Configuration

Environment variables are usually loaded from `.env` for local development.

| Variable | Required | Default/example | Purpose |
|----------|----------|-----------------|---------|
| `NODE_ENV` | No | `development` | Runtime environment. |
| `PORT` | No | `3000` | HTTP port the stub listens on. |
| `HOST` | No | `0.0.0.0` | HTTP host/interface to bind. |
| `PUBLIC_URL` | No | `http://localhost:3000` | Public base URL used for issuer and endpoint metadata. Must match the URL consuming apps use. |
| `OIDC_ISSUER` | No | same as `PUBLIC_URL` | Override for the OIDC issuer when it must differ from `PUBLIC_URL`. |
| `OIDC_CLIENTS` | Yes for OIDC flows | JSON array | Registered OIDC clients. If omitted, no clients are registered. |
| `SIGNING_KEY` | No | generated at startup | Base64-encoded PKCS#8 PEM RSA private key. Use a stable value when token validators must survive stub restarts. |
| `MONGO_URL` | Yes | `mongodb://mongoadmin:secret@db:27017/?authSource=admin` | MongoDB connection string. Use `db` inside Docker Compose and `localhost` when the app runs on the host. |
| `MONGO_DB_NAME` | No | `cidm-stub` | MongoDB database name. |
| `MONGO_TIMEOUT` | No | `5000` | MongoDB connection timeout in milliseconds. |
| `SEED_FILE_PATH` | No | set by Docker Compose | Path to a JSON seed file of accounts, loaded at startup. |
| `LOG_LEVEL` | No | `info` in production, `debug` otherwise | Pino log level (`trace`/`debug`/`info`/`warn`/`error`/`fatal`) for the whole app. |
| `OIDC_LOG_LEVEL` | No | same as `LOG_LEVEL` | Overrides the log level for oidc-provider's own events only. |
| `SESSION_TTL_SECONDS` | No | `1800` | Rolling SSO session idle timeout, matching the real Defra CIDM policy - rarely needs changing. |
| `ID_TOKEN_TTL_SECONDS` | No | `1200` | ID token lifetime, matching the real Defra CIDM policy - rarely needs changing. |
| `ACCESS_TOKEN_TTL_SECONDS` | No | `1200` | Access token lifetime, matching the real Defra CIDM policy - rarely needs changing. |
| `REFRESH_TOKEN_TTL_SECONDS` | No | `86400` | Absolute refresh token lifetime since first issuance, matching the real Defra CIDM policy - rarely needs changing. |
| `REFRESH_TOKEN_ROLLING_TTL_SECONDS` | No | `86400` | Per-use refresh token lifetime cap, matching the real Defra CIDM policy - rarely needs changing. |

These lifetimes default to the values configured in the real Defra CIDM Azure AD B2C policy, so the stub's session and token expiry behavior matches production by default. They're exposed as environment variables mainly for convenience (e.g. shortening them for a specific test scenario) and typically should be left unset.

To create a stable signing key for local or deployed test environments:

```sh
openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 -out signing-key.pem
base64 -w 0 signing-key.pem
```

Set `SIGNING_KEY` to the base64 output. Keep this value secret in shared environments.

For `npm run dev` on host: use `mongodb://mongoadmin:secret@localhost:27017/?authSource=admin` (requires a local MongoDB with matching auth, see Option 2 above).
When using the Cosmos DB Emulator Compose override, its `MONGO_URL` takes precedence over the value in `.env`.

### Logging

The stub uses [pino](https://github.com/pinojs/pino) via [hapi-pino](https://github.com/hapijs/hapi-pino) for structured request logging, plus a shared `logger` (in `src/logging/logger.js`) for startup/lifecycle messages and oidc-provider's own events (`src/oidc/event-logging.js`). Output is pretty-printed outside production and newline-delimited JSON in production. Sensitive fields (`Authorization`/`Cookie` headers, client secrets) are redacted.

To forward logs to Azure Application Insights, add an `applicationinsights`-backed target to `buildTargets()` in `src/logging/logger.js`, gated behind an env var such as `APPLICATIONINSIGHTS_CONNECTION_STRING` - the rest of the logging setup requires no changes. Note this only ships pino log lines as App Insights traces; request/dependency/exception telemetry needs separate OpenTelemetry instrumentation (e.g. `@azure/monitor-opentelemetry`).

## Data Management

### Account seed data

Setting `SEED_FILE_PATH` to the path of a JSON file containing an array of account documents makes the stub insert any accounts from that file which don't already exist in the `accounts` collection (matched by `sub`) every time it starts up. Accounts already present are left completely untouched - this is additive seeding, not a reset. To clear account data, drop the `accounts` collection directly.

The Docker Compose setup enables this by default: `docker-compose.yaml` mounts [`data/accounts.development.json`](data/accounts.development.json) into the container and sets `SEED_FILE_PATH` to it, so a fresh `npm run compose:up` always has a baseline set of test accounts (Standard, ALT, and SFI shapes) without any manual seeding step.

To change the baseline local accounts, edit [`data/accounts.development.json`](data/accounts.development.json) and recreate the stack if you want to test startup seeding from a clean database:

```sh
npm run compose:reset
```

The default MongoDB stack stores data in the `cidm-stub-db-data` named volume, so `npm run compose:down` does not remove account data. Remove that volume separately if you need a completely clean MongoDB database.

To push changes into an already-running stack without recreating it, use [`scripts/upload-accounts.js`](scripts/upload-accounts.js) instead - unlike the startup seed mechanism, it upserts every account in the file (overwriting existing ones matched by `sub`, not just inserting new ones):

```sh
MONGO_URL="mongodb://mongoadmin:secret@localhost:27017/?authSource=admin" npm run upload:accounts
```

Add `-- --wipe` to delete all existing accounts first for a completely fresh load, or pass a different file path as the first argument. Set `MONGO_URL` to match wherever the script runs from (`localhost` on the host, as above, or `db` if run inside the Docker network).

## Running Outside Docker Compose

The stub can run anywhere that can run the Docker image and reach a MongoDB-compatible database. It remains a test/performance/integration stub, not production identity infrastructure.

Build the production image target with:

```sh
docker build --target production -t cidm-stub:local .
```

When running the image in another container platform, provide at least:

- `PUBLIC_URL` set to the externally reachable URL for the stub
- `MONGO_URL` and `MONGO_DB_NAME` for the target MongoDB-compatible database
- `OIDC_CLIENTS` containing the clients that need to authenticate
- `SIGNING_KEY` if token validators need keys to remain stable across restarts
- `SEED_FILE_PATH` plus a mounted JSON file if you want startup account seeding

Inject client secrets, database credentials, and signing keys using the secret mechanism for your platform. Do not reuse the Docker Compose development credentials outside local development.

## Development

### Integration Tests

The integration tests use the default Docker Compose stack with MongoDB and test the running application over HTTP:

```sh
npm run test:integration:local
```

This starts the stack, waits for it to become healthy, runs the tests, and removes the stack even when a test fails.

Use `npm run test:integration` to test an already-running application. Set `TEST_BASE_URL` to test a different application URL; it defaults to `http://localhost:3000`.

Some integration tests (`test/integration/auth-code-flow.test.js`) drive the full OIDC authorization
code, refresh token, and logout flows headlessly and need a registered OIDC client.
`npm run test:integration:local` provisions a dedicated, non-secret test client automatically
(via `test/run-integration.js`, which sets default `CLIENT_ID`/`CLIENT_SECRET`/`OIDC_CLIENTS` values
before starting `docker-compose.test.yaml`) — no `.env` changes are required. `npm run compose:test:up`
only forwards the current `OIDC_CLIENTS` environment variable into the stack; it does not set that
variable itself, so running it directly without first exporting matching `CLIENT_ID`/`CLIENT_SECRET`/
`OIDC_CLIENTS` values starts a stack without the client and the headless tests will fail. Prefer
`npm run test:integration:local`, or export those variables yourself before `npm run compose:test:up`.

### Scripts

Common npm scripts:

| Script | Purpose |
|--------|---------|
| `npm run dev` | Run the app locally with Node.js watch mode. |
| `npm run start` | Run the app without watch mode. |
| `npm run build` | Copy GOV.UK Frontend assets and build CSS. |
| `npm run build:css` | Build the Sass stylesheet only. |
| `npm run watch:css` | Rebuild Sass when it changes. |
| `npm run lint` | Run ESLint. |
| `npm run test:unit` | Run unit tests. |
| `npm run test:integration` | Run integration tests against an already-running app. |
| `npm run test:integration:local` | Start the Docker Compose test stack, run integration tests, and clean up. |
| `npm run compose:up` | Start the local MongoDB stack and stub. |
| `npm run compose:down` | Stop and remove the local stack containers. |
| `npm run compose:reset` | Remove and recreate the local stack containers. |
| `npm run compose:cosmos:up` | Start the stub using the Azure Cosmos DB Emulator override. |
| `npm run compose:cosmos:down` | Stop and remove the Cosmos Emulator stack. |
| `npm run compose:cosmos:reset` | Remove and recreate the Cosmos Emulator stack. |
| `npm run upload:accounts` | Upsert `data/accounts.development.json` (or a given path) into an already-running stack's `accounts` collection; add `-- --wipe` to clear existing accounts first. |

The standalone [`scripts/test-oidc-auth-code-flow.js`](scripts/test-oidc-auth-code-flow.js) script drives an interactive authorization-code flow against a running stub. It uses these helper variables:

| Variable | Required | Default | Purpose |
|----------|----------|---------|---------|
| `CLIENT_SECRET` | Yes | none | Secret for the registered OIDC client. |
| `CLIENT_ID` | No | `foo` | Client ID to use. |
| `OIDC_SERVER` | No | `http://localhost:3000` | Stub base URL. |
| `CALLBACK_PORT` | No | `3001` | Local callback listener port. |
| `TEST_USERNAME` | No | `alice.standard@example.com` | Seeded account email or CRN to sign in with. |
| `POLICY` | No | `b2c_1a_signupsignin` | Policy ID to request. |
| `SERVICE_ID` | No | `b6f7b9be-4b3e-4b1a-9c3a-111111111111` | Service ID used for role filtering. |

### Pull Request Validation

Pull requests targeting `main` or `develop` run the `PR Validation / Validate PR` GitHub Actions check. It validates the locked dependency installation, linting, asset build, dependencies with `npm audit`, Docker Compose configuration, MongoDB-backed integration tests, and production image build.

### Build & Watch CSS

```sh
npm run build:css       # One-time build
npm run watch:css       # Watch mode
```

### Run with Hot Reload

```sh
npm run dev             # Runs with --watch flag
```

### Docker Build Targets

- **development** — Includes dev dependencies and `npm run dev` entrypoint
- **production** — Optimized for production (unused locally)

Override Defra parent image version:

```sh
PARENT_VERSION=3.1.4-node24.19.0 npm run dev
# or
PARENT_VERSION=3.1.4-node24.19.0 docker compose build
```

## Supported OIDC Flows

| Flow | Status | Notes |
|------|--------|-------|
| Authorization Code + PKCE | ✅ Supported | S256 challenge method only; PKCE is mandatory for all clients |
| Refresh Token | ✅ Supported | When `offline_access` scope requested |
| Client Credentials | ❌ Out of Scope | |
| Implicit | ❌ Out of Scope | |
| Device Code | ❌ Out of Scope | |

## Endpoints

The stub exposes the following endpoints:

| Endpoint | Path segment form | Query parameter form |
|----------|-------------------|----------------------|
| **OIDC Discovery** | `GET /{policyId}/oidc/.well-known/openid-configuration` | `GET /oidc/.well-known/openid-configuration?p={policyId}` |
| **JWKS** | `GET /{policyId}/oidc/jwks` | `GET /oidc/jwks?p={policyId}` |
| **Authorization** | `GET /{policyId}/oidc/auth` | `GET /oidc/auth?p={policyId}` |
| **Token** | `POST /{policyId}/oidc/token` | `POST /oidc/token?p={policyId}` |
| **End Session** | `GET /{policyId}/oidc/session/end` | `GET /oidc/session/end?p={policyId}` |
| **Liveness** | `GET /health/live` | — |
| **Readiness** | `GET /health/ready` | — |

Valid policy IDs: `b2c_1a_signupsignin`, `b2c_1a_signupsigninalt`, `b2c_1a_signupsigninsfi` (case-insensitive). Policies are a routing/labelling construct only - they don't alter claim construction or authentication UX. The active policy is reflected in issued ID tokens as the `acr` claim.

### Health Checks

Two HTTP endpoints are exposed for container orchestration:

- **`GET /health/live`** — Liveness probe (returns `200` if process is running)
- **`GET /health/ready`** — Readiness probe (returns `200` if MongoDB is reachable, `503` otherwise)

Docker Compose uses the readiness endpoint to gate service startup order. Kubernetes and other container platforms can use these endpoints for deployment readiness and restart policies.

Test liveness locally:

```sh
curl http://localhost:3000/health/live
curl http://localhost:3000/health/ready
```

## Troubleshooting

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| Stub cannot connect to MongoDB in Docker Compose | `MONGO_URL` uses `localhost` from inside the container | Use `mongodb://mongoadmin:secret@db:27017/?authSource=admin` for Docker Compose. |
| Stub cannot connect to MongoDB when running `npm run dev` on the host | `MONGO_URL` uses Docker's `db` hostname | Use `mongodb://mongoadmin:secret@localhost:27017/?authSource=admin`. |
| OIDC authorization fails because the client is unknown | `OIDC_CLIENTS` is missing, invalid JSON, or does not contain the requested `client_id` | Set `OIDC_CLIENTS` to a valid JSON array and restart the stub. |
| Redirect URI is rejected | The requested `redirect_uri` is not registered for the client | Add the exact URI to the client's `redirect_uris` array. |
| Token validation fails after restarting the stub | No stable `SIGNING_KEY` was configured, so a new key was generated | Generate and configure a stable `SIGNING_KEY`. |
| `npm run test:integration` fails against a local app | The app is not running, or the expected integration client is not registered | Use `npm run test:integration:local`, or configure matching `CLIENT_ID`, `CLIENT_SECRET`, and `OIDC_CLIENTS` yourself. |
| Cosmos Emulator takes a long time to become ready | The emulator is heavier than the standard MongoDB container | Wait for the health check to pass and ensure Docker has enough memory allocated. |
| Port already in use | Another process is using `3000`, `3001`, `27017`, `8081`, or `10255` | Stop the other process or change the relevant port/environment setting. |

## License

This project is licensed under the [Open Government Licence v3.0](LICENSE).