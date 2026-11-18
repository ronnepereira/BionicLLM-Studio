import { backendCall, isTauri } from './backend'
import { isMobile } from '../lib/device-kind'
import type { ReviewDraft } from '../lib/review-actions'

export type GoogleService = 'gmail' | 'drive' | 'calendar'
export type GoogleOAuthService = GoogleService | 'youtube'
export interface GoogleStatus { service: GoogleOAuthService; email: string | null; enabled: boolean; write_access?: boolean }
export interface GoogleOverview { configured: boolean; services: GoogleStatus[] }
export interface GoogleClient { client_id: string; client_secret: string }
export type GoogleRead = { action: 'gmail_list' | 'drive_list'; query: string } | { action: 'calendar_list'; query: string; start?: string; end?: string; page_token?: string } | { action: 'gmail_message'; id: string }
export interface GoogleItem { id?: string; name?: string; summary?: string; snippet?: string; mimeType?: string; modifiedTime?: string; headers?: { from?: string; subject?: string; date?: string }; start?: { dateTime?: string; date?: string; timeZone?: string }; end?: { dateTime?: string; date?: string }; description?: string; location?: string; status?: string; htmlLink?: string; text?: string; body_note?: string }
export interface GoogleResult extends GoogleItem { items?: GoogleItem[]; files?: GoogleItem[]; nextPageToken?: string; has_more?: boolean }
export function googleAvailable() { return isTauri() && !isMobile() }
async function call<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  if (!googleAvailable()) throw new Error('Configure o Google no aplicativo desktop.')
  return backendCall<T>(command, args)
}
export const googleStatus = () => call<GoogleOverview>('studio_google_status')
function connectionChanged() { if (typeof window !== 'undefined') window.dispatchEvent(new Event('bionic-google-changed')) }
export async function saveGoogleClient(input: GoogleClient | null) { try { return await call<void>('studio_google_client', { input }) } finally { connectionChanged() } }
export async function updateGoogle(service: GoogleOAuthService, enabled: boolean | null) { try { return await call<GoogleOverview>('studio_google_update', { service, enabled }) } finally { connectionChanged() } }
export const cancelGoogle = (requestId: string) => call<void>('studio_google_cancel', { requestId })
async function cancellable<T>(command: string, args: Record<string, unknown>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) throw new Error('Operação Google cancelada.')
  const requestId = crypto.randomUUID()
  const stop = () => { void cancelGoogle(requestId).catch(() => {}) }
  signal.addEventListener('abort', stop, { once: true })
  try {
    const result = await call<T>(command, { ...args, requestId })
    if (signal.aborted) throw new Error('Operação Google cancelada.')
    return result
  } finally { signal.removeEventListener('abort', stop) }
}
export async function connectGoogle(service: GoogleOAuthService, signal: AbortSignal, writeAccess = false) { try { return await cancellable<GoogleOverview>('studio_google_connect', { service, writeAccess }, signal) } finally { connectionChanged() } }
export const readGoogle = (input: GoogleRead, signal: AbortSignal) => cancellable<GoogleResult>('studio_google_read', { input }, signal)

export type GoogleWrite = { action: 'gmail_send'; to: string; subject: string; text: string }
  | { action: 'calendar_create'; title: string; description: string; start: string; end: string }
  | { action: 'drive_create'; name: string; text: string }
export type GoogleDraft = ReviewDraft<GoogleWrite>
export const googleDrafts = () => call<GoogleDraft[]>('studio_google_drafts')
function changed() { if (typeof window !== 'undefined') window.dispatchEvent(new Event('bionic-google-drafts-changed')) }
export async function prepareGoogle(input: GoogleWrite, signal: AbortSignal) {
  try { return await cancellable<GoogleDraft>('studio_google_prepare', { input }, signal) }
  finally { changed() }
}
export async function executeGoogle(id: string, signal: AbortSignal) {
  try { return await cancellable<GoogleDraft[]>('studio_google_execute', { id }, signal) }
  finally { changed() }
}
export async function discardGoogle(id: string) {
  try { return await call<GoogleDraft[]>('studio_google_discard', { id }) }
  finally { changed() }
}
