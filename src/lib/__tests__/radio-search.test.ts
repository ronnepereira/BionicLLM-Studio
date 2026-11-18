import { beforeEach, describe, expect, it, vi } from 'vitest'

const backendCall = vi.hoisted(() => vi.fn())
vi.mock('../../api/backend', () => ({ backendCall }))
import { searchOnlineRadios } from '../radio-search'

describe('online radio backend contract', () => {
  beforeEach(() => { backendCall.mockReset() })

  it('does not invoke the backend for fewer than two trimmed characters', async () => {
    expect(await searchOnlineRadios(' x ')).toEqual([])
    expect(backendCall).not.toHaveBeenCalled()
  })

  it('passes the named req argument expected by the registered Tauri command', async () => {
    const rows = [{ name: 'Jazz', url: 'https://radio.example/live' }]
    backendCall.mockResolvedValue(rows)
    expect(await searchOnlineRadios('  Jazz  ')).toEqual(rows)
    expect(backendCall).toHaveBeenCalledWith('search_online_radios', { req: { name: 'Jazz', limit: 20 } })
  })

  it('preserves an empty successful response', async () => {
    backendCall.mockResolvedValue([])
    expect(await searchOnlineRadios('not-found')).toEqual([])
  })

  it('propagates backend failures instead of presenting them as no matches', async () => {
    backendCall.mockRejectedValue(new Error('Directory unavailable'))
    await expect(searchOnlineRadios('Jazz')).rejects.toThrow('Directory unavailable')
  })

  it('rejects a malformed response rather than presenting it as no matches', async () => {
    backendCall.mockResolvedValue({ error: 'not an array' })
    await expect(searchOnlineRadios('Jazz')).rejects.toThrow()
  })
})
