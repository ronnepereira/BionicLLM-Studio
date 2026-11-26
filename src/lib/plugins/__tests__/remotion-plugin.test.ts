import { beforeEach, expect, it, vi } from 'vitest'
import type { AgentRunContext } from '../../../api/agent-context'
import { backendCall } from '../../../api/backend'
import { REMOTION_TOOLS, REMOTION_TOOL_NAMES, remotionRoutingText } from '../remotion-tools'
import { executeRemotion, syncRemotionPlugin, useRemotionRuntime } from '../remotion-runtime'
import { toolRegistry } from '../../../api/mcp/tool-registry'
import { resolveChatToolRoute } from '../../chat-tool-intent'
import { selectRelevantTools, selectRelevantToolsAsync } from '../../tool-selection'
import { MUTATING_TOOLS } from '../../mutating-tools'
import { toolCallCapMs, NO_PRACTICAL_CAP_MS } from '../../tool-timeout'

vi.mock('../../../api/backend',()=>({backendCall:vi.fn(),isTauri:()=>true}))
vi.mock('../../../api/mcp/tool-registry',()=>({toolRegistry:{registerBuiltin:vi.fn(),withdrawBuiltin:vi.fn()}}))
const status={root:'C:\\RemotionApp',version:'4.0.546',node:'v26.12.1',guideVersion:'4.0.528'}
beforeEach(()=>{
 vi.clearAllMocks()
 useRemotionRuntime.setState({phase:'on',status,error:null})
 vi.mocked(backendCall).mockImplementation(async(cmd,args)=>cmd==='plugin_remotion_start'?status:cmd==='plugin_remotion_call'?{id:'job-1',kind:args?.name==='remotion_preview'?'preview':'render',status:'completed',output:'C:\\RemotionApp\\out\\test.mp4'}:undefined)
})
it('registers the complete tool set only after connecting to the installed project; Off withdraws it',async()=>{
 await syncRemotionPlugin(true,'C:\\RemotionApp')
 expect(backendCall).toHaveBeenCalledWith('plugin_remotion_start',{root:'C:\\RemotionApp'})
 expect(useRemotionRuntime.getState()).toMatchObject({phase:'on',status})
 expect(vi.mocked(toolRegistry.registerBuiltin).mock.calls.map(c=>c[0].name).sort()).toEqual([...REMOTION_TOOL_NAMES].sort())
 await syncRemotionPlugin(false,'C:\\RemotionApp')
 expect(backendCall).toHaveBeenCalledWith('plugin_remotion_stop')
 expect(useRemotionRuntime.getState().phase).toBe('off')
})
it('shows the real startup error and registers no dead tools',async()=>{
 vi.mocked(backendCall).mockRejectedValueOnce(new Error('Projeto não encontrado'))
 await syncRemotionPlugin(true,'C:\\missing')
 expect(useRemotionRuntime.getState()).toMatchObject({phase:'error',error:expect.stringContaining('Projeto não encontrado')})
 expect(toolRegistry.registerBuiltin).not.toHaveBeenCalled()
})
it('routes explicit Remotion requests and subsequent edits without invoking generic video generation',()=>{
 expect(resolveChatToolRoute('Crie um vídeo com Remotion',false,[])?.capability).toBe('remotion')
 const history=[{role:'user',content:'Crie um vídeo com Remotion'}]
 expect(resolveChatToolRoute('Altere a primeira cena e mostre a prévia',false,history)?.capability).toBe('remotion')
 expect(remotionRoutingText('Obrigado',history)).toBe('Obrigado')
})
it('pins the complete Remotion workflow even under a two-tool cap on keyword and semantic paths',async()=>{
 const perms={system:'auto',workflow:'confirm'} as const
 const text=remotionRoutingText('Agora exporte o vídeo',[{role:'user',content:'Use Remotion'}])
 expect(selectRelevantTools(text,REMOTION_TOOLS,perms as never,2).map(t=>t.name).sort()).toEqual([...REMOTION_TOOL_NAMES].sort())
 expect((await selectRelevantToolsAsync(text,REMOTION_TOOLS,perms as never,{maxTools:2,embed:async texts=>texts.map(()=>[1,0])})).map(t=>t.name).sort()).toEqual([...REMOTION_TOOL_NAMES].sort())
})
it.each(['remotion_write','remotion_import_asset','remotion_compositions','remotion_render','remotion_preview','remotion_cancel'])('enforces read-only turns for %s',async(name)=>{
 expect(MUTATING_TOOLS.has(name)).toBe(true)
 await expect(executeRemotion(name,{}, {readOnlyShellTurn:true} as AgentRunContext)).rejects.toThrow('somente leitura')
 expect(backendCall).not.toHaveBeenCalled()
})
it('refuses a disabled plugin and an already stopped run',async()=>{
 useRemotionRuntime.setState({phase:'off'})
 await expect(executeRemotion('remotion_files',{})).rejects.toThrow('Ative')
 useRemotionRuntime.setState({phase:'on'})
 const controller=new AbortController();controller.abort()
 await expect(executeRemotion('remotion_render',{},undefined,controller.signal)).rejects.toThrow('Cancelado')
 expect(backendCall).not.toHaveBeenCalled()
})
it('passes the actual completed export and gives long operations their own cancellation lifetime',async()=>{
 const output=JSON.parse(await executeRemotion('remotion_render',{composition:'MyComp'}))
 expect(output).toMatchObject({status:'completed',output:'C:\\RemotionApp\\out\\test.mp4'})
 expect(toolCallCapMs('remotion_render',{},{})).toBe(NO_PRACTICAL_CAP_MS)
})
it('cancels the exact owned job when Stop arrives during the wait',async()=>{
 const controller=new AbortController()
 vi.mocked(backendCall).mockImplementation(async(_cmd,args)=>({id:'owned-job',kind:'render',status:args?.name==='remotion_cancel'?'cancelled':'running'}))
 const execution=executeRemotion('remotion_render',{composition:'MyComp'},undefined,controller.signal)
 const rejected=expect(execution).rejects.toThrow(/cancelad/i)
 await vi.waitFor(()=>expect(backendCall).toHaveBeenCalledWith('plugin_remotion_call',{name:'remotion_render',args:{composition:'MyComp'}}))
 controller.abort();await rejected
 expect(backendCall).toHaveBeenCalledWith('plugin_remotion_call',{name:'remotion_cancel',args:{jobId:'owned-job'}})
})
