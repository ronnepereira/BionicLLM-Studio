/** @vitest-environment jsdom */
import { render, screen, fireEvent, waitFor, cleanup, within } from '@testing-library/react'
import { afterEach, describe, it, expect, vi } from 'vitest'
const api = vi.hoisted(() => ({ call: vi.fn() }))
vi.mock('../../../api/backend', () => ({ backendCall: api.call, isTauri: () => false }))
vi.mock('../HtmlPreviewFrame', () => ({ HtmlPreviewFrame: () => <div>Documento HTML</div>, ViewportSwitcher: () => null }))
vi.mock('../CodeBlock', () => ({ CodeBlock: ({ code }: {code: string}) => <pre>{code}</pre> }))
import { FilePreview } from '../FilePreview'
afterEach(() => { cleanup(); vi.clearAllMocks() })
function setup(deleteLocked?: string) {
  api.call.mockImplementation(async (command: string) => command === 'fs_read' ? { content: '<html></html>' } : { trashed: true })
  const onTrashed = vi.fn()
  const view = render(<FilePreview node={{ name: 'proof.html', path: 'C:/project/proof.html', isDirectory: false }} root="C:/project" onClose={() => {}} onTrashed={onTrashed} deleteLocked={deleteLocked} />)
  return { onTrashed, ...view }
}
describe('Explorer sends a file to the Recycle Bin only after confirmation', () => {
  it('canceling leaves the file and preview intact', async () => {
    setup()
    fireEvent.click(screen.getByTestId('explorer-delete-file'))
    expect(screen.getByRole('dialog')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }))
    expect(api.call.mock.calls.some(([command]) => command === 'fs_trash')).toBe(false)
  })
  it('confirms the exact file and updates the tree only after native success', async () => {
    const { onTrashed } = setup()
    fireEvent.click(screen.getByTestId('explorer-delete-file'))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Excluir arquivo' }))
    await waitFor(() => expect(onTrashed).toHaveBeenCalledWith('C:/project/proof.html'))
    expect(api.call).toHaveBeenCalledWith('fs_trash', { path: 'C:/project/proof.html', workingDirectory: 'C:/project' })
  })
  it('is disabled during an active Code run', () => {
    setup('Execução em andamento')
    expect((screen.getByTestId('explorer-delete-file') as HTMLButtonElement).disabled).toBe(true)
  })
  it('a native error keeps the preview and shows the failure', async () => {
    const { onTrashed } = setup()
    api.call.mockImplementation(async (command: string) => { if(command === 'fs_trash') throw new Error('Arquivo em uso'); return { content: '<html></html>' } })
    fireEvent.click(screen.getByTestId('explorer-delete-file'))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Excluir arquivo' }))
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Arquivo em uso'))
    expect(onTrashed).not.toHaveBeenCalled()
  })
})
