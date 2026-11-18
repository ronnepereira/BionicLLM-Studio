/** @vitest-environment jsdom */
import { beforeEach, expect, it, vi } from 'vitest'
const fake = vi.hoisted(() => ({ native: true, mobile: false, call: vi.fn() }))
vi.mock('../backend', () => ({ isTauri: () => fake.native, backendCall: fake.call }))
vi.mock('../../lib/device-kind', () => ({ isMobile: () => fake.mobile }))
import { pickTikTokFile, tiktokInventory, tiktokStatus, uploadTikTok, verifyTikTok } from '../studio-tiktok'
beforeEach(() => { fake.native = true; fake.mobile = false; fake.call.mockReset().mockResolvedValue({}) })
it('blocks preview and mobile before collecting credentials or opening the picker', async () => {
  fake.native = false; await expect(tiktokStatus()).rejects.toThrow('desktop')
  fake.native = true; fake.mobile = true; await expect(verifyTikTok(null, new AbortController().signal)).rejects.toThrow('desktop')
  await expect(pickTikTokFile(new AbortController().signal)).rejects.toThrow('desktop'); expect(fake.call).not.toHaveBeenCalled()
})
it('cancels an exact native transfer and rejects a late acknowledgement after Stop', async () => {
  let resolve!: (value: unknown) => void
  fake.call.mockImplementation((command: string) => command === 'studio_tiktok_upload' ? new Promise(r => { resolve = r }) : Promise.resolve())
  const abort = new AbortController(), pending = uploadTikTok('draft', abort.signal)
  const args = fake.call.mock.calls[0][1]; expect(args.id).toBe('draft')
  abort.abort(); expect(fake.call).toHaveBeenCalledWith('studio_tiktok_cancel', { requestId: args.requestId })
  resolve([]); await expect(pending).rejects.toThrow('cancelada')
})
it('does not start cancelled work and removes completed abort listeners', async () => {
  const stopped = new AbortController(); stopped.abort()
  await expect(pickTikTokFile(stopped.signal)).rejects.toThrow('cancelada'); expect(fake.call).not.toHaveBeenCalled()
  const active = new AbortController(); await pickTikTokFile(active.signal)
  fake.call.mockClear(); active.abort(); expect(fake.call).not.toHaveBeenCalled()
})
it('uses an enabled native inventory for agents rather than combining stale UI status and files', async () => {
  fake.call.mockResolvedValue({ identity: { open_id: 'account' }, files: [] })
  expect(await tiktokInventory(new AbortController().signal)).toMatchObject({ identity: { open_id: 'account' } })
  expect(fake.call).toHaveBeenCalledTimes(1); expect(fake.call).toHaveBeenCalledWith('studio_tiktok_inventory', { requestId: expect.any(String) })
})
