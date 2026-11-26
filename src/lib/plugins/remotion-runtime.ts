import { create } from 'zustand'
import { backendCall, isTauri } from '../../api/backend'
import { toolRegistry } from '../../api/mcp/tool-registry'
import { isReadOnlyShellTurn, type AgentRunContext } from '../../api/agent-context'
import { REMOTION_TOOLS, REMOTION_TOOL_NAMES } from './remotion-tools'
import { MUTATING_TOOLS } from '../mutating-tools'
import type { ToolArgs } from '../../api/mcp/types'

interface RemotionStatus { root: string; version: string; node: string; guideVersion: string }
interface RemotionJob { id: string; kind: string; status: string; url?: string; output?: string; log?: string; progress?: number }
export const useRemotionRuntime = create<{ phase:'off'|'starting'|'on'|'error'; status:RemotionStatus|null; error:string|null; activity:string|null }>(()=>({phase:'off',status:null,error:null,activity:null}))
let turn = 0
// Serialize starts and stops: a slow old start must not outlive a newer Off.
let queue: Promise<void> = Promise.resolve()
const call = <T>(name:string,args:ToolArgs={})=>backendCall<T>('plugin_remotion_call',{name,args})
const delay = (ms:number, signal?:AbortSignal)=>new Promise<void>((resolve,reject)=>{
  const stop=()=>{clearTimeout(timer);signal?.removeEventListener('abort',stop);reject(new Error('Cancelado pelo usuário.'))}
  const timer=setTimeout(()=>{signal?.removeEventListener('abort',stop);resolve()},ms)
  if(signal?.aborted)stop();else signal?.addEventListener('abort',stop,{once:true})
})
export async function executeRemotion(name:string,args:ToolArgs,run?:AgentRunContext,signal?:AbortSignal):Promise<string>{
  const abort=signal??run?.abortSignal
  if(abort?.aborted)throw new Error('Cancelado antes de executar o Remotion.')
  if(useRemotionRuntime.getState().phase!=='on')throw new Error('Ative o Remotion no menu Plugins e confira a pasta do projeto.')
  if(isReadOnlyShellTurn(run)&&MUTATING_TOOLS.has(name))throw new Error('Este turno é somente leitura. A operação Remotion não foi executada.')
  if(!['remotion_compositions','remotion_preview','remotion_render'].includes(name))return JSON.stringify(await call(name,args))
  let job=await call<RemotionJob>(name,args)
  const cancel=()=>{void call('remotion_cancel',{jobId:job.id}).catch(()=>{})}
  if(abort?.aborted)cancel();else abort?.addEventListener('abort',cancel,{once:true})
  try{
    const started=Date.now()
    while(job.status==='running'){
      if(abort?.aborted)throw new Error('Execução Remotion cancelada pelo usuário.')
      if(name==='remotion_preview'&&job.url)break
      if(name==='remotion_preview'&&Date.now()-started>90000){cancel();throw new Error('A prévia não forneceu um endereço em 90 segundos. Confira os erros do projeto.')}
      const activity=`Remotion: ${job.progress??0}%${job.log?` — ${job.log.trim().split(/[\r\n]/).at(-1)?.slice(0,160)}`:''}`
      useRemotionRuntime.setState({activity})
      run?.onToolProgress?.(activity)
      await delay(800,abort)
      job=await call<RemotionJob>('remotion_job_status',{jobId:job.id})
    }
    if(abort?.aborted)throw new Error('Execução Remotion cancelada pelo usuário.')
    if(job.status==='failed'||job.status==='cancelled')throw new Error(`Remotion ${job.status}: ${job.log??'Confira o projeto.'}`)
    if(name==='remotion_preview'){
      if(!job.url||!/^https?:\/\/(localhost|127\.0\.0\.1):\d+$/.test(job.url))throw new Error('A prévia não retornou um endereço local válido.')
      try{
        const {browserReady,browserCommand,claimBrowser}=await import('../../api/studio-browser')
        if(run)claimBrowser(run)
        const tabId=await browserReady(abort)
        await browserCommand({action:'navigate',url:job.url,tabId})
      }catch(error){return JSON.stringify({...job,previewOpenError:String(error),note:'Studio iniciado, mas o painel não abriu. Informe o erro e a URL local; não afirme que a prévia foi exibida.'})}
    }
    return JSON.stringify(job)
  }finally{abort?.removeEventListener('abort',cancel);useRemotionRuntime.setState({activity:null})}
}
export function syncRemotionPlugin(enabled:boolean,root:string):Promise<void>{
  const mine=++turn
  for(const name of REMOTION_TOOL_NAMES)toolRegistry.withdrawBuiltin(name)
  useRemotionRuntime.setState({phase:enabled?'starting':'off',error:null,status:null,activity:null})
  queue=queue.catch(()=>{}).then(async()=>{
    if(mine!==turn)return
    if(!enabled){await backendCall('plugin_remotion_stop');return}
    if(!isTauri())throw new Error('O Remotion local funciona no aplicativo desktop.')
    await backendCall('plugin_remotion_stop')
    if(mine!==turn)return
    const status=await backendCall<RemotionStatus>('plugin_remotion_start',{root})
    if(mine!==turn)return
    for(const tool of REMOTION_TOOLS)toolRegistry.registerBuiltin(tool,(args,run,signal)=>executeRemotion(tool.name,args,run,signal))
    useRemotionRuntime.setState({phase:'on',status,error:null})
  }).catch(error=>{if(mine===turn)useRemotionRuntime.setState({phase:'error',status:null,error:String(error)})})
  return queue
}
