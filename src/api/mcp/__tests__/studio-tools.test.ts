// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from 'vitest'
// Node 26 exposes an undefined localStorage getter even in this jsdom setup.
vi.hoisted(() => {
  const values = new Map<string, string>()
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    get length() { return values.size }, key: (i: number) => [...values.keys()][i] ?? null,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, String(value)) },
    removeItem: (key: string) => { values.delete(key) }, clear: () => values.clear(),
  } })
})

import { registerStudioTools } from '../studio-tools'
import { executeParallel, APPROVE_ALL } from '../../agents/tool-executor'
import { useAgentProfileStore } from '../../../stores/agentProfileStore'
import { useScheduleStore } from '../../../stores/scheduleStore'
import { backupStoresNow } from '../../../lib/store-backup'
import { asksForStudioManagement, STUDIO_TOOL_NAMES, STUDIO_APP_CONTEXT } from '../../../lib/studio-capabilities'
import { resolveChatToolRoute, studioToolRoutingText } from '../../../lib/chat-tool-intent'
import { selectRelevantToolsAsync } from '../../../lib/tool-selection'
import { MUTATING_TOOLS } from '../../../lib/mutating-tools'
import { buildChatSystemPrompt } from '../../../lib/system-prompt'
import type { MCPToolDefinition, ToolArgs } from '../types'
import type { ToolRegistry } from '../tool-registry'
vi.mock('../../../lib/store-backup',()=>({backupStoresNow:vi.fn(async()=>true)}))
vi.mock('../../../stores/modelStore',()=>({useModelStore:{getState:()=>({activeModel:'openai::fixture'})}}))
const chatMessage=vi.hoisted(()=>vi.fn())
vi.mock('../../../stores/chatStore',()=>({useChatStore:{getState:()=>({conversations:[],addMessage:chatMessage})}}))
vi.mock('../../agents/sub-agent',()=>({
 buildDelegateExecutor:(runner:(goal:string,context:string,options:unknown)=>Promise<string>)=>async(args:ToolArgs,run:unknown)=>runner(String(args.goal),String(args.context),{run,model:args.model}),
 defaultSubAgentRunner:async(_goal:string,context:string,options:{session:{report:unknown};model:string;run:{workspace:unknown;artifactMode:boolean}})=>{
   expect(context).toContain('Instruções do perfil de teste')
   expect(options.model).toBe('openai::fixture')
   expect(options.run.workspace).toEqual({kind:'fixture'})
   expect(options.run.artifactMode).toBe(false)
   options.session.report={status:'completed',summary:'Resultado verificado.'}
   return 'Resultado verificado.'
 },
}))
vi.mock('../../agent-context',()=>({isReadOnlyShellTurn:(run?:{readOnlyShell?:boolean})=>run?.readOnlyShell===true}))
const tools=new Map<string,{definition:MCPToolDefinition;execute:(args:ToolArgs,run?:never,signal?:AbortSignal)=>Promise<string>}>()
const call=async(name:string,args:ToolArgs={})=>JSON.parse(await tools.get(name)!.execute(args))
beforeEach(()=>{
 chatMessage.mockClear()
 localStorage.clear();useAgentProfileStore.setState({profiles:[]});useScheduleStore.setState({items:[],error:null})
 vi.mocked(backupStoresNow).mockResolvedValue(true)
 Object.defineProperty(navigator,'locks',{configurable:true,value:{request:async(_name:string,work:()=>Promise<void>)=>work()}})
 tools.clear();registerStudioTools({registerBuiltin:(definition:MCPToolDefinition,execute:unknown)=>tools.set(definition.name,{definition,execute:execute as never})} as unknown as ToolRegistry)
})
it('runs a saved profile in this chat with its instructions, model and inherited workspace',async()=>{
 const {agent}=await call('studio_agent_create',{name:'Autor',instructions:'Instruções do perfil de teste'})
 const output=await tools.get('studio_agents_run')!.execute({agentIds:[agent.id],goal:'Escreva e verifique o código no projeto informado.'},{conversationId:'chat-fixture',workspace:{kind:'fixture'}} as never)
 expect(JSON.parse(output)).toMatchObject({status:'completed',summary:'Resultado verificado.'})
 expect(chatMessage).toHaveBeenCalledWith('chat-fixture',expect.objectContaining({role:'system',content:expect.stringContaining('Autor')}))
 expect(MUTATING_TOOLS.has('studio_agents_run')).toBe(true)
})
it.each(['studio_agent_delete','studio_schedule_delete'])('deletes real linked records through %s',async(name)=>{
 const {agent}=await call('studio_agent_create',{name:'Temporário',instructions:'Informe o clima.'})
 const {schedule}=await call('studio_schedule_create',{agentId:agent.id,name:'Temporário',goal:'Clima',rule:{kind:'interval',minutes:60}})
 expect(await call(name,{agentId:agent.id,scheduleId:schedule.id})).toMatchObject({deleted:true})
 await useAgentProfileStore.persist.rehydrate();useScheduleStore.getState().refresh()
 expect(useAgentProfileStore.getState().profiles).toHaveLength(0)
 expect(useScheduleStore.getState().items).toHaveLength(0)
 expect(MUTATING_TOOLS.has(name)).toBe(true)
 await expect(call(name,{agentId:agent.id,scheduleId:schedule.id})).rejects.toThrow('não encontrado')
})
it.each(['studio_agents_run','studio_agent_delete','studio_schedule_delete'])('blocks %s in a read-only or stopped turn',async(name)=>{
 await expect(tools.get(name)!.execute({}, {readOnlyShell:true} as never)).rejects.toThrow('somente leitura')
 const ctrl=new AbortController();ctrl.abort()
 await expect(tools.get(name)!.execute({},undefined,ctrl.signal)).rejects.toThrow('Cancelado')
})
it('creates a real persisted profile and native schedule visible to the same stores after rehydration',async()=>{
 const created=await call('studio_agent_create',{name:'Relógio',instructions:'Informe a hora atual quando solicitado.'})
 expect(created.created).toBe(true);expect(created.agent.model).toBe('openai::fixture')
 await useAgentProfileStore.persist.rehydrate()
 expect(useAgentProfileStore.getState().profiles).toContainEqual(created.agent)
 const args={agentId:created.agent.id,name:'Relógio a cada 5 minutos',goal:'Informe a hora atual.',timezone:'America/Sao_Paulo',rule:{kind:'interval',minutes:5,startAt:Date.now()+300000},destination:'chat'}
 const scheduled=await call('studio_schedule_create',args)
 useScheduleStore.getState().refresh()
 expect(useScheduleStore.getState().items[0]).toMatchObject({id:scheduled.schedule.id,agent:created.agent,rule:args.rule,resultDestination:'chat'})
 const repeated=await call('studio_schedule_create',args)
 expect(repeated.schedule.id).toBe(scheduled.schedule.id);expect(useScheduleStore.getState().items).toHaveLength(1)
 expect((await call('studio_agents_list')).agents).toHaveLength(1)
})

it.each([false,true])('schedules the hourly Sumaré task through executor validation (JSON string: %s)',async(encoded)=>{
 const {agent}=await call('studio_agent_create',{name:'Clima Sumaré',instructions:'Informe o clima em Sumaré.'})
 const rule={kind:'interval',minutes:60}
 const results=await executeParallel([{id:'hourly',toolName:'studio_schedule_create',args:{agentId:agent.id,name:'Clima Sumaré',goal:'Informe o clima em Sumaré.',rule:encoded?JSON.stringify(rule):rule}}],{
  getTool:name=>tools.get(name)?.definition,
  execute:(name,args)=>tools.get(name)!.execute(args),
  awaitApproval:APPROVE_ALL,
 })
 expect(results[0].status).toBe('completed')
 expect(results[0].schemaValidated).toBe(true)
 expect(useScheduleStore.getState().items[0].rule).toMatchObject(rule)
})
it.each([
 {type:'interval',everyMinutes:60,startInMinutes:0},
 {kind:'interval',everyMinutes:60,startInMinutes:0},
 {kind:'interval',everyMinutes:60},
 {kind:'interval',everyMinutes:60,startInMinutes:60},
])('replays the actual Nemotron rule that failed in the saved chat: %j',async(rule)=>{
 const {agent}=await call('studio_agent_create',{name:'Clima Sumaré',instructions:'Consulte o clima atual de Sumaré-SP.'})
 const before=Date.now()
 const args={agentId:agent.id,name:'Clima hora - Sumaré SP',goal:'Buscar clima atual em Sumaré-SP.',rule:JSON.stringify(rule)}
 const execute=()=>executeParallel([{id:'replay',toolName:'studio_schedule_create',args}],{
  getTool:name=>tools.get(name)?.definition,
  execute:(name,values)=>tools.get(name)!.execute(values),awaitApproval:APPROVE_ALL,
 })
 const results=await execute()
 expect(results[0]).toMatchObject({status:'completed',schemaValidated:true})
 const item=useScheduleStore.getState().items[0]
 expect(item.rule).toMatchObject({kind:'interval',minutes:60})
 expect(item.nextAt).toBeGreaterThanOrEqual(before+(rule.startInMinutes===0?1000:3600000))
 expect(await execute()).toMatchObject([{status:'completed'}])
 expect(useScheduleStore.getState().items).toHaveLength(1)
})
it.each([{}, {kind:'interval'}, {kind:'interval',minutes:60,everyMinutes:30}, {kind:'daily',type:'interval',minutes:60}])('rejects ambiguous or incomplete timing with an actionable correction: %j',async(rule)=>{
 const {agent}=await call('studio_agent_create',{name:'Teste',instructions:'Teste'})
 await expect(call('studio_schedule_create',{agentId:agent.id,name:'Teste',goal:'Teste',rule})).rejects.toThrow('"minutes":60')
 expect(useScheduleStore.getState().items).toHaveLength(0)
})
it('keeps the complete tool chain after the user answers the city question, even with a two-tool cap',async()=>{
 const request='crie uma tarefa pra executar a cada 1 hora trazendo o resultado do clima atual da minha cidade'
 expect(resolveChatToolRoute(request,false,[])?.capability).toBe('app')
 const recent=[{role:'user',content:request},{role:'assistant',content:'Qual é a cidade para a tarefa?'}]
 const routed=studioToolRoutingText('Sumaré-SP',recent)
 expect(resolveChatToolRoute('Sumaré-SP',false,recent)?.capability).toBe('app')
 const selected=await selectRelevantToolsAsync(routed,[...tools.values()].map(t=>t.definition),{system:'auto',workflow:'confirm'} as never,{maxTools:2})
 expect(selected.map(t=>t.name)).toEqual([...STUDIO_TOOL_NAMES])
 expect(studioToolRoutingText('Obrigado',recent)).toBe('Obrigado')
 expect(asksForStudioManagement('Crie uma função Python para executar uma tarefa')).toBe(false)
})
it('routes saved team execution, deletion and a missing-project answer through native tools',()=>{
 for(const text of ['Execute os agentes autor e revisor até concluir','Remova os dois agentes','Os agentes devem trabalhar juntos e revisar o código']) expect(resolveChatToolRoute(text,false,[])?.capability).toBe('app')
 const recent=[{role:'user',content:'Execute os agentes autor e revisor'},{role:'assistant',content:'Qual é a pasta do projeto?'}]
 expect(resolveChatToolRoute('C:\\projetos\\site',false,recent)?.capability).toBe('app')
 expect(resolveChatToolRoute('execute eles',false,recent)?.capability).toBe('app')
})
it('rejects invalid or missing timing before saving a schedule and never substitutes a shell script',async()=>{
 const {agent}=await call('studio_agent_create',{name:'Teste',instructions:'Verifique o horário.'})
 await expect(call('studio_schedule_create',{agentId:agent.id,name:'Teste',goal:'Hora',rule:{kind:'interval',minutes:0,startAt:Date.now()}})).rejects.toThrow()
 expect(useScheduleStore.getState().items).toHaveLength(0)
 expect([...tools.keys()]).toEqual([...STUDIO_TOOL_NAMES])
})
it('protects read-only/cancelled turns and reports a failed durable backup instead of claiming success',async()=>{
 await expect(tools.get('studio_agent_create')!.execute({name:'a',instructions:'b'}, {readOnlyShell:true} as never)).rejects.toThrow('somente leitura')
 const abort=new AbortController();abort.abort()
 await expect(tools.get('studio_agent_create')!.execute({name:'a',instructions:'b'},undefined,abort.signal)).rejects.toThrow('Cancelado')
 expect(useAgentProfileStore.getState().profiles).toHaveLength(0)
 vi.mocked(backupStoresNow).mockResolvedValue(false)
 await expect(call('studio_agent_create',{name:'a',instructions:'b'})).rejects.toThrow('confirmar')
 expect(MUTATING_TOOLS.has('studio_agent_create')).toBe(true);expect(MUTATING_TOOLS.has('studio_schedule_create')).toBe(true)
})
it('routes Portuguese native-agent requests and timer follow-ups through native tools even with a small model',async()=>{
 const request='Crie um agente com timer para informar a hora a cada 5 minutos'
 expect(asksForStudioManagement(request)).toBe(true)
 expect(resolveChatToolRoute(request,false,[])?.capability).toBe('app')
 expect(resolveChatToolRoute('A cada 5 minutos',false,[{role:'user',content:'Crie um agente para informar a hora'}])?.capability).toBe('app')
 expect(resolveChatToolRoute('Verificar os preços que eu informar.',false,[{role:'user',content:'Crie um agente com timer'},{role:'assistant',content:'Qual será a tarefa do agente?'}])?.capability).toBe('app')
 expect(resolveChatToolRoute('Obrigado',false,[{role:'user',content:'Crie um agente com timer'},{role:'assistant',content:'Qual será a tarefa do agente?'}])).toBeNull()
 expect(asksForStudioManagement('Crie um script Python de agente')).toBe(false)
 expect(asksForStudioManagement('O que é um agente de software?')).toBe(false)
 const permission={system:'auto',workflow:'confirm'} as const
 const selected=await selectRelevantToolsAsync(request,[...tools.values()].map(t=>t.definition),permission as never,{maxTools:2})
 expect(selected.map(t=>t.name)).toEqual([...STUDIO_TOOL_NAMES])
 expect(buildChatSystemPrompt({})).toContain(STUDIO_APP_CONTEXT)
 expect((await call('studio_capabilities')).scheduling).toContain('fully exited')
})

it('uses the real app clock for hourly timers, rejects near-duplicate creation and updates the original ID',async()=>{
 const {agent}=await call('studio_agent_create',{name:'Clima Sumaré',instructions:'Informe o clima de Sumaré.'})
 const before=Date.now()
 const args={agentId:agent.id,name:'Clima hora Sumaré',goal:'Informar clima a cada hora.',rule:{kind:'interval',minutes:60},destination:'chat'}
 const first=await call('studio_schedule_create',args)
 expect(first.schedule.nextAt).toBeGreaterThanOrEqual(before+3600000)
 expect(first.schedule.nextAt).toBeLessThanOrEqual(Date.now()+3600000)
 const again=await call('studio_schedule_create',args)
 expect(again.schedule.id).toBe(first.schedule.id)
 await expect(call('studio_schedule_create',{...args,goal:'Informar clima a cada hora a partir de agora.'})).rejects.toThrow('scheduleId')
 expect(useScheduleStore.getState().items).toHaveLength(1)
 const updated=await call('studio_schedule_create',{...args,scheduleId:first.schedule.id,goal:'Informar clima a cada hora a partir de agora.',rule:{kind:'interval',minutes:60,startInMinutes:0}})
 expect(updated.updated).toBe(true)
 expect(updated.schedule.id).toBe(first.schedule.id)
 expect(updated.schedule.nextAt).toBeGreaterThan(Date.now())
 expect(updated.schedule.nextAt).toBeLessThanOrEqual(Date.now()+1000)
 expect(useScheduleStore.getState().items).toHaveLength(1)
})
it('serializes concurrent repeated requests so only one hourly timer is saved',async()=>{
 const {agent}=await call('studio_agent_create',{name:'Clima',instructions:'Informe o clima.'})
 // Model the real WebView lock queue for concurrent calls.
 const queues=new Map<string,Promise<unknown>>()
 Object.defineProperty(navigator,'locks',{configurable:true,value:{request:(name:string,work:()=>Promise<void>)=>{
  const next=(queues.get(name)??Promise.resolve()).then(work)
  queues.set(name,next.catch(()=>{}));return next
 }}})
 const args={agentId:agent.id,name:'Clima horário',goal:'Informe o clima.',rule:{kind:'interval',minutes:60}}
 const results=await Promise.all([call('studio_schedule_create',args),call('studio_schedule_create',args)])
 expect(results[0].schedule.id).toBe(results[1].schedule.id)
 expect(useScheduleStore.getState().items).toHaveLength(1)
})

it('corrects an existing agent without creating a second same-name profile',async()=>{
 const first=await call('studio_agent_create',{name:'Clima',instructions:'Informe o clima.'})
 await expect(call('studio_agent_create',{name:'Clima',instructions:'Informe o clima de Sumaré.'})).rejects.toThrow('agentId')
 const changed=await call('studio_agent_create',{agentId:first.agent.id,name:'Clima',instructions:'Informe o clima de Sumaré.'})
 expect(changed.updated).toBe(true)
 expect(changed.agent.id).toBe(first.agent.id)
 expect(useAgentProfileStore.getState().profiles).toHaveLength(1)
})
