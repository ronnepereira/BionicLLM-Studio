/** @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import { SidePanel } from '../SidePanel'
import { useSidePanelStore } from '../../../stores/sidePanelStore'
import { useBrowserStore } from '../../../stores/browserStore'

vi.mock('../../browser/BrowserPanel', () => ({ BrowserPanel: ({ active }: { active: boolean }) => <div data-testid="browser-probe">{active ? 'visible' : 'hidden'}</div> }))
vi.mock('../../chat/ExplorerPanel', () => ({ ExplorerPanel: () => <div>Explorador preservado</div> }))
vi.mock('../ReviewPanel', () => ({ ReviewPanel: () => <div>Revisão preservada</div> }))
vi.mock('../TerminalPanel', () => ({ TerminalPanel: () => <div>Terminal preservado</div> }))
beforeEach(() => {
  useSidePanelStore.setState({ open: false, active: null, visited: [], size: 50 })
  useBrowserStore.setState({ open: false, ready: false, ownerToken: null })
})
afterEach(cleanup)

it('starts closed, opens at half width and keeps the file panel mounted across tabs', () => {
  render(<SidePanel visible />)
  expect(screen.queryByRole('complementary', { name: 'Painel lateral' })).toBeNull()
  act(() => useSidePanelStore.getState().show())
  expect(screen.getByRole('separator').getAttribute('aria-valuenow')).toBe('50')
  fireEvent.click(screen.getByRole('tab', { name: 'Abrir arquivo' }))
  const explorer = screen.getByText('Explorador preservado')
  fireEvent.click(screen.getByRole('tab', { name: 'Revisão' }))
  expect(screen.getByText('Explorador preservado')).toBe(explorer)
  expect(explorer.closest('[role="tabpanel"]')?.hasAttribute('hidden')).toBe(true)
  expect(screen.getByRole('tabpanel', { name: 'Revisão' })).toBeTruthy()
})

it('AI/browser opening reveals the browser tab, hides the native view on other tabs or views and can close', () => {
  const view = render(<SidePanel visible />)
  act(() => useBrowserStore.getState().setOpen(true))
  expect(screen.getByRole('tab', { name: 'Navegador' }).getAttribute('aria-selected')).toBe('true')
  expect(screen.getByTestId('browser-probe').textContent).toBe('visible')
  fireEvent.click(screen.getByRole('tab', { name: 'Revisão' }))
  expect(screen.getByTestId('browser-probe').textContent).toBe('hidden')
  act(() => useBrowserStore.getState().setOpen(true))
  view.rerender(<SidePanel visible={false} />)
  expect(screen.getByTestId('browser-probe').textContent).toBe('hidden')
  view.rerender(<SidePanel visible />)
  fireEvent.click(screen.getByRole('button', { name: 'Ocultar painel lateral' }))
  expect(useSidePanelStore.getState().open).toBe(false)
  expect(useBrowserStore.getState().ownerToken).toBeNull()
})

it('supports keyboard tab focus and deliberate activation', () => {
  act(() => useSidePanelStore.getState().show('review'))
  render(<SidePanel visible />)
  const selected = screen.getByRole('tab', { name: 'Revisão' })
  selected.focus()
  fireEvent.keyDown(selected, { key: 'ArrowRight' })
  expect(document.activeElement).toBe(screen.getByRole('tab', { name: 'Navegador' }))
  expect(useSidePanelStore.getState().active).toBe('review')
  fireEvent.click(document.activeElement!)
  expect(useSidePanelStore.getState().active).toBe('browser')
})

it.each(['pointerup', 'pointercancel', 'lostpointercapture', 'missing-button'])('releases the shared resize handle after %s', type => {
  act(() => useSidePanelStore.getState().show('review'))
  render(<SidePanel visible />)
  const handle = screen.getByRole('separator')
  handle.setPointerCapture = vi.fn(); handle.hasPointerCapture = vi.fn(() => true); handle.releasePointerCapture = vi.fn()
  vi.spyOn(handle.parentElement!, 'getBoundingClientRect').mockReturnValue({ width: 1000, height: 800 } as DOMRect)
  const pointer = (type: string, x: number, buttons: number) => { const event = new MouseEvent(type, { bubbles: true, clientX: x, buttons, button: 0 }); Object.defineProperty(event, 'pointerId', { value: 1 }); fireEvent(handle, event) }
  pointer('pointerdown', 500, 1)
  pointer('pointermove', 450, 1)
  expect(useSidePanelStore.getState().size).toBe(55)
  if (type === 'missing-button') pointer('pointermove', 400, 0)
  else pointer(type, 450, 0)
  pointer('pointermove', 300, 1)
  expect(useSidePanelStore.getState().size).toBe(55)
})
