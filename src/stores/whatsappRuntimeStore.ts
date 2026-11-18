import { createMessageRuntime } from './createMessageRuntime'
import { discardWhatsapp, finishWhatsapp, pollWhatsapp, sendWhatsapp, startWhatsapp, stopWhatsapp, whatsappAvailable, whatsappRuntime } from '../api/studio-whatsapp'
export const useWhatsappRuntimeStore = createMessageRuntime<string>('WhatsApp', {
  available: whatsappAvailable, runtime: whatsappRuntime, start: startWhatsapp, stop: stopWhatsapp,
  poll: pollWhatsapp, finish: finishWhatsapp, send: sendWhatsapp, discard: discardWhatsapp,
})
