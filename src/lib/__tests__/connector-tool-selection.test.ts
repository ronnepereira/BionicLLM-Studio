import { expect, it } from 'vitest'
import { gateCreateTools, selectRelevantTools } from '../tool-selection'
import { DEFAULT_PERMISSIONS, type MCPToolDefinition } from '../../api/mcp/types'
const names = ['file_read', 'file_write', 'file_edit', 'todo_write', 'google_gmail_search', 'google_gmail_read', 'google_gmail_prepare', 'google_drive_search', 'google_drive_prepare', 'google_calendar_search', 'google_calendar_prepare', 'facebook_page_posts', 'facebook_page_prepare', 'instagram_media', 'instagram_image_prepare', 'instagram_reel_prepare', 'linkedin_profile', 'linkedin_posts', 'linkedin_prepare', 'youtube_videos', 'youtube_files', 'youtube_prepare', 'tiktok_videos', 'tiktok_files', 'tiktok_prepare']
const tools: MCPToolDefinition[] = names.map(name => ({ name, description: name, category: 'filesystem', source: 'builtin', inputSchema: { type: 'object', properties: {}, required: [] } }))
it('offers native connectors for Portuguese requests while keeping internal Agenda distinct', () => {
  expect(selectRelevantTools('Leia publicações da minha página do Facebook', tools, DEFAULT_PERMISSIONS, 6).map(t => t.name)).toEqual(expect.arrayContaining(['facebook_page_posts', 'facebook_page_prepare']))
  expect(selectRelevantTools('Leia meus e-mails no Gmail', tools, DEFAULT_PERMISSIONS).map(t => t.name)).toContain('google_gmail_read')
  expect(selectRelevantTools('Crie arquivo no Google Drive', tools, DEFAULT_PERMISSIONS).map(t => t.name)).toContain('google_drive_prepare')
  expect(selectRelevantTools('Consulte a agenda do Google', tools, DEFAULT_PERMISSIONS).map(t => t.name)).toContain('google_calendar_search')
  expect(selectRelevantTools('Mostre a agenda interna de tarefas', tools, DEFAULT_PERMISSIONS).map(t => t.name)).not.toContain('google_calendar_search')
})
it('keeps private service tools out of unrelated coding catalogs and preserves explicit names', () => {
  const filtered = gateCreateTools(tools, 'Refactor the current function').map(t => t.name)
  expect(filtered.some(name => name.startsWith('google_') || name.startsWith('facebook_'))).toBe(false)
  expect(gateCreateTools(tools, 'Use facebook_page_posts').map(t => t.name)).toContain('facebook_page_posts')
})
it('routes the requested Instagram format within the small-model tool cap', () => {
  const reel = selectRelevantTools('Prepare um Reel no Instagram', tools, DEFAULT_PERMISSIONS, 6).map(t => t.name)
  expect(reel).toContain('instagram_reel_prepare'); expect(reel).not.toContain('instagram_image_prepare'); expect(reel).toHaveLength(6)
  const image = selectRelevantTools('Prepare uma foto no Instagram', tools, DEFAULT_PERMISSIONS, 6).map(t => t.name)
  expect(image).toContain('instagram_image_prepare'); expect(image).not.toContain('instagram_reel_prepare')
})

it('routes LinkedIn reading and drafts within the six-tool cap', () => {
  const draft = selectRelevantTools('Prepare um rascunho no LinkedIn', tools, DEFAULT_PERMISSIONS, 6).map(t => t.name)
  expect(draft).toContain('linkedin_profile'); expect(draft).toContain('linkedin_prepare'); expect(draft).not.toContain('linkedin_posts'); expect(draft).toHaveLength(6)
  const posts = selectRelevantTools('Consulte publicações do LinkedIn', tools, DEFAULT_PERMISSIONS, 6).map(t => t.name)
  expect(posts).toContain('linkedin_posts'); expect(posts).not.toContain('linkedin_prepare')
  expect(gateCreateTools(tools, 'Refactor code').map(t => t.name)).not.toContain('linkedin_profile')
})

it('routes YouTube drafts to user-selected files within the small-model cap', () => {
  const prepare = selectRelevantTools('Prepare um Short no YouTube', tools, DEFAULT_PERMISSIONS, 6).map(t => t.name)
  expect(prepare).toContain('youtube_files'); expect(prepare).toContain('youtube_prepare'); expect(prepare).not.toContain('youtube_videos'); expect(prepare).toHaveLength(6)
  const read = selectRelevantTools('Consulte vídeos do YouTube', tools, DEFAULT_PERMISSIONS, 6).map(t => t.name)
  expect(read).toContain('youtube_videos'); expect(read).not.toContain('youtube_prepare')
  expect(gateCreateTools(tools, 'Refactor code').map(t => t.name).some(name => name.startsWith('youtube_'))).toBe(false)
  expect(gateCreateTools(tools, 'Use youtube_files').map(t => t.name)).toContain('youtube_files')
})

it('routes TikTok inbox proposals within the six-tool cap and keeps unrelated coding lean', () => {
  const prepare = selectRelevantTools('Prepare um vídeo para o TikTok', tools, DEFAULT_PERMISSIONS, 6).map(t => t.name)
  expect(prepare).toContain('tiktok_files'); expect(prepare).toContain('tiktok_prepare'); expect(prepare).not.toContain('tiktok_videos'); expect(prepare).toHaveLength(6)
  const read = selectRelevantTools('Consulte meus vídeos no Tik Tok', tools, DEFAULT_PERMISSIONS, 6).map(t => t.name)
  expect(read).toContain('tiktok_videos'); expect(read).not.toContain('tiktok_prepare')
  expect(gateCreateTools(tools, 'Refactor code').map(t => t.name).some(name => name.startsWith('tiktok_'))).toBe(false)
  expect(gateCreateTools(tools, 'Use tiktok_files').map(t => t.name)).toContain('tiktok_files')
})
