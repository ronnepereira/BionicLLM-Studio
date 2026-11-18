/** @vitest-environment jsdom */
import { render, screen, cleanup, waitFor } from '@testing-library/react'
import { HtmlPreviewFrame } from '../HtmlPreviewFrame'
import * as backend from '../../../api/backend'

vi.mock('../../../api/backend', () => ({ isTauri: () => true, isMobile: () => false, backendCall: vi.fn() }))
afterEach(() => { cleanup(); vi.restoreAllMocks() })

it('loads an isolated native document and remounts when scripts are enabled or disabled', async () => {
  vi.mocked(backend.backendCall).mockResolvedValue({ id: 'preview-1', url: 'http://127.0.0.1:1234/preview-1' })
  const { rerender, unmount } = render(<HtmlPreviewFrame doc="<button>Iniciar</button>" viewport="desktop" allowScripts={false} />)
  const frame = await waitFor(() => {
    const frame = screen.getByTitle('HTML Preview') as HTMLIFrameElement
    expect(frame.src).toBe('http://127.0.0.1:1234/preview-1')
    return frame
  })
  expect(frame.hasAttribute('srcdoc')).toBe(false)
  expect(frame.getAttribute('sandbox')).toBe('')
  rerender(<HtmlPreviewFrame doc="<button>Iniciar</button>" viewport="desktop" allowScripts />)
  const enabled = screen.getByTitle('HTML Preview')
  expect(enabled).not.toBe(frame)
  expect(enabled.getAttribute('sandbox')).toBe('allow-scripts')
  rerender(<HtmlPreviewFrame doc="<button>Iniciar</button>" viewport="desktop" allowScripts={false} />)
  expect(screen.getByTitle('HTML Preview')).not.toBe(enabled)
  expect(screen.getByTitle('HTML Preview').getAttribute('sandbox')).toBe('')
  unmount()
  expect(backend.backendCall).toHaveBeenCalledWith('html_preview', { action: 'close', id: 'preview-1' })
})

it('closes a session that arrives after the component was unmounted', async () => {
  let complete!: (value: unknown) => void
  vi.mocked(backend.backendCall).mockImplementation(() => new Promise(resolve => { complete = resolve }))
  const { unmount } = render(<HtmlPreviewFrame doc="test" viewport="desktop" allowScripts />)
  unmount()
  complete({ id: 'late', url: 'http://127.0.0.1:1234/late' })
  await waitFor(() => expect(backend.backendCall).toHaveBeenCalledWith('html_preview', { action: 'close', id: 'late' }))
})

it('reports native startup errors', async () => {
  vi.mocked(backend.backendCall).mockRejectedValue(new Error('Falha ao abrir prévia'))
  render(<HtmlPreviewFrame doc="test" viewport="desktop" allowScripts />)
  expect((await screen.findByRole('alert')).textContent).toBe('Falha ao abrir prévia')
})
