/** @vitest-environment jsdom */
import { beforeEach, expect, it, vi } from 'vitest'
const fake = vi.hoisted(() => ({ native: true, mobile: false, call: vi.fn() }))
vi.mock('../backend', () => ({ isTauri: () => fake.native, backendCall: fake.call }))
vi.mock('../../lib/device-kind', () => ({ isMobile: () => fake.mobile }))
import { instagramStatus, prepareInstagram, publishInstagram } from '../studio-instagram'
beforeEach(() => { fake.native = true; fake.mobile = false; fake.call.mockReset().mockResolvedValue({}) })
it('blocks preview and mobile before invoking native commands', async () => {
  fake.native = false; await expect(instagramStatus()).rejects.toThrow('desktop')
  fake.native = true; fake.mobile = true; await expect(prepareInstagram({ kind: 'image', url: 'https://example.com/image.jpg', caption: '' }, new AbortController().signal)).rejects.toThrow('desktop')
  expect(fake.call).not.toHaveBeenCalled()
})
it('cancels the exact publishing workflow and rejects a late result without retry', async () => {
  let resolve!: (v: unknown) => void
  fake.call.mockImplementation((name: string) => name === 'studio_instagram_publish' ? new Promise(r => { resolve = r }) : Promise.resolve())
  const abort = new AbortController(); const result = publishInstagram('draft', abort.signal)
  const args = fake.call.mock.calls[0][1]; expect(args.id).toBe('draft')
  abort.abort(); expect(fake.call).toHaveBeenCalledWith('studio_instagram_cancel', { requestId: args.requestId })
  resolve([]); await expect(result).rejects.toThrow('cancelada')
  expect(fake.call.mock.calls.filter(([name]) => name === 'studio_instagram_publish')).toHaveLength(1)
})
