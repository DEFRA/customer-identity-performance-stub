#!/usr/bin/env node

/**
 * OAuth/OIDC Authorization Code Flow Test Script with PKCE
 *
 * This script automates end-to-end testing of the OAuth 2.0 Authorization Code flow
 * with PKCE (RFC 7636) support. It's designed for local development and debugging of
 * OIDC/OAuth implementations.
 *
 * WHAT IT DOES:
 * 1. Generates a PKCE code_verifier & S256 code_challenge
 * 2. Opens your browser to the OIDC authorization endpoint
 * 3. Listens for the authorization callback on http://localhost:3001/cb
 * 4. Captures the authorization code from the redirect
 * 5. Exchanges the code for tokens using the PKCE verifier
 * 6. Displays the full token response and decoded JWT claims
 * 7. Uses the returned refresh_token to obtain a new set of tokens
 *
 * USAGE:
 *
 *   Prerequisites:
 *   - Node.js 24+ installed
 *   - OIDC stub server running on http://localhost:3000
 *   - CLIENT_SECRET environment variable set
 *
 *   GNU-Linux/macOS
 *     CLIENT_SECRET=bar node scripts/test-oidc-auth-code-flow.js
 *
 *   Windows (PowerShell):
 *     $env:CLIENT_SECRET="bar"
 *     node scripts/test-oidc-auth-code-flow.js
 *
 *   Windows (Command Prompt):
 *     set CLIENT_SECRET=bar
 *     node scripts/test-oidc-auth-code-flow.js
 *
 * WHAT HAPPENS:
 * 1. Script prints out the configuration and authorization URL
 * 2. Your default browser opens automatically (macOS/GNU-Linux/Windows/WSL2)
 *    - If browser doesn't open, you'll see the URL to visit manually
 * 3. You'll see a login page or be asked to authorize the client
 * 4. After authorization, you're redirected to http://localhost:3001/cb
 * 5. Script captures the code and exchanges it for tokens
 * 6. Tokens and JWT claims are printed to console as JSON
 * 7. Script exits with code 0 on success, code 1 on error
 *
 * EXPECTED OUTPUT:
 *   ✓ Authorization code received
 *   ✓ Token exchange successful!
 *   📦 Token Response: { access_token, id_token, refresh_token, ... }
 *   🆔 ID Token Claims: { sub, iss, aud, ... }
 *   🔑 Access Token Claims: { sub, client_id, ... }
 *   ✅ Authorization code flow test completed successfully!
 *
 * ENVIRONMENT VARIABLES:
 *   CLIENT_SECRET     (required) OAuth client secret (e.g., "bar")
 *   CLIENT_ID         (optional) OAuth client ID (default: "foo")
 *   OIDC_SERVER       (optional) OIDC server base URL (default: "http://localhost:3000")
 *   CALLBACK_PORT     (optional) Callback server port (default: 3001)
 */

import http from 'http'
import crypto from 'crypto'
import { execFile } from 'child_process'
import { URL } from 'url'

// Validate required environment variable
if (!process.env.CLIENT_SECRET) {
  console.error('❌ CLIENT_SECRET environment variable not set')
  console.error('   Set it before running: export CLIENT_SECRET=bar')
  console.error('   Or in one command: CLIENT_SECRET=bar node scripts/test-oidc-auth-code-flow.js')
  process.exit(1)
}

const CONFIG = {
  clientId: process.env.CLIENT_ID || 'foo',
  clientSecret: process.env.CLIENT_SECRET,
  oidcServer: process.env.OIDC_SERVER || 'http://localhost:3000',
  callbackPort: parseInt(process.env.CALLBACK_PORT || '3001'),
  callbackUrl: `http://localhost:${process.env.CALLBACK_PORT || 3001}/cb`,
  username: process.env.TEST_USERNAME || 'testuser@example.com',
  policy: process.env.POLICY || 'b2c_1a_signupsignin'
}

/**
 * Generate PKCE code_verifier (43 characters, unreserved chars only)
 */
function generateCodeVerifier () {
  return crypto
    .randomBytes(32)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '')
}

/**
 * Generate code_challenge from verifier using S256 method
 */
function generateCodeChallenge (verifier) {
  return crypto
    .createHash('sha256')
    .update(verifier)
    .digest('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '')
}

/**
 * Start callback server to capture auth code
 */
function startCallbackServer () {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url, `http://localhost:${CONFIG.callbackPort}`)

      // Ignore stray requests (e.g. browser favicon fetch) racing the real callback
      if (url.pathname !== '/cb') {
        res.writeHead(404)
        res.end()
        return
      }

      const code = url.searchParams.get('code')
      const state = url.searchParams.get('state')
      const error = url.searchParams.get('error')
      const errorDescription = url.searchParams.get('error_description')

      if (error) {
        res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' })
        res.end(`Authorization Error: ${error}\n${errorDescription}`)
        reject(new Error(`Authorization error: ${error}: ${errorDescription}`))
        server.close()
        return
      }

      if (!code) {
        res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' })
        res.end('<h1>❌ No authorization code received</h1>')
        reject(new Error('No authorization code received'))
        server.close()
        return
      }

      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      res.end('<h1>✅ Authorization received!</h1><p>You can close this window and check the console.</p>')

      server.close(() => {
        resolve({ code, state })
      })
    })

    server.listen(CONFIG.callbackPort, () => {
      console.log(`📍 Callback server listening on http://localhost:${CONFIG.callbackPort}`)
    })

    server.on('error', reject)
  })
}

/**
 * Open browser to authorization endpoint
 */
function openBrowser (url) {
  return new Promise((resolve, reject) => {
    // args are passed directly to the OS process, never through a shell, so no escaping is needed
    const commands = {
      darwin: ['open', [url]],
      linux: ['xdg-open', [url]],
      win32: ['cmd', ['/c', 'start', '', url]],
    }

    const command = commands[process.platform]
    if (!command) {
      console.warn(`⚠️  Unable to auto-open browser on ${process.platform}`)
      console.log(`\n🔗 Please open this URL in your browser:\n${url}\n`)
      resolve()
      return
    }

    const [file, args] = command
    execFile(file, args, (error) => {
      if (error) {
        console.warn(`⚠️  Failed to open browser: ${error.message}`)
        console.log(`\n🔗 Please open this URL in your browser:\n${url}\n`)
      }
      resolve()
    })
  })
}

/**
 * Exchange authorization code for tokens
 */
async function exchangeCodeForTokens (tokenEndpoint, code, codeVerifier) {
  const params = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: CONFIG.clientId,
    client_secret: CONFIG.clientSecret,
    code,
    code_verifier: codeVerifier,
    redirect_uri: CONFIG.callbackUrl,
  })

  const response = await fetch(tokenEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  })

  if (!response.ok) {
    const errorData = await response.text()
    throw new Error(`Token exchange failed: ${response.status} ${errorData}`)
  }

  return response.json()
}

/**
 * Exchange a refresh token for new tokens
 */
async function refreshTokens (tokenEndpoint, refreshToken) {
  const params = new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: CONFIG.clientId,
    client_secret: CONFIG.clientSecret,
    refresh_token: refreshToken,
  })

  const response = await fetch(tokenEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  })

  if (!response.ok) {
    const errorData = await response.text()
    throw new Error(`Refresh token exchange failed: ${response.status} ${errorData}`)
  }

  return response.json()
}

/**
 * Fetch OIDC discovery metadata
 */
async function fetchOidcMetadata () {
  const metadataUrl = new URL(`/${CONFIG.policy}/oidc/.well-known/openid-configuration`, CONFIG.oidcServer).toString()
  const response = await fetch(metadataUrl)
  if (!response.ok) {
    throw new Error(`Failed to fetch OIDC metadata: ${response.status}`)
  }
  return response.json()
}

/**
 * Decode JWT payload (basic, no validation)
 */
function decodeJwt (token) {
  try {
    const parts = token.split('.')
    if (parts.length !== 3) return null

    const payload = Buffer.from(parts[1], 'base64').toString('utf-8')
    return JSON.parse(payload)
  } catch {
    return null
  }
}

/**
 * Main flow
 */
async function main () {
  try {
    console.log('🚀 Starting OAuth/OIDC Authorization Code Flow Test\n')
    console.log('📋 Configuration:')
    console.log(`   Client ID: ${CONFIG.clientId}`)
    console.log(`   OIDC Server: ${CONFIG.oidcServer}`)
    console.log(`   Callback URL: ${CONFIG.callbackUrl}`)
    console.log(`   Test username: ${CONFIG.username}`)
    console.log(`   Policy: ${CONFIG.policy}\n`)

    // Step 1: Fetch OIDC discovery metadata
    const metadata = await fetchOidcMetadata()

    // Step 2: Generate PKCE
    const codeVerifier = generateCodeVerifier()
    const codeChallenge = generateCodeChallenge(codeVerifier)
    console.log('✓ Generated PKCE')
    console.log(`   Verifier: ${codeVerifier}`)
    console.log(`   Challenge: ${codeChallenge}\n`)

    // Step 3: Build auth URL
    const authUrl = new URL(metadata.authorization_endpoint)
    authUrl.searchParams.set('client_id', CONFIG.clientId)
    authUrl.searchParams.set('redirect_uri', CONFIG.callbackUrl)
    authUrl.searchParams.set('response_type', 'code')
    authUrl.searchParams.set('scope', 'openid offline_access')
    authUrl.searchParams.set('code_challenge', codeChallenge)
    authUrl.searchParams.set('code_challenge_method', 'S256')
    const sentState = 'test-state-' + Date.now()
    authUrl.searchParams.set('state', sentState)
    authUrl.searchParams.set('nonce', 'test-nonce-' + Date.now())

    console.log('🔗 Authorization URL:')
    console.log(`   ${authUrl.toString()}\n`)

    // Step 4: Start callback server
    const callbackPromise = startCallbackServer()

    // Step 5: Open browser
    await openBrowser(authUrl.toString())
    console.log('⏳ Waiting for authorization...\n')

    // Step 6: Wait for callback
    const { code, state } = await callbackPromise
    console.log(`✓ Authorization code received: ${code.substring(0, 20)}...`)
    console.log(`✓ State received: ${state}`)

    // Validate state parameter
    if (state === sentState) {
      console.log('✓ State parameter is valid (matches sent value)\n')
    } else {
      console.log('✗ State parameter mismatch!')
      console.log(`  Expected: ${sentState}`)
      console.log(`  Received: ${state}\n`)
    }

    // Step 7: Exchange code for tokens
    console.log('🔄 Exchanging authorization code for tokens...')
    const tokenResponse = await exchangeCodeForTokens(metadata.token_endpoint, code, codeVerifier)

    console.log('✓ Token exchange successful!\n')

    // Step 7: Pretty-print response
    console.log('📦 Token Response:')
    console.log(JSON.stringify(tokenResponse, null, 2))

    // Decode and display JWT claims
    if (tokenResponse.id_token) {
      const idTokenPayload = decodeJwt(tokenResponse.id_token)
      if (idTokenPayload) {
        console.log('\n🆔 ID Token Claims:')
        console.log(JSON.stringify(idTokenPayload, null, 2))
      }
    }

    if (tokenResponse.access_token) {
      const accessTokenPayload = decodeJwt(tokenResponse.access_token)
      if (accessTokenPayload) {
        console.log('\n🔑 Access Token Claims:')
        console.log(JSON.stringify(accessTokenPayload, null, 2))
      }
    }

    // Step 9: Use the refresh token to get new tokens
    if (tokenResponse.refresh_token) {
      console.log('\n🔄 Exchanging refresh token for new tokens...')
      const refreshedTokenResponse = await refreshTokens(metadata.token_endpoint, tokenResponse.refresh_token)

      console.log('✓ Refresh token exchange successful!\n')
      console.log('📦 Refreshed Token Response:')
      console.log(JSON.stringify(refreshedTokenResponse, null, 2))

      if (refreshedTokenResponse.id_token) {
        const idTokenPayload = decodeJwt(refreshedTokenResponse.id_token)
        if (idTokenPayload) {
          console.log('\n🆔 Refreshed ID Token Claims:')
          console.log(JSON.stringify(idTokenPayload, null, 2))
        }
      }

      if (refreshedTokenResponse.access_token) {
        const accessTokenPayload = decodeJwt(refreshedTokenResponse.access_token)
        if (accessTokenPayload) {
          console.log('\n🔑 Refreshed Access Token Claims:')
          console.log(JSON.stringify(accessTokenPayload, null, 2))
        }
      }
    }

    // Display the end_session_endpoint
    if (metadata.end_session_endpoint) {
      console.log('\n🚪 End Session Endpoint:')
      console.log(`   ${metadata.end_session_endpoint}`)
    }

    console.log('\n✅ Authorization code flow test completed successfully!')
    process.exit(0)
  } catch (error) {
    console.error(`\n❌ Error: ${error.message}`)
    process.exit(1)
  }
}

main()
