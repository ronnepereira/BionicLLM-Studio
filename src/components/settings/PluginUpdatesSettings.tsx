import { useCallback, useEffect, useState } from 'react'
import { backendCall } from '../../api/backend'
import { MCPExternalClient } from '../../api/mcp/external-client'
import { useSettingsStore } from '../../stores/settingsStore'
import { useGenerationStore } from '../../stores/generationStore'
import { useMCPStore } from '../../stores/mcpStore'
import { reaStatus, reaServerConfig } from '../../lib/plugins/rea'
import { startRea, stopRea, useReaRuntime } from '../../lib/plugins/rea-runtime'
import { useUiText } from '../../lib/ui-text'

interface Manifest { id: string; package: string; version: string; tarball: string; source: string; nodeRange: string }
function npmPackage(args: string[]): string | undefined {
  const spec = args.find(a => a.startsWith('--package='))?.slice(10) ?? args.find(a => !a.startsWith('-'))
  return spec?.match(/^(@[\w.-]+\/[\w.-]+|[\w.-]+)(?:@[^/]+)?$/)?.[1]
}

export function PluginUpdatesSettings({ backgroundOnly = false }: { backgroundOnly?: boolean } = {}) {
  const text = useUiText()
  const servers = useMCPStore(s => s.servers)
  const automatic = useSettingsStore(s => s.settings.pluginAutoUpdate === true)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [version, setVersion] = useState('')
  const runtimeVersion = useReaRuntime(s => s.version)
  useEffect(() => { void reaStatus().then(s => setVersion(s.version)).catch(() => {}) }, [runtimeVersion])
  const update = useCallback(async (id: string, pkg: string, sourceKind: 'npm' | 'pypi' = 'npm') => {
    if (busy) return
    if (Object.keys(useGenerationStore.getState().runs).length) { setMessage(text('Wait for active tasks to finish before updating plugins.')); return }
    setBusy(true); setMessage(text('Downloading and validating the official package…'))
    const wasOn = useSettingsStore.getState().settings.reaPluginEnabled === true
    let activated = false
    let candidate: MCPExternalClient | undefined
    try {
      const manifest = await backendCall<Manifest>('plugin_source_stage', { id, package: pkg, sourceKind })
      if (Object.keys(useGenerationStore.getState().runs).length) throw new Error(text('A task started while downloading. Update again when it finishes.'))
      if (id === 'rea') {
        const old = await reaStatus()
        if (wasOn) await stopRea()
        candidate = new MCPExternalClient(reaServerConfig({ ...old, ready: true, nodeOk: !!old.node, version: manifest.version, tarball: manifest.tarball, nodeRange: manifest.nodeRange }))
        const tools = await candidate.connect()
        if (!tools.length) throw new Error(text('The plugin did not provide MCP tools.'))
        await candidate.disconnect(); candidate = undefined
        await backendCall('plugin_source_activate', { id, rollback: false }); activated = true
        if (wasOn) {
          await startRea()
          if (useReaRuntime.getState().phase !== 'on') throw new Error(useReaRuntime.getState().error || text('Plugin startup failed.'))
        }
        setVersion(manifest.version)
      } else {
        const server = useMCPStore.getState().servers.find(s => s.id === id)
        if (!server) throw new Error(text('Plugin not found.'))
        const args = sourceKind === 'pypi' ? (server.args.includes('--from') ? server.args.map((a, i) => i === server.args.indexOf('--from') + 1 ? manifest.tarball : a) : ['--from', manifest.tarball, ...server.args]) : server.args.some(a => a.startsWith('--package='))
          ? server.args.map(a => a.startsWith('--package=') ? `--package=${manifest.tarball}` : a)
          : ['--yes', ...server.args.filter(a => a !== '-y' && a !== '--yes').map((a, i) => i === 0 ? manifest.tarball : a)]
        const config = { ...server, sourcePackage: pkg, sourceKind, args, env: { ...server.env, npm_config_engine_strict: 'true', npm_config_ignore_scripts: 'true' } }
        candidate = new MCPExternalClient({ ...config, id: `${id}-update-check` })
        await candidate.connect(); await candidate.disconnect(); candidate = undefined
        await backendCall('plugin_source_activate', { id, rollback: false }); activated = true
        useMCPStore.getState().updateServer(id, config)
      }
      setMessage(text('Updated to {v0} from {v1}.', { v0: manifest.version, v1: manifest.source }))
    } catch (error) {
      await candidate?.disconnect().catch(() => {})
      if (activated) await backendCall('plugin_source_activate', { id, rollback: true }).catch(() => {})
      if (id === 'rea' && wasOn) await startRea()
      setMessage(String(error))
    } finally { setBusy(false) }
  }, [busy, text])
  useEffect(() => {
    if (!automatic) return
    // Wait for idle; never replace a package underneath a running agent.
    const timer = window.setInterval(() => {
      if (!Object.keys(useGenerationStore.getState().runs).length && !busy) {
        const last = Number(localStorage.getItem('bionic-plugin-update-check') || 0)
        if (Date.now() - last > 86400000) {
          localStorage.setItem('bionic-plugin-update-check', String(Date.now()))
          void update('rea', 'rea-agents')
        }
      }
    }, 15000)
    return () => clearInterval(timer)
  }, [automatic, busy, update])
  if (backgroundOnly) return null
  return <div className="space-y-3 t-body">
    <p className="text-gray-500">{text('Updates come from the official npm or PyPI source, are verified by checksum and tested through MCP before activation.')}</p>
    <div className="flex items-center justify-between gap-3"><span>REA {version}</span><button disabled={busy} className="lu-control" onClick={() => { void update('rea', 'rea-agents') }}>{text('Check and update')}</button></div>
    {servers.map(server => {
      const kind = server.sourceKind || (/^uvx(?:\.exe)?$/i.test(server.command) ? 'pypi' : 'npm')
      const pkg = /^(?:npx(?:\.cmd)?|uvx(?:\.exe)?)$/i.test(server.command) ? (server.sourcePackage || (kind === 'pypi' ? server.args.find(a => !a.startsWith('-'))?.split('==')[0] : npmPackage(server.args))) : undefined
      return <div key={server.id} className="space-y-1 border-t border-gray-200 dark:border-white/10 pt-2">
        <div className="flex items-center justify-between gap-3"><span>{server.name}</span><button disabled={busy || !pkg} className="lu-control" onClick={() => { if (pkg) void update(server.id, pkg, kind) }}>{text('Check and update')}</button></div>
        <label className="block t-micro">{text('Official source package')}<span className="ml-2 text-gray-500">{kind === 'pypi' ? 'PyPI' : 'npm'}</span><input className="lu-control w-full" value={server.sourcePackage || pkg || ''} onChange={e => useMCPStore.getState().updateServer(server.id, { sourcePackage: e.target.value })} /></label>
      </div>
    })}
    <label className="flex gap-2 items-center"><input type="checkbox" checked={automatic} onChange={e => useSettingsStore.getState().updateSettings({ pluginAutoUpdate: e.target.checked })} />{text('Automatically check REA updates while idle')}</label>
    {message && <p role="status" className="t-micro break-words">{message}</p>}
  </div>
}
