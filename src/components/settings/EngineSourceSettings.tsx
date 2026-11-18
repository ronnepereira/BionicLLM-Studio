import { useEffect, useState } from 'react'
import { backendCall } from '../../api/backend'
import { useGenerationStore } from '../../stores/generationStore'
import { useUiText } from '../../lib/ui-text'

interface EngineVersion { tag: string; commit: string; backend: string; directory: string }
interface EngineStatus { active: EngineVersion | null; bundledTag: string; bundledCommit: string }
interface PackageOption { backend: string; label: string; bytes: number }
interface PackageCatalog { tag: string; options: PackageOption[] }
export function EngineSourceSettings() {
  const text = useUiText()
  const [status, setStatus] = useState<EngineStatus | null>(null)
  const [tag, setTag] = useState('b9949')
  const [catalog, setCatalog] = useState<PackageCatalog | null>(null)
  const [backend, setBackend] = useState('vulkan')
  const [sourceBackend, setSourceBackend] = useState('vulkan')
  const [busy, setBusy] = useState(false)
  const [candidate, setCandidate] = useState<EngineVersion | null>(null)
  const [message, setMessage] = useState('')
  const refresh = () => backendCall<EngineStatus>('engine_source_status').then(result => { setStatus(result); if (result.active?.backend) setBackend(result.active.backend) })
  useEffect(() => { void refresh().catch(() => {}) }, [])
  const packages = async (requestedTag: string | null) => {
    setBusy(true)
    try {
      const result = await backendCall<PackageCatalog>('engine_package_catalog', { tag: requestedTag })
      setCatalog(result); setTag(result.tag)
      setBackend(current => result.options.some(option => option.backend === current) ? current : result.options[0]?.backend || '')
      setMessage(text('Official packages available for {v0}.', { v0: result.tag }))
    } catch (error) { setCatalog(null); setMessage(String(error)) }
    finally { setBusy(false) }
  }
  const activate = async (rollback: boolean) => {
    if (Object.keys(useGenerationStore.getState().runs).length) { setMessage(text('Wait for active tasks to finish before updating the engine.')); return }
    setBusy(true)
    try { await backendCall('engine_source_activate', { rollback }); await refresh(); setCandidate(null); setMessage(text('Engine version selected. It will load on the next local request.')) }
    catch (error) { setMessage(String(error)) }
    finally { setBusy(false) }
  }
  const selected = catalog?.tag === tag ? catalog.options.find(option => option.backend === backend) : undefined
  return <div className="space-y-3 t-body">
    <p className="text-gray-500">{text('Official llama.cpp packages: download and extract without compiling. The current engine remains available until activation.')}</p>
    <p>{text('Installed: {v0} · {v1}', { v0: status?.active?.tag || status?.bundledTag || 'b9949', v1: [(status?.active?.commit || status?.bundledCommit || '').slice(0, 12), status?.active?.backend.toUpperCase()].filter(Boolean).join(' · ') })}</p>
    <div className="flex flex-wrap gap-2 items-end">
      <label>{text('Official source tag')}<input disabled={busy} className="lu-control block w-28" value={tag} pattern="b[0-9]+" onChange={e => setTag(e.target.value)} /></label>
      <button className="lu-control" disabled={busy} onClick={() => { void packages(null) }}>{text('Check latest version')}</button>
      <button className="lu-control" disabled={busy || !/^b\d+$/.test(tag)} onClick={() => { void packages(tag) }}>{text('Find packages for this version')}</button>
    </div>
    {catalog?.tag === tag && <div className="flex flex-wrap gap-2 items-end">
      <label>{text('Acceleration')}<select disabled={busy} className="lu-control block" value={backend} onChange={e => setBackend(e.target.value)}>{catalog.options.map(option => <option key={option.backend} value={option.backend}>{option.label} · {(option.bytes / 1048576).toFixed(0)} MB</option>)}</select></label>
      <button disabled={busy || !selected} className="lu-primary" onClick={async () => {
        setBusy(true); setMessage(text('Downloading and validating the official engine package…'))
        try { setCandidate(await backendCall<EngineVersion>('engine_package_download', { tag, backend })); setMessage(text('Download, SHA-256 and health check passed. Ready to activate.')) }
        catch (error) { setMessage(String(error)) }
        finally { setBusy(false) }
      }}>{text('Download official package')}</button>
    </div>}
    <p className="t-micro text-gray-500">{text('CUDA is for NVIDIA GPUs and requires a compatible driver. Its download includes the matching CUDA runtime libraries; no CUDA Toolkit is needed for ready-made packages.')}</p>
    <details>
      <summary className="cursor-pointer text-gray-500">{text('Advanced: build from source')}</summary>
      <div className="mt-3 space-y-3">
        <p className="t-micro text-gray-500">{text('Source builds require Git, CMake and Visual Studio C++ Build Tools. Vulkan also requires the Vulkan SDK; CUDA requires the CUDA Toolkit.')}</p>
        <div className="flex flex-wrap gap-2 items-end">
          <label>{text('Build acceleration')}<select disabled={busy} className="lu-control block" value={sourceBackend} onChange={e => setSourceBackend(e.target.value)}><option value="vulkan">Vulkan</option><option value="cuda">CUDA (NVIDIA)</option><option value="cpu">CPU</option></select></label>
          <button disabled={busy || !/^b\d+$/.test(tag)} className="lu-control" onClick={async () => {
            setBusy(true); setMessage(text('Building the engine from source… The installed version remains available.'))
            try { setCandidate(await backendCall<EngineVersion>('engine_source_build', { tag, backend: sourceBackend })); setMessage(text('Build and health check passed. Ready to activate.')) }
            catch (error) { setMessage(String(error)) }
            finally { setBusy(false) }
          }}>{text('Build from source')}</button>
        </div>
      </div>
    </details>
    <div className="flex flex-wrap gap-2">
      {candidate && <button className="lu-primary" disabled={busy} onClick={() => { void activate(false) }}>{text('Activate {v0}', { v0: `${candidate.tag} · ${candidate.backend.toUpperCase()}` })}</button>}
      <button className="lu-control" disabled={busy || !status?.active} onClick={() => { void activate(true) }}>{text('Return to previous engine')}</button>
    </div>
    {message && <p role="status" className="t-micro break-words">{message}</p>}
  </div>
}
