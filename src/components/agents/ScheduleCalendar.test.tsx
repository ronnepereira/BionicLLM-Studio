/** @vitest-environment jsdom */
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { ScheduleCalendar } from './ScheduleCalendar'
import { useSettingsStore } from '../../stores/settingsStore'

const google = vi.hoisted(() => ({ status: vi.fn(), read: vi.fn() }))
vi.mock('../../api/studio-google', () => ({ googleAvailable: () => true, googleStatus: google.status, readGoogle: google.read }))
beforeEach(() => {
  google.status.mockReset(); google.read.mockReset()
  useSettingsStore.setState(state => ({ settings: { ...state.settings, language: 'pt-BR' } }))
})
afterEach(cleanup)

it('shows connected Google events for the chosen period and retains earlier pages', async () => {
  google.status.mockResolvedValue({ configured: true, services: [{ service: 'calendar', enabled: true }] })
  const start = new Date(Date.now() + 3_600_000).toISOString()
  const end = new Date(Date.now() + 7_200_000).toISOString()
  google.read.mockResolvedValueOnce({ items: [{ id: 'one', summary: 'Reunião Google', start: { dateTime: start }, end: { dateTime: end } }], nextPageToken: 'second' })
    .mockResolvedValueOnce({ items: [{ id: 'two', summary: 'Segundo evento', start: { dateTime: start }, end: { dateTime: end } }] })
  const view = render(<ScheduleCalendar items={[]} onEdit={vi.fn()} />)
  await view.findByRole('button', { name: /Reunião Google/ })
  expect(google.read).toHaveBeenCalledWith(expect.objectContaining({ action: 'calendar_list', start: expect.any(String), end: expect.any(String) }), expect.any(AbortSignal))
  fireEvent.click(view.getByRole('button', { name: 'Carregar mais eventos' }))
  await view.findByRole('button', { name: /Segundo evento/ })
  expect(view.getByRole('button', { name: /Reunião Google/ })).toBeTruthy()
  expect(google.read).toHaveBeenLastCalledWith(expect.objectContaining({ page_token: 'second' }), expect.any(AbortSignal))
})

it('keeps the calendar local when Google Calendar is disconnected', async () => {
  google.status.mockResolvedValue({ configured: false, services: [] })
  const view = render(<ScheduleCalendar items={[]} onEdit={vi.fn()} />)
  await waitFor(() => expect(google.status).toHaveBeenCalled())
  expect(google.read).not.toHaveBeenCalled()
  expect(view.queryByText('Google Agenda')).toBeNull()
})
