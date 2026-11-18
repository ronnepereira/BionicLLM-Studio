import { afterEach, beforeEach, expect, it, vi } from 'vitest'
beforeEach(() => { vi.resetModules(); vi.stubGlobal('localStorage', { getItem: () => null, setItem: vi.fn(), removeItem: vi.fn() }) })
afterEach(() => vi.unstubAllGlobals())
function installDatabase(value: unknown, fail = false) {
  const db = { transaction: () => ({ objectStore: () => ({ get: () => {
    const request = { result: value, error: new Error('Read failed'), onsuccess: null as (() => void) | null, onerror: null as (() => void) | null }
    queueMicrotask(() => fail ? request.onerror?.() : request.onsuccess?.())
    return request
  } }) }) }
  vi.stubGlobal('indexedDB', { open: () => {
    const request = { result: db, onsuccess: null as (() => void) | null }
    queueMicrotask(() => request.onsuccess?.())
    return request
  } })
}
it.each([null, undefined, '[object Object]', '{broken', '{"state":{}}', { state: { conversations: [] } }])('does not mistake an unreadable row for a persisted history (%s)', async value => {
  installDatabase(value)
  const { hasReadableItem } = await import('../idbStorage')
  expect(await hasReadableItem('chat-conversations')).toBe(false)
})
it('accepts a valid persisted empty list without restoring deleted conversations', async () => {
  installDatabase('{"state":{"conversations":[]},"version":3}')
  const { hasReadableItem } = await import('../idbStorage')
  expect(await hasReadableItem('chat-conversations')).toBe(true)
})
it('keeps a failed read distinct from an empty history', async () => {
  installDatabase(undefined, true)
  const { hasReadableItem } = await import('../idbStorage')
  expect(await hasReadableItem('chat-conversations')).toBeNull()
})
