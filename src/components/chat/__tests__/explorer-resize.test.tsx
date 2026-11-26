/** @vitest-environment jsdom */
import { render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react'
import { ExplorerPanel } from '../ExplorerPanel'
import { useUIStore } from '../../../stores/uiStore'
import { useCodexStore } from '../../../stores/codexStore'
import * as backend from '../../../api/backend'

function pointer(handle: Element, type: string, x: number, buttons = 1) {
  const event = new MouseEvent(type, { bubbles: true, clientX: x, button: 0, buttons })
  Object.defineProperty(event, 'pointerId', { value: 1 })
  fireEvent(handle, event)
}
beforeEach(() => {
  vi.spyOn(backend, 'backendCall').mockResolvedValue({ entries: [], truncated: false })
  useCodexStore.setState({ workingDirectory: '' })
  useUIStore.setState({ explorerWidth: 350, explorerCollapsed: false })
})
afterEach(() => { cleanup(); vi.restoreAllMocks() })

it.each(['pointerup', 'pointercancel', 'lostpointercapture'])('ends resizing on %s', type => {
  render(<ExplorerPanel onApprovePlan={() => {}} />)
  const handle = screen.getByTestId('explorer-resize-handle')
  handle.setPointerCapture = vi.fn()
  handle.hasPointerCapture = vi.fn(() => true)
  handle.releasePointerCapture = vi.fn()
  pointer(handle, 'pointerdown', 500)
  expect(handle.setPointerCapture).toHaveBeenCalledWith(1)
  pointer(handle, 'pointermove', 450)
  expect(useUIStore.getState().explorerWidth).toBe(400)
  pointer(handle, type, 450, 0)
  pointer(handle, 'pointermove', 400)
  expect(useUIStore.getState().explorerWidth).toBe(400)
})

it('stops if the release was missed and the pointer returns without a pressed button', () => {
  render(<ExplorerPanel onApprovePlan={() => {}} />)
  const handle = screen.getByTestId('explorer-resize-handle')
  handle.setPointerCapture = vi.fn()
  handle.hasPointerCapture = vi.fn(() => true)
  handle.releasePointerCapture = vi.fn()
  pointer(handle, 'pointerdown', 500)
  pointer(handle, 'pointermove', 450, 0)
  pointer(handle, 'pointermove', 400)
  expect(useUIStore.getState().explorerWidth).toBe(350)
})

it('selects all listed items and recycles an expanded folder with its contents in one call', async () => {
  const root = 'C:/project'
  const folder = { name: 'docs', path: `${root}/docs`, isDir: true }
  const child = { name: 'note.txt', path: `${folder.path}/note.txt`, isDir: false }
  const file = { name: 'readme.txt', path: `${root}/readme.txt`, isDir: false }
  let entries = [folder, file]
  vi.mocked(backend.backendCall).mockImplementation(async (command, args) => {
    if (command === 'fs_list') return { entries: args?.path === folder.path ? [child] : entries }
    if (command === 'fs_trash') {
      entries = entries.filter(entry => entry.path !== args?.path)
      return { trashed: true }
    }
    return null
  })
  useCodexStore.setState({ workingDirectory: root })
  render(<ExplorerPanel embedded showPlan={false} onApprovePlan={() => {}} />)
  fireEvent.click(await screen.findByRole('button', { name: 'docs' }))
  await screen.findByRole('checkbox', { name: 'Selecionar note.txt' })
  fireEvent.click(screen.getByRole('checkbox', { name: 'Selecionar tudo' }))
  fireEvent.click(screen.getByRole('button', { name: 'Excluir selecionados (3)' }))
  const dialog = screen.getByRole('dialog')
  expect(within(dialog).getByText(folder.path)).toBeTruthy()
  expect(within(dialog).queryByText(child.path)).toBeNull()
  expect(vi.mocked(backend.backendCall).mock.calls.filter(([command]) => command === 'fs_trash')).toHaveLength(0)
  fireEvent.click(within(dialog).getByRole('button', { name: 'Enviar à Lixeira' }))
  await screen.findByText('2 itens enviados à Lixeira.')
  expect(vi.mocked(backend.backendCall).mock.calls.filter(([command]) => command === 'fs_trash')).toEqual([
    ['fs_trash', { path: folder.path, workingDirectory: root, isDirectory: true }],
    ['fs_trash', { path: file.path, workingDirectory: root, isDirectory: false }],
  ])
  expect(screen.queryByRole('checkbox', { name: 'Selecionar note.txt' })).toBeNull()
})

it('leaves skipped items alone and lets the user retry selected items that failed', async () => {
  const root = 'C:/project'
  const entries = ['busy.txt', 'moved.txt', 'skipped.txt'].map(name => ({ name, path: `${root}/${name}`, isDir: false }))
  vi.mocked(backend.backendCall).mockImplementation(async (command, args) => {
    if (command === 'fs_list') return { entries }
    if (command === 'fs_trash') {
      if (args?.path === `${root}/busy.txt`) throw new Error('Arquivo em uso')
      const index = entries.findIndex(entry => entry.path === args?.path)
      if (index >= 0) entries.splice(index, 1)
      return { trashed: true }
    }
    return null
  })
  useCodexStore.setState({ workingDirectory: root })
  render(<ExplorerPanel embedded showPlan={false} onApprovePlan={() => {}} />)
  fireEvent.click(await screen.findByRole('checkbox', { name: 'Selecionar busy.txt' }))
  fireEvent.click(screen.getByRole('checkbox', { name: 'Selecionar moved.txt' }))
  fireEvent.click(screen.getByRole('button', { name: 'Excluir selecionados (2)' }))
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Enviar à Lixeira' }))
  await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Arquivo em uso'))
  expect(screen.getByText('1 item enviado à Lixeira.')).toBeTruthy()
  expect((screen.getByRole('checkbox', { name: 'Selecionar busy.txt' }) as HTMLInputElement).checked).toBe(true)
  expect((screen.getByRole('checkbox', { name: 'Selecionar skipped.txt' }) as HTMLInputElement).checked).toBe(false)
  expect(screen.queryByRole('checkbox', { name: 'Selecionar moved.txt' })).toBeNull()
})
