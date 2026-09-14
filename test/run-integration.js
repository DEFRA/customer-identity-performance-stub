// Orchestrates integration tests:
// - starts Docker Compose environment
// - waits for app readiness
// - runs tests
// - cleans up

import { spawn } from 'node:child_process'
import { setTimeout as delay } from 'node:timers/promises'

const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const baseUrl = process.env.TEST_BASE_URL || 'http://localhost:3000'

// Dedicated, non-secret client registered only for headless integration test runs
process.env.CLIENT_ID ??= 'integration-test-client'
process.env.CLIENT_SECRET ??= 'integration-test-secret'
process.env.OIDC_CLIENTS ??= JSON.stringify([{
  client_id: process.env.CLIENT_ID,
  client_secret: process.env.CLIENT_SECRET,
  redirect_uris: ['http://localhost:3001/cb'],
  post_logout_redirect_uris: ['http://localhost:3001/logout']
}])

const run = (script, args = []) => new Promise((resolve, reject) => {
  const child = spawn(npmCommand, ['run', script, ...args], {
    stdio: 'inherit'
  })

  child.on('error', reject)
  child.on('exit', (code) => {
    if (code === 0) {
      resolve()
      return
    }

    const error = new Error(`${script} failed with exit code ${code}`)
    error.exitCode = code || 1
    reject(error)
  })
})

const waitForApplication = async () => {
  const deadline = Date.now() + 30_000
  let lastError

  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/health/live`)

      if (response.ok) {
        return
      }

      lastError = new Error(`Liveness check returned ${response.status}`)
    } catch (error) {
      lastError = error
    }

    await delay(500)
  }

  throw new Error(`Application did not become available at ${baseUrl}`, {
    cause: lastError
  })
}

let exitCode = 0

try {
  await run('compose:test:up', ['--', '-d', '--wait'])
  await waitForApplication()
  await run('test:integration')
} catch (error) {
  console.error(error)
  exitCode = error.exitCode || 1
} finally {
  try {
    await run('compose:test:down')
  } catch (error) {
    if (exitCode === 0) {
      exitCode = error.exitCode || 1
    }
  }
}

process.exitCode = exitCode
