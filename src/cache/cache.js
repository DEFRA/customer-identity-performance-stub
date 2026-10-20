import { performance } from 'node:perf_hooks'

/**
 * Create a bounded in-memory cache with per-entry expiry.
 * @param {object} options
 * @param {number} options.maxEntries - Maximum number of entries before least-recently-used eviction
 * @returns {{ get: (key: string) => *, set: (key: string, value: *, options?: { ttlMs?: number }) => void, delete: (key: string) => boolean, clear: () => void }}
 */
export function createCache ({ maxEntries } = {}) {
  if (!Number.isInteger(maxEntries) || maxEntries < 1) {
    throw new TypeError('maxEntries must be a positive integer')
  }

  const entries = new Map()

  function validateKey (key) {
    if (typeof key !== 'string') {
      throw new TypeError('Cache keys must be strings')
    }
  }

  function get (key) {
    validateKey(key)

    const entry = entries.get(key)
    if (!entry) {
      return undefined
    }

    if (entry.expiresAt !== undefined && entry.expiresAt <= performance.now()) {
      entries.delete(key)
      return undefined
    }

    entries.delete(key)
    entries.set(key, entry)
    return entry.value
  }

  function set (key, value, { ttlMs } = {}) {
    validateKey(key)

    if (value === undefined) {
      throw new TypeError('Cache values must not be undefined')
    }

    if (ttlMs !== undefined && (!Number.isFinite(ttlMs) || ttlMs <= 0)) {
      throw new TypeError('ttlMs must be a positive finite number')
    }

    const entry = {
      value,
      ...(ttlMs === undefined ? {} : { expiresAt: performance.now() + ttlMs })
    }

    entries.delete(key)

    if (entries.size >= maxEntries) {
      const leastRecentlyUsedKey = entries.keys().next().value
      entries.delete(leastRecentlyUsedKey)
    }

    entries.set(key, entry)
  }

  function deleteEntry (key) {
    validateKey(key)
    return entries.delete(key)
  }

  function clear () {
    entries.clear()
  }

  return {
    get,
    set,
    delete: deleteEntry,
    clear
  }
}

export default { createCache }
