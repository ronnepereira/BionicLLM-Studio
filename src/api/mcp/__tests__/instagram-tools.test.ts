import { beforeEach, expect, it, vi } from 'vitest'
const fake = vi.hoisted(() => ({ available: true, mobile: false, media: vi.fn(), prepare: vi.fn() }))
vi.mock('../../studio-instagram', () => ({ instagramAvailable: () => fake.available, instagramMedia: fake.media, prepareInstagram: fake.prepare }))
vi.mock('../../../lib/device-kind', () => ({ isMobile: () => fake.mobile }))
import { registerInstagramTools } from '../instagram-tools'
import { ToolRegistry } from '../tool-registry'
import { beginAgentRun, endAgentRun } from '../../agent-context'
beforeEach(() => { fake.available = true; fake.mobile = false; fake.media.mockReset().mockResolvedValue({ items: [] }); fake.prepare.mockReset().mockResolvedValue({ id: 'draft', account: '1789' }) })
it('offers read and local proposals only, with a deliberate feed choice for Reels', async () => {
  const registry = new ToolRegistry(); registerInstagramTools(registry)
  expect(registry.getAll()).toHaveLength(3); expect(registry.getToolByName('instagram_publish')).toBeUndefined()
  const result = JSON.parse(await registry.execute('instagram_reel_prepare', { url: 'https://example.com/video.mp4', caption: '', share_to_feed: false }))
  expect(result.status).toBe('pending_human_review'); expect(fake.prepare).toHaveBeenCalledWith({ kind: 'reel', url: 'https://example.com/video.mp4', caption: '', share_to_feed: false }, expect.any(AbortSignal))
  fake.prepare.mockClear(); await registry.execute('instagram_reel_prepare', { url: 'https://example.com/video.mp4', caption: '' }); expect(fake.prepare).not.toHaveBeenCalled()
})
it('blocks read-only mutation, Stop before calls and mobile exposure', async () => {
  const run = beginAgentRun({ readOnlyShellTurn: true })
  try { const registry = new ToolRegistry(); registerInstagramTools(registry); expect(await registry.execute('instagram_image_prepare', { url: 'https://example.com/image.jpg', caption: '' }, 0, run)).toContain('somente leitura'); expect(fake.prepare).not.toHaveBeenCalled() } finally { endAgentRun(run) }
  const stopped = new ToolRegistry(); registerInstagramTools(stopped); const abort = new AbortController(); abort.abort(); await stopped.execute('instagram_media', {}, 0, undefined, abort.signal); expect(fake.media).not.toHaveBeenCalled()
  fake.mobile = true; const mobile = new ToolRegistry(); registerInstagramTools(mobile); expect(mobile.getAll()).toHaveLength(0)
})
