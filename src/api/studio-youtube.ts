import { backendCall, isTauri } from './backend'
import { isMobile } from '../lib/device-kind'
import type { ReviewDraft } from '../lib/review-actions'
import type { ConnectorMedia } from '../lib/connector-media'
export interface YouTubeChannel { id: string; title: string; uploads: string }
export interface YouTubeStatus { configured: boolean; email: string | null; enabled: boolean; publishing: boolean; channel: YouTubeChannel | null }
export type YouTubeFile = ConnectorMedia
export interface YouTubeUpload { file_id: string; title: string; description: string; category_id: string; privacy: 'private' | 'unlisted' | 'public'; made_for_kids: boolean; contains_synthetic_media: boolean; intended_short: boolean }
export type YouTubeDraft = ReviewDraft<{ metadata: YouTubeUpload; file: YouTubeFile }>
export interface YouTubeVideos { items: { id: string; title: string; description: string; published_at: string; privacy: string; upload_status: string; duration: string }[]; has_more: boolean }
export function youtubeAvailable() { return isTauri() && !isMobile() }
async function call<T>(command: string, args?: Record<string, unknown>) {
  if (!youtubeAvailable()) throw new Error('Configure o YouTube no aplicativo desktop.')
  return backendCall<T>(command, args)
}
function changed() { if (typeof window !== 'undefined') window.dispatchEvent(new Event('bionic-youtube-changed')) }
async function operation<T>(command: string, args: Record<string, unknown>, signal: AbortSignal) {
  if (signal.aborted) throw new Error('Operação YouTube cancelada.')
  const requestId = crypto.randomUUID()
  const stop = () => { void call<void>('studio_google_cancel', { requestId }).catch(() => {}) }
  signal.addEventListener('abort', stop, { once: true })
  try { const value = await call<T>(command, { ...args, requestId }); if (signal.aborted) throw new Error('Operação YouTube cancelada.'); return value }
  finally { signal.removeEventListener('abort', stop); changed() }
}
export const youtubeStatus = () => call<YouTubeStatus>('studio_youtube_status')
export const youtubeFiles = () => call<YouTubeFile[]>('studio_youtube_files')
export const youtubeDrafts = () => call<YouTubeDraft[]>('studio_youtube_drafts')
export const youtubeVideos = (signal: AbortSignal) => operation<YouTubeVideos>('studio_youtube_videos', {}, signal)
export const youtubeInventory = (signal: AbortSignal) => operation<{ channel: YouTubeChannel; files: YouTubeFile[] }>('studio_youtube_inventory', {}, signal)
export const pickYouTubeFile = (signal: AbortSignal) => operation<YouTubeFile | null>('studio_youtube_pick', {}, signal)
export const prepareYouTube = (input: YouTubeUpload, signal: AbortSignal) => operation<YouTubeDraft>('studio_youtube_prepare', { input }, signal)
export const uploadYouTube = (id: string, signal: AbortSignal) => operation<YouTubeDraft[]>('studio_youtube_upload', { id }, signal)
export async function discardYouTube(id: string) { try { return await call<YouTubeDraft[]>('studio_youtube_discard', { id }) } finally { changed() } }
export async function removeYouTubeFile(id: string) { try { return await call<YouTubeFile[]>('studio_youtube_remove_file', { id }) } finally { changed() } }
