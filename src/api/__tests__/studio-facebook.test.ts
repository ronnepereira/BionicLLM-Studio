/** @vitest-environment jsdom */
import { beforeEach, expect, it, vi } from 'vitest'
const fake = vi.hoisted(() => ({ native: true, mobile: false, call: vi.fn() }))
vi.mock('../backend', () => ({ isTauri: () => fake.native, backendCall: fake.call }))
vi.mock('../../lib/device-kind', () => ({ isMobile: () => fake.mobile }))
import { facebookStatus, prepareFacebook, verifyFacebook } from '../studio-facebook'
beforeEach(() => { fake.native = true; fake.mobile = false; fake.call.mockReset().mockResolvedValue({}) })
it('blocks browser and mobile before collecting credentials in native commands', async () => {
  fake.native = false; await expect(facebookStatus()).rejects.toThrow('desktop')
  fake.native = true; fake.mobile = true; await expect(verifyFacebook(null, new AbortController().signal)).rejects.toThrow('desktop')
  expect(fake.call).not.toHaveBeenCalled()
})
it('cancels the exact native operation and refuses a result arriving after Stop', async () => {
  let resolve!: (v: unknown) => void
  fake.call.mockImplementation((name: string) => name === 'studio_facebook_prepare' ? new Promise(r => { resolve = r }) : Promise.resolve())
  const abort = new AbortController(); const pending = prepareFacebook('Text', abort.signal)
  const args = fake.call.mock.calls[0][1]; expect(args.input).toEqual({ message: 'Text' })
  abort.abort(); expect(fake.call).toHaveBeenCalledWith('studio_facebook_cancel', { requestId: args.requestId })
  resolve({ id: 'draft' }); await expect(pending).rejects.toThrow('cancelada')
})
