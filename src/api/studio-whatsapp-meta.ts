import { backendCall, isTauri } from './backend'
import { isMobile } from '../lib/device-kind'
import type { MessageConfig, MessageDelivery, MessageView } from '../lib/messaging'
export interface MetaCredentials { phone_id: string; access_token: string; app_secret: string; verify_token: string }
export interface MetaIdentity { phone_id: string; display_phone: string; name: string }
export interface MetaSettings { public_url: string; port: number }
export interface MetaView extends MessageView<string> {
  saved: MessageView<string>['saved'] & { settings: MetaSettings }
  local_address: string | null; verified_at: number | null; last_event_at: number | null; error: string | null
  identity: MetaIdentity | null
}
export function metaAvailable() { return isTauri() && !isMobile() }
async function call<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  if (!metaAvailable()) throw new Error('Configure o WhatsApp oficial no aplicativo desktop.')
  return backendCall<T>(command, args)
}
export const metaStatus = () => call<boolean>('studio_whatsapp_meta_status')
export const verifyMeta = (input?: MetaCredentials) => call<MetaIdentity>('studio_whatsapp_meta_verify', { input: input ?? null })
export const removeMeta = () => call<void>('studio_whatsapp_meta_remove')
export const saveMetaSettings = (settings: MetaSettings) => call<void>('studio_whatsapp_meta_settings', { settings })
export const metaRuntime = () => call<MetaView>('studio_whatsapp_meta_runtime')
export const startMeta = (config: MessageConfig<string>) => call<string>('studio_whatsapp_meta_start', { config })
export const stopMeta = () => call<void>('studio_whatsapp_meta_stop')
export const pollMeta = (sessionId: string) => call<MessageDelivery<string> | null>('studio_whatsapp_meta_poll', { sessionId })
export const finishMeta = (sessionId: string, deliveryId: string, reply: string | null, conversationId: string | null) => call<void>('studio_whatsapp_meta_finish', { sessionId, deliveryId, reply, conversationId })
export const sendMeta = (sessionId: string, deliveryId: string) => call<void>('studio_whatsapp_meta_send', { sessionId, deliveryId })
export const discardMeta = (deliveryId: string) => call<void>('studio_whatsapp_meta_discard', { deliveryId })
