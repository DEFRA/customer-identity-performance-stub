import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { createCache } from '../../../src/cache/cache.js'

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

describe('createCache', () => {
  it('stores values independently by string key and returns undefined for a miss', () => {
    const cache = createCache({ maxEntries: 3 })

    cache.set('false-value', false)
    cache.set('null-value', null)

    assert.equal(cache.get('false-value'), false)
    assert.equal(cache.get('null-value'), null)
    assert.equal(cache.get('missing'), undefined)
  })

  it('keeps entries without a TTL until they are removed or evicted', async () => {
    const cache = createCache({ maxEntries: 1 })

    cache.set('account', { sub: 'account-1' })
    await delay(10)

    assert.deepEqual(cache.get('account'), { sub: 'account-1' })
  })

  it('expires an entry after its TTL and removes it on access', async () => {
    const cache = createCache({ maxEntries: 1 })

    cache.set('temporary', 'value', { ttlMs: 10 })
    assert.equal(cache.get('temporary'), 'value')

    await delay(20)

    assert.equal(cache.get('temporary'), undefined)
    cache.set('replacement', 'available')
    assert.equal(cache.get('replacement'), 'available')
  })

  it('replaces an entry and resets its TTL', async () => {
    const cache = createCache({ maxEntries: 2 })

    cache.set('item', 'original', { ttlMs: 15 })
    await delay(10)
    cache.set('item', 'replacement', { ttlMs: 100 })
    await delay(10)

    assert.equal(cache.get('item'), 'replacement')
  })

  it('evicts the least recently used entry when capacity is reached', () => {
    const cache = createCache({ maxEntries: 2 })

    cache.set('first', 1)
    cache.set('second', 2)
    assert.equal(cache.get('first'), 1)
    cache.set('third', 3)

    assert.equal(cache.get('first'), 1)
    assert.equal(cache.get('second'), undefined)
    assert.equal(cache.get('third'), 3)
  })

  it('treats replacing an entry as the most recently used entry', () => {
    const cache = createCache({ maxEntries: 2 })

    cache.set('first', 1)
    cache.set('second', 2)
    cache.set('first', 10)
    cache.set('third', 3)

    assert.equal(cache.get('first'), 10)
    assert.equal(cache.get('second'), undefined)
    assert.equal(cache.get('third'), 3)
  })

  it('deletes one entry and reports whether it existed', () => {
    const cache = createCache({ maxEntries: 2 })

    cache.set('item', 'value')

    assert.equal(cache.delete('item'), true)
    assert.equal(cache.delete('item'), false)
    assert.equal(cache.get('item'), undefined)
  })

  it('clears all entries', () => {
    const cache = createCache({ maxEntries: 2 })

    cache.set('first', 1)
    cache.set('second', 2)
    cache.clear()

    assert.equal(cache.get('first'), undefined)
    assert.equal(cache.get('second'), undefined)
  })

  it('rejects a missing, non-integer, or non-positive capacity', () => {
    for (const maxEntries of [undefined, 0, -1, 1.5, Infinity, '2']) {
      assert.throws(() => createCache({ maxEntries }), {
        name: 'TypeError',
        message: 'maxEntries must be a positive integer'
      })
    }
  })

  it('rejects non-string keys and undefined values', () => {
    const cache = createCache({ maxEntries: 2 })

    assert.throws(() => cache.get(1), {
      name: 'TypeError',
      message: 'Cache keys must be strings'
    })
    assert.throws(() => cache.set(1, 'value'), {
      name: 'TypeError',
      message: 'Cache keys must be strings'
    })
    assert.throws(() => cache.delete(1), {
      name: 'TypeError',
      message: 'Cache keys must be strings'
    })
    assert.throws(() => cache.set('undefined'), {
      name: 'TypeError',
      message: 'Cache values must not be undefined'
    })
  })

  it('rejects zero, negative, non-finite, and non-numeric TTLs', () => {
    const cache = createCache({ maxEntries: 1 })

    for (const ttlMs of [0, -1, Infinity, NaN, '10']) {
      assert.throws(() => cache.set('item', 'value', { ttlMs }), {
        name: 'TypeError',
        message: 'ttlMs must be a positive finite number'
      })
    }
  })
})
