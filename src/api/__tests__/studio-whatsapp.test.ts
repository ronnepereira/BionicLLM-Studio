import { beforeEach, expect, it, vi } from 'vitest'
const fake = vi.hoisted(() => ({ native: true, mobile: false, call: vi.fn() }))
vi.mock('../backend', () => ({ isTauri: () => fake.native, backendCall: (...args: unknown[]) => fake.call(...args) }))
vi.mock('../../lib/device-kind', () => ({ isMobile: () => fake.mobile }))
import * as api from '../studio-whatsapp'
beforeEach(() => { fake.native = true; fake.mobile = false; fake.call.mockReset() })
it('blocks pairing, installation and all receiver operations in a browser or phone', async () => {
  for (const mobile of [false, true]) {
    fake.native = mobile; fake.mobile = mobile
    for (const action of [api.whatsappComponent, api.installWhatsapp, api.connectWhatsapp, api.disconnectWhatsapp, api.forgetWhatsapp, api.whatsappRuntime, api.stopWhatsapp,
      () => api.startWhatsapp({ chats: ['5511999999999@s.whatsapp.net'], agent_id: 'agent', auto_reply: false }),
      () => api.pollWhatsapp('session'), () => api.sendWhatsapp('session', 'delivery'), () => api.discardWhatsapp('delivery'),
      () => api.finishWhatsapp('session', 'delivery', 'Olá!', null)]) await expect(action()).rejects.toThrow(/desktop/)
  }
  expect(fake.call).not.toHaveBeenCalled()
})
it('sends only a delivery ID for review approval, never an arbitrary destination or session key', async () => {
  await api.sendWhatsapp('session', 'delivery')
  expect(fake.call).toHaveBeenCalledWith('studio_whatsapp_send', { sessionId: 'session', deliveryId: 'delivery' })
})
