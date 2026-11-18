/** @vitest-environment jsdom */
import { beforeEach, expect, it, vi } from 'vitest'
const fake = vi.hoisted(() => ({ native: true, mobile: false, call: vi.fn() }))
vi.mock('../backend', () => ({ isTauri: () => fake.native, backendCall: fake.call }))
vi.mock('../../lib/device-kind', () => ({ isMobile: () => fake.mobile }))
import { pickYouTubeFile, uploadYouTube, youtubeInventory, youtubeStatus } from '../studio-youtube'
beforeEach(() => { fake.native = true; fake.mobile = false; fake.call.mockReset().mockResolvedValue({}) })
it('blocks browser and mobile without opening a picker or native connection', async () => {
  fake.native = false; await expect(youtubeStatus()).rejects.toThrow('desktop')
  fake.native = true; fake.mobile = true; await expect(pickYouTubeFile(new AbortController().signal)).rejects.toThrow('desktop')
  expect(fake.call).not.toHaveBeenCalled()
})
it('cancels the exact transfer and rejects a late acknowledgement after Stop', async () => {
  let resolve!: (value: unknown) => void
  fake.call.mockImplementation((command: string) => command === 'studio_youtube_upload' ? new Promise(r => { resolve = r }) : Promise.resolve())
  const abort = new AbortController(), result = uploadYouTube('draft', abort.signal)
  const args = fake.call.mock.calls[0][1]; expect(args.id).toBe('draft')
  abort.abort(); expect(fake.call).toHaveBeenCalledWith('studio_google_cancel', { requestId: args.requestId })
  resolve([]); await expect(result).rejects.toThrow('cancelada')
})
it('never opens a file picker after cancellation and removes completed listeners', async () => {
  const stopped = new AbortController(); stopped.abort()
  await expect(pickYouTubeFile(stopped.signal)).rejects.toThrow('cancelada'); expect(fake.call).not.toHaveBeenCalled()
  const active = new AbortController(); await pickYouTubeFile(active.signal)
  fake.call.mockClear(); active.abort(); expect(fake.call).not.toHaveBeenCalled()
})
it('uses the cancellable native inventory for agent access instead of combining stale status and UI files', async () => {
  fake.call.mockResolvedValue({ channel: { id: 'channel' }, files: [] })
  expect(await youtubeInventory(new AbortController().signal)).toMatchObject({ channel: { id: 'channel' }, files: [] })
  expect(fake.call).toHaveBeenCalledTimes(1)
  expect(fake.call).toHaveBeenCalledWith('studio_youtube_inventory', { requestId: expect.any(String) })
})
