import { useState } from 'react'
import { Film, RefreshCw } from 'lucide-react'
import { useSettingsStore } from '../../stores/settingsStore'
import { useRemotionRuntime, syncRemotionPlugin, executeRemotion } from '../../lib/plugins/remotion-runtime'

export function RemotionPluginRow(){
  const enabled=useSettingsStore(s=>s.settings.remotionPluginEnabled===true)
  const root=useSettingsStore(s=>s.settings.remotionProjectPath||'C:\\RemotionApp')
  const update=useSettingsStore(s=>s.updateSettings)
  const {phase,status,error,activity}=useRemotionRuntime()
  const [path,setPath]=useState(root)
  const [message,setMessage]=useState('')
  return <div className="px-2.5 py-1.5 border-b border-white/5" data-testid="plugins-remotion">
    <div className="flex items-center justify-between gap-2">
      <div className="flex items-center gap-1.5 min-w-0"><Film size={12}/><span className="t-micro font-medium">Remotion</span><span className="t-micro text-gray-500 truncate">Vídeos · prévia · exportação</span></div>
      <button role="switch" aria-checked={enabled} aria-label="Ativar Remotion" onClick={()=>update({remotionPluginEnabled:!enabled})} className={`shrink-0 flex items-center w-7 h-3.5 rounded-full ${enabled?'bg-lu-accent/45 justify-end':'bg-gray-300/30 dark:bg-white/10 justify-start'}`}><span className="w-3 h-3 rounded-full shadow-sm mx-px bg-white"/></button>
    </div>
    <label className="block t-micro text-gray-500 mt-2">Projeto Remotion instalado
      <input aria-label="Pasta do projeto Remotion" className="w-full mt-1 px-2 py-1 rounded bg-transparent border border-gray-300 dark:border-white/15 text-gray-700 dark:text-gray-300" value={path} onChange={e=>setPath(e.target.value)} onBlur={()=>{if(path.trim()&&path.trim()!==root)update({remotionProjectPath:path.trim()})}} onKeyDown={e=>{if(e.key==='Enter')e.currentTarget.blur()}}/>
    </label>
    <p role="status" className="t-micro text-gray-500 mt-1 break-words">{phase==='starting'?'Conectando ao projeto existente…':phase==='on'?`Conectado · Remotion ${status?.version} · Chat e Código`:phase==='error'?error:'Usa seu projeto existente, sem reinstalar o Remotion.'}</p>
    {enabled&&<div className="flex gap-2 mt-1"><button className="t-micro lu-control" aria-label="Reconectar Remotion" onClick={()=>void syncRemotionPlugin(true,root)}><RefreshCw size={10}/>Reconectar</button>{phase==='on'&&<button className="t-micro lu-control" onClick={()=>{setMessage('Abrindo prévia…');void executeRemotion('remotion_preview',{}).then(()=>setMessage('')).catch(e=>setMessage(String(e)))}}>Abrir Studio</button>}</div>}
    {message&&<p role="status" className="t-micro text-gray-500 mt-1 break-words">{message}</p>}
    {activity&&<p role="status" className="t-micro text-gray-500 mt-1 break-words">{activity}</p>}
  </div>
}
