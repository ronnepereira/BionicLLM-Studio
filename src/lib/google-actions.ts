import type { GoogleDraft, GoogleService } from '../api/studio-google'
export function googleDraftService(draft: GoogleDraft): GoogleService {
  return { gmail_send: 'gmail', drive_create: 'drive', calendar_create: 'calendar' }[draft.input.action] as GoogleService
}
export function localGoogleDate(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value)
  if (!match) throw new Error('Informe a data e o horário completos.')
  const [year, month, day, hour, minute] = match.slice(1).map(Number)
  const date = new Date(value)
  if (!Number.isFinite(date.getTime()) || date.getFullYear() !== year || date.getMonth() + 1 !== month || date.getDate() !== day || date.getHours() !== hour || date.getMinutes() !== minute) throw new Error('Este horário não existe no fuso do computador. Escolha outro horário.')
  return date.toISOString()
}
