import { beforeEach, expect, it, vi } from 'vitest'
const fake = vi.hoisted(() => ({ native: true, mobile: false, call: vi.fn() }))
vi.mock('../backend', () => ({ isTauri: () => fake.native, backendCall: (...args: unknown[]) => fake.call(...args) }))
vi.mock('../../lib/device-kind', () => ({ isMobile: () => fake.mobile }))
import { disconnectTelegram, telegramStatus, verifyTelegram } from '../studio-telegram'
beforeEach(() => { fake.native = true; fake.mobile = false; fake.call.mockReset() })
it('refuses browser and mobile credential operations without making a request', async () => {
  for (const mobile of [false, true]) {
    fake.native = mobile; fake.mobile = mobile
    await expect(telegramStatus()).rejects.toThrow(/desktop/)
    await expect(verifyTelegram('secret')).rejects.toThrow(/desktop/)
    await expect(disconnectTelegram()).rejects.toThrow(/desktop/)
  }
  expect(fake.call).not.toHaveBeenCalled()
})
it('passes only the token to a fixed command and never fetches a saved secret', async () => {
  await verifyTelegram('  token  ')
  await verifyTelegram()
  await telegramStatus()
  await disconnectTelegram()
  expect(fake.call.mock.calls).toEqual([
    ['studio_telegram_verify', { token: 'token' }],
    ['studio_telegram_verify', { token: null }],
    ['studio_telegram_status'], ['studio_telegram_disconnect'],
  ])
})
