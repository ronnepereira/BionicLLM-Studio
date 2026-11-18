// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
const config = vi.hoisted(() => ({ port: 8129, lan: true, lanHost: null as string | null, token: 'test-only-token', corsOrigins: [], mitLuStarten: false, laeuft: false, fehler: null, setPort: vi.fn(), setLan: vi.fn(), setCors: vi.fn(), setMitLuStarten: vi.fn(), neuesToken: vi.fn(), starten: vi.fn(), stoppen: vi.fn(), auffrischen: vi.fn() }))
vi.mock('../../../stores/localApiStore', () => ({ useLocalApiStore: () => config }))
vi.mock('../../../lib/ui-text', () => ({ useUiText: () => (text: string) => text }))
vi.mock('../../../api/backend', () => ({ backendCall: vi.fn() }))
import { LocalApiSettings } from '../LocalApiSettings'
beforeEach(() => { config.lan = true; config.lanHost = null })
afterEach(cleanup)
it('offers a concrete local URL while LAN detection has no address', () => {
  render(<LocalApiSettings />)
  expect(screen.getAllByText('http://127.0.0.1:8129/v1').length).toBeGreaterThan(0)
  expect(document.body.textContent).not.toContain('<this-machine-IP>')
  expect(document.body.textContent).toContain('No LAN address detected. The local address above still works on this computer.')
})
it('shows detected LAN URL separately without changing the local client URL', () => {
  config.lanHost = '192.168.0.42'
  render(<LocalApiSettings />)
  expect(screen.getAllByText('http://127.0.0.1:8129/v1').length).toBeGreaterThan(0)
  expect(screen.getByText('http://192.168.0.42:8129/v1')).toBeTruthy()
})
it('does not offer a network URL when LAN is disabled', () => {
  config.lan = false; config.lanHost = '192.168.0.42'
  render(<LocalApiSettings />)
  expect(screen.queryByText('http://192.168.0.42:8129/v1')).toBeNull()
})
