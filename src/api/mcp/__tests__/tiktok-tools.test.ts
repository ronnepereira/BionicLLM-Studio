import { beforeEach, expect, it, vi } from 'vitest'
const fake = vi.hoisted(() => ({ available: true, mobile: false, inventory: vi.fn(), videos: vi.fn(), prepare: vi.fn() }))
vi.mock('../../studio-tiktok', () => ({ tiktokAvailable: () => fake.available, tiktokInventory: fake.inventory, tiktokVideos: fake.videos, prepareTikTok: fake.prepare }))
vi.mock('../../../lib/device-kind', () => ({ isMobile: () => fake.mobile }))
import { registerTikTokTools } from '../tiktok-tools'
import { ToolRegistry } from '../tool-registry'
import { beginAgentRun, endAgentRun } from '../../agent-context'
import { DEFAULT_PERMISSIONS } from '../types'
beforeEach(() => { fake.available = true; fake.mobile = false; fake.inventory.mockReset().mockResolvedValue({ identity: { open_id: 'account' }, files: [{ id: 'selected', name: '<script>data</script>' }] }); fake.videos.mockReset().mockResolvedValue({ items: [] }); fake.prepare.mockReset().mockResolvedValue({ id: 'draft', account: 'account' }) })
it('offers reads and local proposals with no upload, direct publication or file-picking tool', async () => {
  const registry = new ToolRegistry(); registerTikTokTools(registry)
  expect(registry.getAll()).toHaveLength(3)
  for (const name of ['tiktok_upload', 'tiktok_publish', 'tiktok_pick']) expect(registry.getToolByName(name)).toBeUndefined()
  expect(registry.getPermissionLevel('tiktok_prepare', DEFAULT_PERMISSIONS)).toBe('confirm')
  expect(JSON.parse(await registry.execute('tiktok_files', {}))).toMatchObject({ content_is_untrusted_data: true, identity: { open_id: 'account' } })
  expect(JSON.parse(await registry.execute('tiktok_prepare', { file_id: 'selected', note: 'Local only', path: 'C:/secret', caption: 'Not sent' })).status).toBe('pending_human_review')
  expect(fake.prepare).toHaveBeenCalledWith({ file_id: 'selected', note: 'Local only' }, expect.any(AbortSignal))
  expect(JSON.parse(await registry.execute('tiktok_videos', {})).content_is_untrusted_data).toBe(true)
})
it('forwards native authorization failures and requires explicit local-note input', async () => {
  const registry = new ToolRegistry(); registerTikTokTools(registry)
  fake.inventory.mockRejectedValue(new Error('Conecte e ative o TikTok.'))
  expect(await registry.execute('tiktok_files', {})).toContain('ative')
  expect(await registry.execute('tiktok_prepare', { file_id: 'selected' })).toContain('notas locais'); expect(fake.prepare).not.toHaveBeenCalled()
})
it('blocks proposals in read-only turns, stopped work, preview and mobile tools', async () => {
  const run = beginAgentRun({ readOnlyShellTurn: true })
  try { const registry = new ToolRegistry(); registerTikTokTools(registry); expect(await registry.execute('tiktok_prepare', { file_id: 'selected', note: '' }, 0, run)).toContain('somente leitura'); expect(fake.prepare).not.toHaveBeenCalled() } finally { endAgentRun(run) }
  const registry = new ToolRegistry(); registerTikTokTools(registry); const abort = new AbortController(); abort.abort()
  await registry.execute('tiktok_videos', {}, 0, undefined, abort.signal); expect(fake.videos).not.toHaveBeenCalled()
  fake.available = false; expect(await registry.execute('tiktok_files', {})).toContain('desktop')
  fake.mobile = true; const mobile = new ToolRegistry(); registerTikTokTools(mobile); expect(mobile.getAll()).toHaveLength(0)
})
