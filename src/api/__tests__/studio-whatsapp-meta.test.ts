import { beforeEach, expect, it, vi } from 'vitest'
const fake = vi.hoisted(() => ({ native: true, mobile: false, call: vi.fn() }))
vi.mock('../backend', () => ({ isTauri: () => fake.native, backendCall: (...args: unknown[]) => fake.call(...args) }))
vi.mock('../../lib/device-kind', () => ({ isMobile: () => fake.mobile }))
import * as api from '../studio-whatsapp-meta'
beforeEach(() => { fake.native = true; fake.mobile = false; fake.call.mockReset() })
const input = { phone_id: '1234567890', access_token: 'test_access_token_1234567890', app_secret: '0123456789abcdef0123456789abcdef', verify_token: 'verification-token-12345' }
it('refuses credential, webhook and receiver operations outside the desktop', async () => {
  for (const mobile of [false, true]) {
    fake.native = mobile; fake.mobile = mobile
    for (const action of [api.metaStatus, () => api.verifyMeta(input), api.removeMeta, api.metaRuntime, api.stopMeta,
      () => api.saveMetaSettings({ public_url: 'https://example.com/whatsapp/meta/webhook', port: 18782 }),
      () => api.startMeta({ chats: ['5511999999999@s.whatsapp.net'], agent_id: 'agent', auto_reply: false }),
      () => api.pollMeta('session'), () => api.finishMeta('session', 'delivery', 'Olá', null), () => api.sendMeta('session', 'delivery'), () => api.discardMeta('delivery')]) await expect(action()).rejects.toThrow(/desktop/)
  }
  expect(fake.call).not.toHaveBeenCalled()
})
it('never requests stored secrets from IPC and approves sends by record ID only', async () => {
  await api.verifyMeta()
  await api.sendMeta('session', 'delivery')
  expect(fake.call.mock.calls).toEqual([['studio_whatsapp_meta_verify', { input: null }], ['studio_whatsapp_meta_send', { sessionId: 'session', deliveryId: 'delivery' }]])
})
