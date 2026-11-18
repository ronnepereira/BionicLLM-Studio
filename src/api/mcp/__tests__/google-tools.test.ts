import { beforeEach, expect, it, vi } from 'vitest'
const fake = vi.hoisted(() => ({ native: true, mobile: false, read: vi.fn(), prepare: vi.fn() }))
vi.mock('../../studio-google', () => ({ googleAvailable: () => fake.native, readGoogle: fake.read, prepareGoogle: fake.prepare }))
vi.mock('../../../lib/device-kind', () => ({ isMobile: () => fake.mobile }))
import { registerGoogleTools } from '../google-tools'
import { ToolRegistry } from '../tool-registry'
import { DEFAULT_PERMISSIONS } from '../types'
import { beginAgentRun, endAgentRun } from '../../agent-context'

beforeEach(() => { fake.native = true; fake.mobile = false; fake.read.mockReset().mockResolvedValue({ items: [] }); fake.prepare.mockReset().mockResolvedValue({ id: 'draft', account: 'test@example.com' }) })
it('registers reads and local proposals with existing permission gates, without an execution tool', async () => {
  const registry = new ToolRegistry(); registerGoogleTools(registry)
  expect(registry.getAll()).toHaveLength(7)
  for (const tool of registry.getAll()) {
    expect(tool.category).toBe(tool.name.endsWith('_prepare') ? 'workflow' : 'filesystem')
    expect(registry.getPermissionLevel(tool.name, DEFAULT_PERMISSIONS)).toBe('confirm')
  }
  const result = JSON.parse(await registry.execute('google_drive_search', { query: 'invoice' }))
  expect(result.content_is_untrusted_data).toBe(true)
  expect(fake.read).toHaveBeenCalledWith({ action: 'drive_list', query: 'invoice' }, expect.any(AbortSignal))
  expect(registry.getToolByName('google_execute')).toBeUndefined()
  const draft = JSON.parse(await registry.execute('google_gmail_prepare', { to: 'test@example.com', subject: 'Olá', text: 'Texto' }))
  expect(draft.status).toBe('pending_human_review')
  expect(fake.prepare).toHaveBeenCalledWith({ action: 'gmail_send', to: 'test@example.com', subject: 'Olá', text: 'Texto' }, expect.any(AbortSignal))
})
it('withdraws mobile tools and blocks unavailable native access and invalid input', async () => {
  fake.mobile = true
  const mobile = new ToolRegistry(); registerGoogleTools(mobile)
  expect(mobile.getAll()).toHaveLength(0)
  fake.mobile = false; fake.native = false
  const registry = new ToolRegistry(); registerGoogleTools(registry)
  expect(await registry.execute('google_gmail_read', { id: 'abc' })).toContain('desktop')
  fake.native = true
  expect(await registry.execute('google_gmail_search', { query: 42 })).toContain('Error:')
  expect(fake.read).not.toHaveBeenCalled()
})
it('passes Stop to active queries and does not start after Stop', async () => {
  const registry = new ToolRegistry(); registerGoogleTools(registry)
  const abort = new AbortController()
  let received!: AbortSignal
  fake.read.mockImplementation((_input, signal: AbortSignal) => { received = signal; return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('Operação Google cancelada.')), { once: true })) })
  const result = registry.execute('google_calendar_search', { query: '' }, 0, undefined, abort.signal)
  abort.abort()
  expect(received.aborted).toBe(true)
  expect(await result).toContain('cancelada')
  fake.read.mockClear()
  await registry.execute('google_gmail_search', { query: '' }, 0, undefined, abort.signal)
  expect(fake.read).not.toHaveBeenCalled()
})
it('refuses local proposals in a read-only turn even if the model emits the name', async () => {
  const run = beginAgentRun({ readOnlyShellTurn: true })
  try {
    const registry = new ToolRegistry(); registerGoogleTools(registry)
    expect(await registry.execute('google_drive_prepare', { name: 'test.txt', text: 'text' }, 0, run)).toContain('somente leitura')
    expect(fake.prepare).not.toHaveBeenCalled()
  } finally { endAgentRun(run) }
})
