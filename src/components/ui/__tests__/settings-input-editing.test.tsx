// @vitest-environment jsdom
import { useState } from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { SettingsNumberInput, SettingsTextInput } from '../SettingsNumberInput'
afterEach(cleanup)
function Numeric() {
  const [value, setValue] = useState(20)
  return <><SettingsNumberInput aria-label="limit" min={1} value={value} onChange={e => setValue(Math.max(1, Number(e.target.value) || 20))} /><output>{value}</output></>
}
it('allows clearing and replacing a number without clamping each keystroke', () => {
  render(<Numeric />)
  const field = screen.getByLabelText('limit') as HTMLInputElement
  act(() => field.focus())
  fireEvent.change(field, { target: { value: '' } })
  expect(field.value).toBe('')
  expect(screen.getByText('20', { selector: 'output' })).toBeTruthy()
  fireEvent.change(field, { target: { value: '350' } })
  fireEvent.keyDown(field, { key: 'Enter' })
  expect(screen.getByText('350', { selector: 'output' })).toBeTruthy()
})
it('Escape discards a draft without writing settings', () => {
  const write = vi.fn()
  render(<SettingsNumberInput aria-label="limit" value={20} onChange={write} />)
  const field = screen.getByLabelText('limit') as HTMLInputElement
  act(() => field.focus())
  fireEvent.change(field, { target: { value: '99' } })
  fireEvent.keyDown(field, { key: 'Escape' })
  expect(write).not.toHaveBeenCalled()
  expect(field.value).toBe('20')
})
it('commits negative sentinel values intact on blur', () => {
  const write = vi.fn(e => expect(e.target.value).toBe('-1'))
  render(<SettingsNumberInput aria-label="threads" value={8} onChange={write} />)
  const field = screen.getByLabelText('threads')
  act(() => field.focus())
  fireEvent.change(field, { target: { value: '-1' } })
  act(() => field.blur())
  expect(write).toHaveBeenCalledTimes(1)
})
it('keeps a URL draft stable through rerenders and saves once on blur', () => {
  const write = vi.fn(e => expect(e.target.value).toBe('http://localhost:8129/v1'))
  const view = render(<SettingsTextInput aria-label="URL" value="old" onChange={write} />)
  const field = screen.getByLabelText('URL') as HTMLInputElement
  act(() => field.focus())
  fireEvent.change(field, { target: { value: 'http://localhost:8129/v1' } })
  view.rerender(<SettingsTextInput aria-label="URL" value="old" onChange={write} />)
  expect(field.value).toBe('http://localhost:8129/v1')
  expect(write).not.toHaveBeenCalled()
  act(() => field.blur())
  expect(write).toHaveBeenCalledTimes(1)
})
