// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { AboutSettings } from '../AboutSettings'
import { APP_VERSION } from '../../../lib/app-version'
import { useSettingsStore } from '../../../stores/settingsStore'
import { openExternal } from '../../../api/backend'

vi.mock('../../../api/backend', () => ({ openExternal: vi.fn(async () => {}) }))
afterEach(() => { cleanup(); vi.clearAllMocks() })

it('shows attribution and opens PayPal with the requested recipient, amount and currency', () => {
  useSettingsStore.getState().updateSettings({ language: 'pt-BR' })
  render(<AboutSettings />)
  expect(screen.getByText(`Versão ${APP_VERSION}`)).toBeTruthy()
  expect(screen.getByText('Ronne Pereira')).toBeTruthy()
  expect(screen.getByText('ronne.pereira@gmail.com')).toBeTruthy()
  const link = screen.getByRole('link', { name: 'Pague um café — US$ 5' })
  const url = new URL(link.getAttribute('href')!)
  expect(url.origin).toBe('https://www.paypal.com')
  expect(url.searchParams.get('business')).toBe('ronne.pereira@gmail.com')
  expect(url.searchParams.get('amount')).toBe('5.00')
  expect(url.searchParams.get('currency_code')).toBe('USD')
  fireEvent.click(link)
  expect(openExternal).toHaveBeenCalledExactlyOnceWith(url.href)
})
