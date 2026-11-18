/** @vitest-environment jsdom */
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { BrowserPanel } from '../BrowserPanel'
import { browserCommand } from '../../../api/studio-browser'
import { useBrowserStore } from '../../../stores/browserStore'

vi.mock('../../../lib/ui-text', () => ({ useUiText: () => (text: string) => text }))
vi.mock('../../../api/backend', () => ({ isTauri: () => true }))
vi.mock('../../../api/studio-browser', () => ({ browserCommand: vi.fn(async () => ({ ok: true })), browserUrl: (url: string) => url }))
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(async () => () => {}) }))

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
  vi.mocked(browserCommand).mockReset().mockResolvedValue({ ok: true })
  useBrowserStore.setState({ open: true, ready: true, ownerToken: null, error: null })
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

it('exposes cache clearing beside the address and waits for native completion', async () => {
  render(<BrowserPanel />)
  expect(screen.queryByRole('button', { name: 'Clear browser cache' })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Browser tools' }))
  let complete!: (result: Record<string, unknown>) => void
  vi.mocked(browserCommand).mockImplementationOnce(() => new Promise(resolve => { complete = resolve }))
  fireEvent.click(screen.getByRole('button', { name: 'Clear browser cache' }))
  expect(browserCommand).toHaveBeenCalledWith({ action: 'clear_cache' })
  expect(screen.getByRole('button', { name: 'Clearing cache...' }).hasAttribute('disabled')).toBe(true)
  expect(screen.getByRole('status').textContent).toBe('')
  complete({ ok: true })
  await waitFor(() => expect(screen.getByRole('status').textContent).toBe('Browser cache cleared.'))
})

it('shows a native failure and re-enables the cache button for retry', async () => {
  render(<BrowserPanel />)
  fireEvent.click(screen.getByRole('button', { name: 'Browser tools' }))
  vi.mocked(browserCommand).mockRejectedValueOnce(new Error('Falha ao limpar cache'))
  fireEvent.click(screen.getByRole('button', { name: 'Clear browser cache' }))
  await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('Falha ao limpar cache'))
  expect(screen.getByRole('status').textContent).toBe('')
  expect(screen.getByRole('button', { name: 'Clear browser cache' }).hasAttribute('disabled')).toBe(false)
})
