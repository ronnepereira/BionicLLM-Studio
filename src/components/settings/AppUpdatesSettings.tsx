import publication from '../../../bionic-publication.json'
import { APP_VERSION } from '../../lib/app-version'
import { useUpdateStore } from '../../stores/updateStore'

export function AppUpdatesSettings() {
  const update = useUpdateStore()
  const busy = update.isChecking || update.downloadStatus === 'downloading' || update.downloadStatus === 'installing'
  const button = 'rounded border border-gray-500/30 px-3 py-1.5 text-sm disabled:opacity-50'
  return <div className="studio-panel rounded border p-3 space-y-3" data-testid="app-update-channel">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <p className="font-medium">Atualizações do BionicLLM Studio</p>
      <span className="t-micro text-gray-500">{publication.updatesEnabled ? 'Canal público' : 'Canal em preparação'}</span>
    </div>
    <p className="t-body">Versão instalada: {APP_VERSION}</p>
    {!publication.updatesEnabled ? <p className="t-body text-gray-500">
      O repositório está privado durante a preparação. Instale as versões de teste manualmente pelo instalador. As atualizações pelo aplicativo serão ativadas após a publicação pública.
    </p> : <>
      <label className="flex items-center gap-2 t-body">
        <input type="checkbox" checked={update.autoDownload} onChange={(event) => update.setAutoDownload(event.target.checked)} />
        Baixar atualizações automaticamente (a instalação exige sua confirmação)
      </label>
      {update.updateAvailable && <p className="t-body">Nova versão: {update.latestVersion}</p>}
      {update.noBuildForPlatform && <p className="t-body">Esta versão ainda não tem atualização para seu sistema.</p>}
      {update.lastCheckFailed && <p role="status" className="t-body">Não foi possível verificar as atualizações. Tente novamente mais tarde.</p>}
      {update.errorMessage && <p role="alert" className="t-body">{update.errorMessage}</p>}
      {update.downloadStatus === 'downloading' && <div className="space-y-1">
        <progress className="w-full" max={100} value={update.downloadProgress} aria-label="Download da atualização" />
        <p className="t-micro">{Math.round(update.downloadProgress)}%</p>
      </div>}
      <div className="flex flex-wrap gap-2">
        <button className={button} disabled={busy} onClick={() => void update.checkForUpdate(true)}>{update.isChecking ? 'Verificando…' : 'Verificar atualizações'}</button>
        {update.updateAvailable && ['idle', 'error'].includes(update.downloadStatus) && <button className={button} disabled={busy} onClick={() => void update.downloadUpdate()}>Baixar atualização</button>}
        {update.downloadStatus === 'downloaded' && <button className={button} disabled={busy} onClick={() => void update.installAndRestart()}>Instalar e reiniciar</button>}
      </div>
      {update.releaseNotes && <details><summary className="cursor-pointer t-body">O que mudou</summary><p className="whitespace-pre-wrap t-body mt-2">{update.releaseNotes}</p></details>}
    </>}
    <p className="t-micro text-gray-500">Windows e macOS sem certificado comercial. Linux e macOS são experimentais.</p>
    {publication.repository && <button className={button} onClick={update.openReleasePage}>Abrir downloads no GitHub</button>}
    <p className="t-micro text-gray-500">Atualizações da engine e dos plugins estão disponíveis separadamente nas configurações.</p>
  </div>
}
