import { useEffect, useState } from 'react'
import { restoreMissingBackupChats } from '../../lib/chat-backup-recovery'
import { isTauri } from '../../api/backend'
import { useUiText } from '../../lib/ui-text'

/** Reconcile durable history silently. Explicit deletion tombstones always win. */
export function ChatRecoveryNotice({ ready }: { ready: Promise<void> }) {
  const text = useUiText()
  const [error, setError] = useState('')
  const [retry, setRetry] = useState(0)
  useEffect(() => {
    if (!isTauri()) return
    let cancelled = false
    void ready.then(async () => {
      if (cancelled) return
      await restoreMissingBackupChats(false)
    }).catch(error => { if (!cancelled) setError(String(error)) })
    return () => { cancelled = true }
  }, [ready, retry])

  if (!error) return null
  return <aside className="m-2 rounded-lg border border-gray-200 dark:border-white/10 p-3 t-micro" aria-label={text('Chat history')}>
    <p role="alert">{text('Could not synchronize chat history. Your local backup was preserved.')}</p>
    <p className="mt-1 break-words">{error}</p>
    <button className="lu-control mt-2" onClick={() => { setError(''); setRetry(value => value + 1) }}>{text('Try again')}</button>
  </aside>
}
