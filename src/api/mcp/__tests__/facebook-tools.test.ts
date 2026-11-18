import { beforeEach, expect, it, vi } from 'vitest'
const fake = vi.hoisted(() => ({ available: true, mobile: false, posts: vi.fn(), prepare: vi.fn() }))
vi.mock('../../studio-facebook', () => ({ facebookAvailable: () => fake.available, facebookPosts: fake.posts, prepareFacebook: fake.prepare }))
vi.mock('../../../lib/device-kind', () => ({ isMobile: () => fake.mobile }))
import { registerFacebookTools } from '../facebook-tools'
import { ToolRegistry } from '../tool-registry'
import { beginAgentRun, endAgentRun } from '../../agent-context'
import { DEFAULT_PERMISSIONS } from '../types'
beforeEach(() => { fake.available = true; fake.mobile = false; fake.posts.mockReset().mockResolvedValue({ items: [] }); fake.prepare.mockReset().mockResolvedValue({ id: 'draft', account: '123' }) })
it('offers reading and local proposals, without a publication tool', async () => {
  const registry = new ToolRegistry(); registerFacebookTools(registry)
  expect(registry.getAll()).toHaveLength(2); expect(registry.getToolByName('facebook_page_publish')).toBeUndefined()
  expect(registry.getPermissionLevel('facebook_page_prepare', DEFAULT_PERMISSIONS)).toBe('confirm')
  const result = JSON.parse(await registry.execute('facebook_page_prepare', { message: 'text' }))
  expect(result.status).toBe('pending_human_review'); expect(fake.prepare).toHaveBeenCalledWith('text', expect.any(AbortSignal))
  const read = JSON.parse(await registry.execute('facebook_page_posts', {})); expect(read.content_is_untrusted_data).toBe(true)
})
it('blocks proposals in read-only turns, stopped work and mobile tools', async () => {
  const run = beginAgentRun({ readOnlyShellTurn: true })
  try { const registry = new ToolRegistry(); registerFacebookTools(registry); expect(await registry.execute('facebook_page_prepare', { message: 'text' }, 0, run)).toContain('somente leitura'); expect(fake.prepare).not.toHaveBeenCalled() } finally { endAgentRun(run) }
  fake.mobile = true; const mobile = new ToolRegistry(); registerFacebookTools(mobile); expect(mobile.getAll()).toHaveLength(0)
  fake.mobile = false; const stopped = new ToolRegistry(); registerFacebookTools(stopped); const abort = new AbortController(); abort.abort(); await stopped.execute('facebook_page_posts', {}, 0, undefined, abort.signal); expect(fake.posts).not.toHaveBeenCalled()
})
