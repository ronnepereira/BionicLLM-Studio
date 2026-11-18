import { backendCall, isTauri } from './backend'
import { isMobile } from '../lib/device-kind'
import type { ReviewDraft } from '../lib/review-actions'
import type { ConnectorMedia } from '../lib/connector-media'
export interface TikTokCredentials { client_key: string; client_secret: string; refresh_token: string; uploading: boolean; read_videos: boolean }
export interface TikTokIdentity { open_id: string; display_name: string }
export interface TikTokStatus { configured: boolean; enabled: boolean; uploading: boolean; read_videos: boolean; identity: TikTokIdentity | null }
export interface TikTokUpload { file_id: string; note: string }
export type TikTokDraft = ReviewDraft<{ metadata: TikTokUpload; file: ConnectorMedia }>
export interface TikTokVideos { items: { id: string; title: string; description: string; created_at: number | null; duration: number | null }[]; has_more: boolean }
export interface TikTokTransferStatus { status: 'PROCESSING_UPLOAD' | 'SEND_TO_USER_INBOX' | 'PUBLISH_COMPLETE' | 'FAILED'; uploaded_bytes: number | null }
export function tiktokAvailable() { return isTauri() && !isMobile() }
async function call<T>(command: string, args?: Record<string, unknown>) {
  if (!tiktokAvailable()) throw new Error('Configure o TikTok no aplicativo desktop.')
  return backendCall<T>(command, args)
}
function changed() { if (typeof window !== 'undefined') window.dispatchEvent(new Event('bionic-tiktok-changed')) }
async function operation<T>(command: string, args: Record<string, unknown>, signal: AbortSignal) {
  if (signal.aborted) throw new Error('Operação TikTok cancelada.')
  const requestId = crypto.randomUUID()
  const stop = () => { void call<void>('studio_tiktok_cancel', { requestId }).catch(() => {}) }
  signal.addEventListener('abort', stop, { once: true })
  try { const value = await call<T>(command, { ...args, requestId }); if (signal.aborted) throw new Error('Operação TikTok cancelada.'); return value }
  finally { signal.removeEventListener('abort', stop); changed() }
}
export const tiktokStatus = () => call<TikTokStatus>('studio_tiktok_status')
export const tiktokFiles = () => call<ConnectorMedia[]>('studio_tiktok_files')
export const tiktokDrafts = () => call<TikTokDraft[]>('studio_tiktok_drafts')
export const verifyTikTok = (input: TikTokCredentials | null, signal: AbortSignal) => operation<TikTokStatus>('studio_tiktok_verify', { input }, signal)
export const tiktokVideos = (signal: AbortSignal) => operation<TikTokVideos>('studio_tiktok_videos', {}, signal)
export const tiktokInventory = (signal: AbortSignal) => operation<{ identity: TikTokIdentity; files: ConnectorMedia[] }>('studio_tiktok_inventory', {}, signal)
export const pickTikTokFile = (signal: AbortSignal) => operation<ConnectorMedia | null>('studio_tiktok_pick', {}, signal)
export const prepareTikTok = (input: TikTokUpload, signal: AbortSignal) => operation<TikTokDraft>('studio_tiktok_prepare', { input }, signal)
export const uploadTikTok = (id: string, signal: AbortSignal) => operation<TikTokDraft[]>('studio_tiktok_upload', { id }, signal)
export const tiktokUploadStatus = (id: string, signal: AbortSignal) => operation<TikTokTransferStatus>('studio_tiktok_upload_status', { id }, signal)
export async function updateTikTok(enabled: boolean | null) { try { return await call<TikTokStatus>('studio_tiktok_update', { enabled }) } finally { changed() } }
export async function discardTikTok(id: string) { try { return await call<TikTokDraft[]>('studio_tiktok_discard', { id }) } finally { changed() } }
export async function removeTikTokFile(id: string) { try { return await call<ConnectorMedia[]>('studio_tiktok_remove_file', { id }) } finally { changed() } }
