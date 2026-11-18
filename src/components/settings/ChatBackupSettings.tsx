import { useUiText } from "../../lib/ui-text"
import { useRef, useState } from 'react'
import { Download, Upload, RotateCcw, Trash2, AlertTriangle, Clock } from 'lucide-react'
import { useChatStore, flushChatPersist } from '../../stores/chatStore'
import { backupStoresNow } from '../../lib/store-backup'
import { exportAllConversations, parseImportedChats } from '../../lib/chat-export'
import { backendCall, isTauri } from '../../api/backend'
import { restoreMissingBackupChats } from '../../lib/chat-backup-recovery'

/**
 * Chat Backup (a user 2026-06-28) — export ALL conversations to one JSON file
 * and re-import them. The web build has no store_backup.json, so a web user on
 * an SSH tunnel loses chats when the origin (host/port) changes; this is their
 * manual backup + restore path. Works on desktop too (native Save As dialog).
 */
export function ChatBackupSettings() {
  const uiText = useUiText()

  const conversations = useChatStore((s) => s.conversations)
  const importConversations = useChatStore((s) => s.importConversations)
  const fileRef = useRef<HTMLInputElement>(null)
  const [msg, setMsg] = useState<string>('')
  const [recovering, setRecovering] = useState(false)
  const [clearing, setClearing] = useState(false)
  const [clearConfirmed, setClearConfirmed] = useState(false)
  const restore = async () => {
    if (recovering) return
    setRecovering(true)
    try {
      const count = await restoreMissingBackupChats()
      setMsg(uiText('Recovered {v0} conversations from backups.', { v0: String(count) }))
    } catch (error) { setMsg(error instanceof Error ? uiText(error.message) : String(error)) }
    finally { setRecovering(false) }
  }

  const handleExport = async () => {
    if (conversations.length === 0) {
      setMsg(uiText('No chats to export yet.'))
      return
    }
    const res = await exportAllConversations(conversations)
    if (res.status === 'cancelled') return
    if (res.status === 'error') { setMsg(res.error ?? 'Could not export chats.'); return }
    if (res.status === 'saved') {
      setMsg(uiText('Saved {v0} conversations to {v1}. Missing images: {v2}.', { v0: res.count, v1: res.path, v2: res.missing || 0 }))
    } else {
      setMsg(uiText('Downloaded {v0} conversations as JSON.', { v0: res.count }))
    }
  }

  const importText = async (content: string) => {
    setRecovering(true)
    try {
      const convs = parseImportedChats(content)
      const { added, skipped } = importConversations(convs, 'merge')
      await flushChatPersist()
      if (isTauri() && !await backupStoresNow()) throw new Error(uiText('Chats were restored, but the native backup could not be confirmed.'))
      setMsg(uiText('Imported: {v0}. Already present: {v1}.', { v0: added, v1: skipped }))
    } catch (err) {
      setMsg(err instanceof Error ? err.message : 'Could not import that file.')
    } finally { setRecovering(false) }
  }

  // Desktop: the file is read natively and its images are moved into the
  // attachment store before the WebView parses it, so a large export with
  // every image inline is never one string in the renderer.
  const handleImportClick = async () => {
    if (!isTauri()) { fileRef.current?.click(); return }
    try {
      const content = await backendCall<string | null>('import_chats_dialog')
      if (content) await importText(content)
    } catch (err) {
      setMsg(err instanceof Error ? err.message : String(err))
    }
  }

  const handleImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = '' // allow re-picking the same file
    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => {
      const content = ev.target?.result as string
      if (!content) {
        setMsg('Could not read that file.')
        return
      }
      void importText(content)
    }
    reader.onerror = () => setMsg('Could not read that file.')
    reader.readAsText(file)
  }

  return (
    <div className="space-y-2">
      <div className="text-[0.6rem] text-gray-500 dark:text-gray-500 leading-relaxed">{uiText("Save all your chats to a single JSON file, or restore them from one. On the web version your chats live in the browser, so this is your backup if you ever open LU from a different address (e.g. after a tunnel reconnect).")}</div>
      {isTauri() && <div className="space-y-2 rounded-lg border border-blue-500/20 p-3">
        <p className="text-xs text-gray-500">{uiText('Restore missing conversations from the app backups. Backups can include conversations you previously deleted.')}</p>
        <button type="button" disabled={recovering} onClick={() => { void restore() }} className="inline-flex items-center gap-2 rounded-lg bg-[#1f6feb] px-3 py-2 text-xs text-white disabled:opacity-50">
          <RotateCcw size={13} />{uiText(recovering ? 'Restoring conversations...' : 'Restore chats from backup')}
        </button>
      </div>}
      <div className="flex gap-2">
        <button
          disabled={recovering}
          onClick={handleExport}
          className="flex-1 text-[0.65rem] flex items-center justify-center gap-1.5 px-2 py-1.5 rounded border border-gray-200 dark:border-white/10 text-gray-600 dark:text-gray-300 hover:border-gray-400 dark:hover:border-white/20 transition-colors"
        >
          <Download size={12} />{uiText(" Export all chats")}</button>
        <button
          disabled={recovering}
          onClick={() => void handleImportClick()}
          className="flex-1 text-[0.65rem] flex items-center justify-center gap-1.5 px-2 py-1.5 rounded border border-gray-200 dark:border-white/10 text-gray-600 dark:text-gray-300 hover:border-gray-400 dark:hover:border-white/20 transition-colors"
        >
          <Upload size={12} />{uiText(" Import chats")}</button>
        <input ref={fileRef} type="file" accept=".json,application/json" onChange={handleImport} className="hidden" />
      </div>
      {msg && <div className="text-[0.6rem] text-gray-500 dark:text-gray-400">{uiText(msg)}</div>}
      {/* Limpar todo o histórico de chats — desenvolvimento */}
      <div className="mt-4 rounded-xl border border-red-500/20 bg-red-500/[0.05] p-4 space-y-3">
        <div className="flex items-start gap-3">
          <AlertTriangle size={18} className="mt-1 text-red-500 dark:text-red-400 shrink-0" />
          <div>
            <h3 className="text-sm font-semibold text-red-900 dark:text-red-100">{uiText('Limpar todo o histórico de chats')}</h3>
            <p className="text-xs text-red-500 dark:text-red-400 leading-relaxed">
              {uiText('Remove todas as conversas do histórico. Cópias de segurança só podem ser recuperadas manualmente.')}
            </p>
          </div>
        </div>
        {!clearConfirmed ? (
          <button
            type="button"
            onClick={() => setClearConfirmed(true)}
            disabled={clearing}
            className="flex items-center gap-2 rounded-lg border border-red-500 bg-red-500 px-3 py-2 text-sm text-white hover:bg-red-600 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Trash2 size={14} />
            <span>{uiText('Apagar tudo agora')}</span>
          </button>
        ) : (
          <>
            <p className="text-xs text-red-500 dark:text-red-400">{uiText('Tem certeza? Esta ação não pode ser desfeita.')}</p>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={async () => {
                  setClearConfirmed(false)
                  setClearing(true)
                  try {
                    const conversations = useChatStore.getState().conversations
                    for (const c of conversations) {
                      await useChatStore.getState().deleteConversation(c.id)
                    }
                    await backupStoresNow()
                    setMsg(uiText('Chat history cleared.'))
                    setClearing(false)
                  } catch (e) {
                    setClearing(false)
                    console.error('Falha ao limpar histórico:', e)
                  }
                }}
                disabled={clearing}
                className="flex items-center gap-2 rounded-lg border border-red-600 bg-red-600 px-3 py-2 text-sm text-white hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {clearing ? (
                  <>
                    <Clock size={14} className="animate-spin" />
                    <span>{uiText('Limpando…')}</span>
                  </>
                ) : (
                  <>
                    <Trash2 size={14} />
                    <span>{uiText('Sim, apagar tudo')}</span>
                  </>
                )}
              </button>
              <button
                type="button"
                onClick={() => setClearConfirmed(false)}
                className="flex items-center gap-2 rounded-lg border border-gray-300 dark:border-white/15 bg-transparent px-3 py-2 text-sm text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-white/5"
              >
                <span>{uiText('Cancelar')}</span>
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
