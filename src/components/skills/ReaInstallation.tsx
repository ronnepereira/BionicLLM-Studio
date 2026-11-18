import { useEffect, useRef, useState } from 'react'
import { Download, RefreshCw } from 'lucide-react'
import { isTauri } from '../../api/backend'
import { useSettingsStore } from '../../stores/settingsStore'
import { useReaRuntime } from '../../lib/plugins/rea-runtime'
import { REA_PLUGIN, reaFetch, reaStatus, type ReaStatus } from '../../lib/plugins/rea'
import { useUiText } from '../../lib/ui-text'

/** Installation of the version shipped by BionicLLM; never npm's mutable latest. */
export function ReaInstallation() {
  const text = useUiText()
  const desktop = isTauri()
  const enabled = useSettingsStore(state => state.settings.reaPluginEnabled)
  const phase = useReaRuntime(state => state.phase)
  const [status, setStatus] = useState<ReaStatus | null>(null)
  const [busy, setBusy] = useState<'check' | 'install' | null>(null)
  const [error, setError] = useState('')
  const request = useRef(0)
  const mounted = useRef(false)
  const running = enabled || phase === 'on' || phase === 'fetching' || phase === 'starting'
  const versionMatches = status?.version === REA_PLUGIN.version

  const perform = async (install: boolean) => {
    if (!desktop || busy || (install && (running || !versionMatches))) return
    const mine = ++request.current
    setBusy(install ? 'install' : 'check'); setError('')
    try {
      const result = await (install ? reaFetch() : reaStatus())
      if (mounted.current && mine === request.current) setStatus(result)
    } catch (error) {
      if (mounted.current && mine === request.current) setError(error instanceof Error ? error.message : String(error))
    } finally {
      if (mounted.current && mine === request.current) setBusy(null)
    }
  }

  useEffect(() => {
    mounted.current = true
    if (!desktop) return () => { mounted.current = false }
    let disposed = false
    const mine = ++request.current
    setBusy('check'); setError('')
    void reaStatus().then(result => {
      if (!disposed && mine === request.current) setStatus(result)
    }).catch(error => {
      if (!disposed && mine === request.current) setError(error instanceof Error ? error.message : String(error))
    }).finally(() => {
      if (!disposed && mine === request.current) setBusy(null)
    })
    return () => { disposed = true; mounted.current = false }
  }, [desktop, phase])

  const button = 'lu-control lu-control--outline inline-flex items-center gap-2'
  return <div className="mt-3 space-y-3 text-sm">
    <p className="text-gray-500 dark:text-gray-400">{text('Installs the official version included with this BionicLLM release and verifies its checksum. Installation does not activate REA or change other apps.')}</p>
    {desktop && <>
      <p role="status" className="text-gray-600 dark:text-gray-300">{busy === 'install'
        ? text('Downloading and verifying REA {v0}…', { v0: REA_PLUGIN.version })
        : busy === 'check' ? text('Checking REA installation…')
        : status && !versionMatches ? text('The interface and desktop backend have different REA versions. Update and reopen the desktop app before installing.')
        : status?.ready ? text('REA {v0} package installed and verified.', { v0: status.version })
        : status ? text('REA {v0} package is missing or needs repair.', { v0: REA_PLUGIN.version }) : text('Installation status unavailable.')}</p>
      {status && !status.nodeOk && <p className="text-amber-700 dark:text-amber-300">{text('REA requires Node.js {v0}. Detected: {v1}. Install a compatible Node.js version before activating.', { v0: status.nodeRange, v1: status.node ?? text('Not found') })}</p>}
    </>}
    {error && <p role="alert" className="text-red-600 dark:text-red-400 break-words">{error}</p>}
    <div className="flex flex-wrap gap-2">
      <button className={button} disabled={!desktop || !!busy} onClick={() => void perform(false)}><RefreshCw size={13} />{text('Check installation')}</button>
      <button className={button} disabled={!desktop || !!busy || running || !versionMatches || status?.ready === true} onClick={() => void perform(true)}><Download size={13} />{text('Install/update REA {v0}', { v0: REA_PLUGIN.version })}</button>
    </div>
    {desktop && running && <p className="text-xs text-gray-500">{text('Deactivate REA before installing or repairing its package.')}</p>}
    <p className="text-xs text-gray-500">{text('Future REA versions require a compatible BionicLLM update; this button does not download untested releases automatically.')}</p>
  </div>
}
