import { backendCall, isTauri } from './backend'
import { isMobile } from '../lib/device-kind'
import type { MessageConfig, MessageDelivery, MessageView } from '../lib/messaging'
export type WhatsAppConfig = MessageConfig<string>
export interface WhatsAppView extends MessageView<string> {
  phase: 'disconnected' | 'connecting' | 'qr' | 'connected' | 'logged-out' | 'error'
  qr: string | null; error: string | null
}
export interface WhatsAppComponent { ready: boolean; version: string; node: boolean }
export function whatsappAvailable() { return isTauri() && !isMobile() }
async function call<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  if (!whatsappAvailable()) throw new Error('O WhatsApp funciona no aplicativo desktop, não na prévia web.')
  return backendCall<T>(command, args)
}
export const whatsappComponent = () => call<WhatsAppComponent>('studio_whatsapp_component')
export const installWhatsapp = () => call<WhatsAppComponent>('studio_whatsapp_install')
export const connectWhatsapp = () => call<WhatsAppView>('studio_whatsapp_connect')
export const disconnectWhatsapp = () => call<void>('studio_whatsapp_disconnect')
export const forgetWhatsapp = () => call<void>('studio_whatsapp_forget')
export const whatsappRuntime = () => call<WhatsAppView>('studio_whatsapp_runtime')
export const startWhatsapp = (config: WhatsAppConfig) => call<string>('studio_whatsapp_start', { config })
export const stopWhatsapp = () => call<void>('studio_whatsapp_stop')
export const pollWhatsapp = (sessionId: string) => call<MessageDelivery<string> | null>('studio_whatsapp_poll', { sessionId })
export const finishWhatsapp = (sessionId: string, deliveryId: string, reply: string | null, conversationId: string | null) => call<void>('studio_whatsapp_finish', { sessionId, deliveryId, reply, conversationId })
export const sendWhatsapp = (sessionId: string, deliveryId: string) => call<void>('studio_whatsapp_send', { sessionId, deliveryId })
export const discardWhatsapp = (deliveryId: string) => call<void>('studio_whatsapp_discard', { deliveryId })
