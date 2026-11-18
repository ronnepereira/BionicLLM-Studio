/** @vitest-environment jsdom */
import { beforeEach, expect, it, vi } from 'vitest'
const fake = vi.hoisted(() => ({ native: true, mobile: false, call: vi.fn() }))
vi.mock('../backend', () => ({ isTauri: () => fake.native, backendCall: fake.call }))
vi.mock('../../lib/device-kind', () => ({ isMobile: () => fake.mobile }))
import { connectGoogle, googleStatus, readGoogle, saveGoogleClient } from '../studio-google'

beforeEach(() => { fake.native = true; fake.mobile = false; fake.call.mockReset().mockResolvedValue({}) })
it('blocks browser and mobile credentials before calling native commands', async () => {
  fake.native = false
  await expect(saveGoogleClient({ client_id: 'id', client_secret: 'secret' })).rejects.toThrow('desktop')
  fake.native = true; fake.mobile = true
  await expect(googleStatus()).rejects.toThrow('desktop')
  expect(fake.call).not.toHaveBeenCalled()
})
it('cancels the exact native request and rejects a late successful result', async () => {
  let resolve!: (value: unknown) => void
  fake.call.mockImplementation((name: string) => name === 'studio_google_read' ? new Promise(r => { resolve = r }) : Promise.resolve())
  const abort = new AbortController()
  const result = readGoogle({ action: 'drive_list', query: 'document' }, abort.signal)
  const args = fake.call.mock.calls[0][1]
  expect(args.input).toEqual({ action: 'drive_list', query: 'document' })
  abort.abort()
  expect(fake.call).toHaveBeenCalledWith('studio_google_cancel', { requestId: args.requestId })
  resolve({ files: [] })
  await expect(result).rejects.toThrow('cancelada')
})
it('never opens authorization after cancellation and removes listeners after completion', async () => {
  const abort = new AbortController(); abort.abort()
  await expect(connectGoogle('gmail', abort.signal)).rejects.toThrow('cancelada')
  expect(fake.call).not.toHaveBeenCalled()
  const active = new AbortController()
  await connectGoogle('calendar', active.signal)
  fake.call.mockClear(); active.abort()
  expect(fake.call).not.toHaveBeenCalled()
})
