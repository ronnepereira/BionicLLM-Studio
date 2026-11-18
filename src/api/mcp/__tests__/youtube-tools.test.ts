import { beforeEach, expect, it, vi } from 'vitest'
const fake = vi.hoisted(() => ({ available: true, mobile: false, inventory: vi.fn(), videos: vi.fn(), prepare: vi.fn() }))
vi.mock('../../studio-youtube', () => ({ youtubeAvailable: () => fake.available, youtubeInventory: fake.inventory, youtubeVideos: fake.videos, prepareYouTube: fake.prepare }))
vi.mock('../../../lib/device-kind', () => ({ isMobile: () => fake.mobile }))
import { registerYouTubeTools } from '../youtube-tools'
import { ToolRegistry } from '../tool-registry'
import { beginAgentRun, endAgentRun } from '../../agent-context'
import { DEFAULT_PERMISSIONS } from '../types'
const input = { file_id: 'selected', title: 'Video', description: '', category_id: '22', privacy: 'private', made_for_kids: false, contains_synthetic_media: true, intended_short: true }
beforeEach(() => { fake.available = true; fake.mobile = false; fake.inventory.mockReset().mockResolvedValue({ channel: { id: 'channel' }, files: [{ id: 'selected', name: '<script>data</script>' }] }); fake.videos.mockReset().mockResolvedValue({ items: [] }); fake.prepare.mockReset().mockResolvedValue({ id: 'draft', account: 'channel' }) })
it('offers reads and local proposals without file picking or remote upload tools', async () => {
  const registry = new ToolRegistry(); registerYouTubeTools(registry)
  expect(registry.getAll()).toHaveLength(3); expect(registry.getToolByName('youtube_upload')).toBeUndefined(); expect(registry.getToolByName('youtube_pick')).toBeUndefined()
  expect(registry.getPermissionLevel('youtube_prepare', DEFAULT_PERMISSIONS)).toBe('confirm')
  expect(JSON.parse(await registry.execute('youtube_files', {}))).toMatchObject({ content_is_untrusted_data: true, channel: { id: 'channel' }, files: [{ id: 'selected' }] })
  expect(JSON.parse(await registry.execute('youtube_prepare', { ...input, unexpected_path: 'C:/secret' }))).toMatchObject({ status: 'pending_human_review' })
  expect(fake.prepare).toHaveBeenCalledWith(input, expect.any(AbortSignal))
  expect(JSON.parse(await registry.execute('youtube_videos', {})).content_is_untrusted_data).toBe(true)
})
it('requires explicit boolean classifications and an enabled channel for selected-file metadata', async () => {
  const registry = new ToolRegistry(); registerYouTubeTools(registry)
  expect(await registry.execute('youtube_prepare', { ...input, made_for_kids: undefined })).toContain('explicitamente')
  expect(fake.prepare).not.toHaveBeenCalled()
  fake.inventory.mockRejectedValue(new Error('Conecte e ative o canal YouTube.'))
  expect(await registry.execute('youtube_files', {})).toContain('ative')
  expect(fake.inventory).toHaveBeenCalledWith(expect.any(AbortSignal))
})
it('blocks read-only proposals, stopped operations, preview and mobile tools', async () => {
  const run = beginAgentRun({ readOnlyShellTurn: true })
  try { const registry = new ToolRegistry(); registerYouTubeTools(registry); expect(await registry.execute('youtube_prepare', input, 0, run)).toContain('somente leitura'); expect(fake.prepare).not.toHaveBeenCalled() } finally { endAgentRun(run) }
  const stopped = new ToolRegistry(); registerYouTubeTools(stopped); const abort = new AbortController(); abort.abort()
  await stopped.execute('youtube_videos', {}, 0, undefined, abort.signal); expect(fake.videos).not.toHaveBeenCalled()
  fake.available = false; expect(await stopped.execute('youtube_files', {})).toContain('desktop')
  fake.mobile = true; const mobile = new ToolRegistry(); registerYouTubeTools(mobile); expect(mobile.getAll()).toHaveLength(0)
})
