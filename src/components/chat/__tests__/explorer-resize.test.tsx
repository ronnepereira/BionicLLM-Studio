/** @vitest-environment jsdom */
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
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
