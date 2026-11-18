/** @vitest-environment jsdom */
import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { ReasoningEffortPicker } from '../ReasoningEffortPicker'
import { useSettingsStore } from '../../../stores/settingsStore'

afterEach(cleanup)
it('selects an effort directly from one reasoning menu, including off and default', () => {
  useSettingsStore.setState(state => ({ settings: { ...state.settings, language: 'pt-BR' } }))
  const select = vi.fn()
  const view = render(<ReasoningEffortPicker thinking lockedOn={false} levels={['low', 'medium', 'high']} selected="medium" defaultSelected={false} allowDefault onSelect={select} />)
  fireEvent.click(view.getByTestId('effort-toggle'))
  expect(view.getAllByRole('menuitemradio')).toHaveLength(5)
  fireEvent.click(view.getByRole('menuitemradio', { name: 'Alto' }))
  expect(select).toHaveBeenCalledWith('high')
  expect(view.queryByRole('menu')).toBeNull()
})
