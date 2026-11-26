/** @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import { SidePanel } from '../SidePanel'
import { useSidePanelStore } from '../../../stores/sidePanelStore'
import { useBrowserStore } from '../../../stores/browserStore'

vi.mock('../../browser/BrowserPanel', async importOriginal => ({
  ...await importOriginal<typeof import('../../browser/BrowserPanel')>(),
  BrowserPanel: ({ active }: { active: boolean }) => <div data-testid="browser-probe">{active ? 'visible' : 'hidden'}</div>,
}))
vi.mock('../../chat/ExplorerPanel', () => ({ ExplorerPanel: () => <div>Explorador preservado</div> }))
vi.mock('../ReviewPanel', () => ({ ReviewPanel: () => <div>Revisão preservada</div> }))
vi.mock('../TerminalPanel', () => ({ TerminalPanel: () => <div>Terminal preservado</div> }))
beforeEach(() => {
  useSidePanelStore.setState({ open: false, active: null, visited: [], size: 50 })
  useBrowserStore.setState({ open: false, ready: false, ownerToken: null, tabs: [], activeTab: null })
})
afterEach(cleanup)

it('shows only the selected tool and restores the menu when its tab is closed', () => {
  render(<SidePanel visible />)
  expect(screen.queryByRole('complementary', { name: 'Painel lateral' })).toBeNull()
  act(() => useSidePanelStore.getState().showMenu())
  expect(screen.getByRole('separator').getAttribute('aria-valuenow')).toBe('50')
  expect(screen.queryByRole('tablist')).toBeNull()
  expect(screen.queryByRole('button', { name: 'Ocultar painel lateral' })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: /^Abrir arquivo/ }))
  const explorer = screen.getByText('Explorador preservado')
  expect(screen.getByRole('region', { name: 'Abrir arquivo' })).toBeTruthy()
  expect(screen.queryByRole('button', { name: /Revisão|Navegador|Terminal/ })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Fechar Abrir arquivo' }))
  expect(explorer.closest('[role="region"]')?.hasAttribute('hidden')).toBe(true)
  fireEvent.click(screen.getByRole('button', { name: /^Revisão/ }))
  expect(screen.getByRole('region', { name: 'Revisão' })).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Fechar Revisão' }))
  expect(screen.getByRole('button', { name: /^Terminal/ })).toBeTruthy()
})

it('AI/browser opening reveals the browser tab, hides the native view on other tabs or views and can close', () => {
  const view = render(<SidePanel visible />)
  act(() => useBrowserStore.getState().setOpen(true))
  expect(screen.getByRole('tab', { name: 'Navegador' }).getAttribute('aria-selected')).toBe('true')
  expect(screen.getByTestId('browser-probe').textContent).toBe('visible')
  fireEvent.keyDown(window, { key: 'r', ctrlKey: true, altKey: true })
  expect(screen.getByTestId('browser-probe').textContent).toBe('hidden')
  act(() => useBrowserStore.getState().setOpen(true))
  view.rerender(<SidePanel visible={false} />)
  expect(screen.getByTestId('browser-probe').textContent).toBe('hidden')
  view.rerender(<SidePanel visible />)
  act(() => useSidePanelStore.getState().close())
  expect(useSidePanelStore.getState().open).toBe(false)
  expect(useBrowserStore.getState().ownerToken).toBeNull()
})

it('keeps browser tabs independent and shows the menu only after the last is closed', () => {
  act(() => useSidePanelStore.getState().showMenu())
  render(<SidePanel visible />)
  fireEvent.click(screen.getByRole('button', { name: /^Navegador/ }))
  const first = useBrowserStore.getState().activeTab
  fireEvent.click(screen.getByRole('button', { name: 'Nova aba' }))
  expect(useBrowserStore.getState().activeTab).not.toBe(first)
  expect(screen.getAllByRole('tab')).toHaveLength(2)
  expect(screen.queryByRole('button', { name: /^Revisão/ })).toBeNull()
  const second = screen.getByRole('tab', { name: 'Nova aba 2' })
  second.focus()
  fireEvent.keyDown(second, { key: 'ArrowLeft' })
  expect(useBrowserStore.getState().activeTab).toBe(first)
  fireEvent.click(screen.getByRole('button', { name: 'Fechar Nova aba 1' }))
  expect(screen.getByRole('tab', { name: 'Navegador' })).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Fechar Navegador' }))
  expect(screen.queryByRole('tab')).toBeNull()
  expect(screen.getByRole('button', { name: /^Revisão/ })).toBeTruthy()
  expect(useSidePanelStore.getState().open).toBe(true)
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
