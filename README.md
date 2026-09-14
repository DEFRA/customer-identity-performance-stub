# DEFRA CIDM Stub

A DEFRA Customer Identity Management (CIDM) stub that replicates Azure AD B2C for local development and testing. This stub provides a complete OIDC provider implementation for teams integrating with DEFRA CIDM, eliminating the need to test against live production infrastructure.

## Overview

The stub accurately replicates CIDM's external OIDC behavior—endpoints, token structure, and claim shapes—enabling realistic testing without adding load to production systems or creating unintended side effects.

**Scope**: Local development and testing only. Not suitable for production use.

## Quick Start

### Option 1: Docker Compose (Recommended)

Docker Compose is provided only for local development orchestration.

```sh
cp .env.example .env
npm run compose:up
```

The stub runs at `http://localhost:3000` with MongoDB at `mongodb://db:27017` (internal Docker DNS). The `db` service requires auth (fixed dev-only credentials `mongoadmin`/`secret`, matching the connection string already in `.env.example`) so local behavior matches deployed environments.

#### Azure Cosmos DB Emulator

To run against the Azure Cosmos DB Emulator for MongoDB instead of the default MongoDB container:

```sh
npm run compose:cosmos:up
```

The override replaces the `db` service with the Linux emulator, enables its MongoDB 4.2 endpoint, and supplies the emulator connection string to the stub automatically. The application remains available at `http://localhost:3000`; the emulator exposes its data explorer at `https://localhost:8081` and its MongoDB endpoint at `localhost:10255`.

Use the matching scripts to manage either stack:

| Action | MongoDB | Azure Cosmos DB Emulator |
|--------|---------|--------------------------|
| Start or update | `npm run compose:up` | `npm run compose:cosmos:up` |
| Recreate | `npm run compose:reset` | `npm run compose:cosmos:reset` |
| Remove | `npm run compose:down` | `npm run compose:cosmos:down` |

The `reset` scripts remove and recreate the selected stack. This deletes locally persisted emulator data; MongoDB data remains in its named volume.

The emulator uses a self-signed certificate. Certificate validation is disabled only in the local emulator connection string and must not be used for remote or production database connections. The emulator can take a minute or more to become healthy and requires more memory than the standard MongoDB container.

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

For concurrent Sass compilation:

```sh
npm run watch:css
```

## Features

- **OIDC Authorization Code Flow** — with PKCE enforcement (S256 only)
- **Refresh Token Flow** — when `offline_access` scope requested
- **Token Signing** — RS256 JWS matching Azure AD B2C format; set `SIGNING_KEY` (base64 PKCS#8 PEM) environment variable for a key stable across restarts, otherwise an ephemeral key is generated per-process
- **Policy Routing** — supports policy-scoped discovery and endpoint URLs
- **Test Account Management** — admin API for creating/managing test identities
- **MongoDB Persistence** — OIDC grants, sessions, clients, and test accounts
- **In-Memory Cache** — efficient lookup for high-throughput testing

## Technology Stack

| Concern | Choice |
|---------|--------|
| Runtime | Node.js 24 LTS |
| Framework | Hapi.js v21 |
| OIDC Library | `node-oidc-provider` |
| Database | MongoDB |
| Signing | RS256 (JOSE/JWK) |
| Container | Docker (multi-stage build) |
| Local Orchestration | Docker Compose |

### MongoDB Driver Compatibility

The MongoDB Node.js driver is deliberately pinned to `~6.21.0` rather than upgraded to the latest 7.x release. Driver 6.21 is fully compatible with MongoDB server versions 4.2 through 8.0, allowing the stub to use one driver across the Azure Cosmos DB Emulator's MongoDB 4.2 endpoint, Azure Cosmos DB for MongoDB v7, and Azure DocumentDB with MongoDB 8.0 compatibility. The latest 7.x driver releases do not retain the same MongoDB 4.2 coverage required by the emulator.

See the official [MongoDB Node.js driver compatibility table](https://www.mongodb.com/docs/drivers/compatibility/?driver-language=javascript&javascript-driver-framework=nodejs) before changing this dependency. Azure services implement MongoDB-compatible APIs, so changes must also be tested against each target service rather than relying on the MongoDB server matrix alone.

## Project Structure

```text
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

## Configuration

Environment variables (from `.env` file):

```env
NODE_ENV=development           # Local dev mode
PORT=3000                      # Server port
HOST=0.0.0.0                   # Listen on all interfaces
PUBLIC_URL=http://localhost:3000 # Public URL of the app (used for OIDC issuer and discovery)
SIGNING_KEY=                   # Base64-encoded PKCS#8 PEM RSA private key for token signing (stable across restarts; omit for ephemeral)
OIDC_CLIENTS=                  # OIDC clients (JSON array); Example: OIDC_CLIENTS='[{"client_id":"foo","client_secret":"bar","redirect_uris":["http://localhost:3001/cb"]}]'
MONGO_URL=mongodb://mongoadmin:secret@db:27017/?authSource=admin # MongoDB connection (docker-compose)
MONGO_DB_NAME=cidm-stub        # Database name
MONGO_TIMEOUT=5000             # Connection timeout (ms)
```

For `npm run dev` on host: use `mongodb://mongoadmin:secret@localhost:27017/?authSource=admin` (requires a local MongoDB with matching auth, see Option 2 above).
When using the Cosmos DB Emulator Compose override, its `MONGO_URL` takes precedence over the value in `.env`.

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

Utility scripts in the `scripts/` folder provide helpers for testing and development workflows. See the comments in each script for detailed documentation on usage, parameters, and behavior.

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
| **OIDC Discovery** | `GET /{policyId}/.well-known/openid-configuration` | `GET /.well-known/openid-configuration?p={policyId}` |
| **JWKS** | `GET /{policyId}/.well-known/jwks` | `GET /.well-known/jwks?p={policyId}` |
| **Authorization** | `GET /{policyId}/oidc/authorize` | `GET /oidc/authorize?p={policyId}` |
| **Token** | `POST /{policyId}/oidc/token` | `POST /oidc/token?p={policyId}` |
| **End Session** | `GET /{policyId}/oidc/endsession` | `GET /oidc/endsession?p={policyId}` |
| **Admin API** | `* /admin/*` | — |
| **Liveness** | `GET /health/live` | — |
| **Readiness** | `GET /health/ready` | — |

Valid policy IDs: `b2c_1a_signupsignin`, `b2c_1a_signupsiginalt`, `b2c_1a_signupsiginsfi` (case-insensitive).

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

## License

This project is licensed under the [Open Government Licence v3.0](LICENSE).