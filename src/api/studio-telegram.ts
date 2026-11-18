import { backendCall, isTauri } from './backend'
import { isMobile } from '../lib/device-kind'

export interface TelegramBot { id: number; first_name: string; username: string }
export function telegramAvailable() { return isTauri() && !isMobile() }
function desktopOnly() {
  if (!telegramAvailable()) throw new Error('Configure o Telegram no aplicativo desktop.')
}
/** Local vault presence only; no online request or token returned. */
export async function telegramStatus(): Promise<boolean> {
  desktopOnly()
  return backendCall<boolean>('studio_telegram_status')
}
/** getMe only. A supplied token replaces the vault credential only after validation. */
export async function verifyTelegram(token?: string): Promise<TelegramBot> {
  desktopOnly()
  return backendCall<TelegramBot>('studio_telegram_verify', { token: token?.trim() ?? null })
}
export async function disconnectTelegram(): Promise<void> {
  desktopOnly()
  await backendCall('studio_telegram_disconnect')
}

export interface TelegramConfig { chats: number[]; agent_id: string; auto_reply: boolean }
export interface TelegramDelivery {
  id: string; bot_id: number; update_id: number; message_id: number; chat_id: number
  text: string; received_at: number
  status: 'processing' | 'draft' | 'sent' | 'failed' | 'interrupted' | 'skipped' | 'uncertain'
  reply: string | null; conversation_id: string | null
}
export interface TelegramView {
  active: boolean
  saved: { config: TelegramConfig; bot_id: number; offset: number; history: TelegramDelivery[] }
}
export async function telegramRuntime(): Promise<TelegramView> {
  desktopOnly(); return backendCall('studio_telegram_runtime')
}
export async function startTelegram(config: TelegramConfig): Promise<string> {
  desktopOnly(); return backendCall('studio_telegram_start', { config })
}
export async function stopTelegram(): Promise<void> {
  desktopOnly(); await backendCall('studio_telegram_stop')
}
export async function pollTelegram(sessionId: string): Promise<TelegramDelivery | null> {
  desktopOnly(); return backendCall('studio_telegram_poll', { sessionId })
}
export async function finishTelegram(sessionId: string, deliveryId: string, reply: string | null, conversationId: string | null): Promise<void> {
  desktopOnly(); await backendCall('studio_telegram_finish', { sessionId, deliveryId, reply, conversationId })
}
export async function sendTelegram(sessionId: string, deliveryId: string): Promise<void> {
  desktopOnly(); await backendCall('studio_telegram_send', { sessionId, deliveryId })
}
export async function discardTelegram(deliveryId: string): Promise<void> {
  desktopOnly(); await backendCall('studio_telegram_discard', { deliveryId })
}
