import type { ToolRegistry } from './tool-registry'
import type { AgentRunContext } from '../agent-context'
import { isReadOnlyShellTurn } from '../agent-context'
import { useAgentProfileStore } from '../../stores/agentProfileStore'
import { useScheduleStore } from '../../stores/scheduleStore'
import { useModelStore } from '../../stores/modelStore'
import { useChatStore } from '../../stores/chatStore'
import { backupStoresNow } from '../../lib/store-backup'
import { scheduleRule, scheduleDestination, type StudioSchedule } from '../../lib/schedules'
import { STUDIO_TOOL_NAMES } from '../../lib/studio-capabilities'
import { isRecord } from '../../types/json-guards'
import type { ToolArgs } from './types'
function string(args: ToolArgs, key: string, optional = false): string {
  const value = args[key]
  if (optional && value === undefined) return ''
  if (typeof value !== 'string') throw new Error(`Informe ${key} como texto.`)
  return value
}
function modelFor(run?: AgentRunContext): string {
  return useChatStore.getState().conversations.find(c => c.id === run?.conversationId)?.model || useModelStore.getState().activeModel || ''
}
function mutable(run?: AgentRunContext, signal?: AbortSignal) {
  if (isReadOnlyShellTurn(run)) throw new Error('Este turno é somente leitura; não pode criar agentes ou agendamentos.')
  if (signal?.aborted || run?.abortSignal?.aborted) throw new Error('Cancelado antes de alterar o aplicativo.')
}
export function registerStudioTools(registry: ToolRegistry) {
  registry.registerBuiltin({name:'studio_capabilities',source:'builtin',category:'system',description:'Inspect the native BionicLLM Studio features, current local time and scheduling limits. Use before claiming an app feature does not exist. Does not change anything.',inputSchema:{type:'object',properties:{},required:[]}}, async()=>JSON.stringify({app:'BionicLLM Studio',features:['Agents: saved profiles in the Agents window','Schedules: once, daily, weekly, monthly or intervals of at least 1 minute','RAG documents','Chat and Code','Configured image, video, voice and browser tools','Settings and MCP plugins'],tools:STUDIO_TOOL_NAMES,time:new Date().toISOString(),timezone:Intl.DateTimeFormat().resolvedOptions().timeZone,scheduling:'Runs while this app is running, including minimized/tray. A fully exited app cannot execute timers.'}))
  registry.registerBuiltin({name:'studio_agents_list',source:'builtin',category:'system',description:'List saved native agent profiles and schedules from the same Agents/Agenda windows. Use returned agent IDs when scheduling.',inputSchema:{type:'object',properties:{},required:[]}},async()=>{
    useScheduleStore.getState().refresh()
    if(useScheduleStore.getState().error) throw new Error(useScheduleStore.getState().error!)
    return JSON.stringify({time:new Date().toISOString(),timezone:Intl.DateTimeFormat().resolvedOptions().timeZone,agents:useAgentProfileStore.getState().profiles,schedules:useScheduleStore.getState().items.map(({id,name,agent,goal,rule,timezone,nextAt,enabled})=>({id,name,agentId:agent.id,goal,rule,timezone,nextAt,enabled}))})
  })
  registry.registerBuiltin({name:'studio_agent_create',source:'builtin',category:'workflow',description:'Create and SAVE an agent profile inside the native Agents window, not a script or sub-agent execution. List existing profiles first. Give a name and task instructions. For corrections pass the existing agentId instead of creating another profile with the same name. Optional model defaults to this conversation model. After success use studio_schedule_create if a timer was requested.',inputSchema:{type:'object',properties:{agentId:{type:'string',description:'Existing profile ID to update.'},name:{type:'string'},instructions:{type:'string'},model:{type:'string'}},required:['name','instructions']}},async(args,run,signal)=>{
    mutable(run,signal)
    const name=string(args,'name'),instructions=string(args,'instructions'),model=string(args,'model',true)||modelFor(run)
    const requestedId=string(args,'agentId',true)
    const profiles=useAgentProfileStore.getState().profiles
    const named=profiles.find(p=>p.name.normalize('NFKC').trim().toLocaleLowerCase()===name.normalize('NFKC').trim().toLocaleLowerCase())
    if(requestedId&&!profiles.some(p=>p.id===requestedId))throw new Error('Agente não encontrado. Consulte studio_agents_list.')
    if(named&&named.id!==requestedId){
      if(named.instructions===instructions.trim()&&named.model===model.trim())return JSON.stringify({created:false,agent:named,location:'Agents'})
      throw new Error('Já existe um agente com este nome. Consulte studio_agents_list e informe agentId para corrigir o perfil existente.')
    }
    const id=requestedId||useAgentProfileStore.getState().add(name,instructions,model)
    if(requestedId)useAgentProfileStore.getState().update(id,name,instructions,model)
    const saved=JSON.parse(localStorage.getItem('bionic-agent-profiles-v1')||'{}')
    if(!saved.state?.profiles?.some((p:{id:string})=>p.id===id)||!await backupStoresNow())throw new Error('Não foi possível confirmar o agente salvo. Confira Agentes antes de tentar novamente.')
    return JSON.stringify({created:!requestedId,updated:!!requestedId,agent:useAgentProfileStore.getState().profiles.find(p=>p.id===id),location:'Agents'})
  })
  registry.registerBuiltin({name:'studio_schedule_create',source:'builtin',category:'workflow',description:'Save a REAL timer/schedule in the native Agenda for an existing saved agent ID. List existing schedules first. To correct one, pass its scheduleId instead of creating another. Duplicate names for the same agent are rejected. Use once with local YYYY-MM-DDTHH:mm, daily with HH:mm, weekly with days 0=Sunday..6, monthly with day 1..31, or interval with minutes>=1. Omit startAt to start after one interval, or set startInMinutes:0 to start now. Relative starts use the real app clock; never invent an epoch/date. Use startAt Unix milliseconds only for an explicit absolute start. Ask the user for unspecified timing/goal; never guess. No external script needed.',inputSchema:{type:'object',properties:{scheduleId:{type:'string',description:'Existing schedule ID to update, keeping one task instead of duplicating it.'},agentId:{type:'string'},name:{type:'string'},goal:{type:'string'},timezone:{type:'string'},destination:{type:'string',enum:['history','chat','popup','txt']},rule:{type:'object',properties:{kind:{type:'string',enum:['once','daily','weekly','monthly','interval']},local:{type:'string'},time:{type:'string'},days:{type:'array',items:{type:'number'}},day:{type:'number'},minutes:{type:'number',minimum:1},startAt:{type:'number'},startInMinutes:{type:'number',minimum:0,description:'Delay before first execution; 0 means now, omitted means one full interval.'}},required:['kind']}},required:['agentId','name','goal','rule']}},async(args,run,signal)=>{
    mutable(run,signal)
    const agent=useAgentProfileStore.getState().profiles.find(p=>p.id===string(args,'agentId'))
    if(!agent)throw new Error('Agente não encontrado. Use studio_agents_list ou studio_agent_create primeiro.')
    const timezone=string(args,'timezone',true)||Intl.DateTimeFormat().resolvedOptions().timeZone
    const rawRule=isRecord(args.rule)?{...args.rule}:args.rule
    const relative=isRecord(rawRule)&&rawRule.kind==='interval'&&rawRule.startAt===undefined
    if(relative&&isRecord(rawRule)){
      const delay=rawRule.startInMinutes??rawRule.minutes
      if(typeof delay!=='number'||!Number.isFinite(delay)||delay<0||delay>525600)throw new Error('Informe um atraso inicial válido em minutos.')
      rawRule.startAt=Date.now()+Math.max(1000,delay*60000)
    }
    const name=string(args,'name'),goal=string(args,'goal'),rule=scheduleRule(rawRule),destination=scheduleDestination(args.destination)
    return navigator.locks.request('bionic-studio-schedule-create',async()=>{
    mutable(run,signal)
    useScheduleStore.getState().refresh()
    if(useScheduleStore.getState().error)throw new Error(useScheduleStore.getState().error!)
    const requestedId=string(args,'scheduleId',true)
    const normalized=(value:string)=>value.normalize('NFKC').trim().replace(/\s+/g,' ').toLocaleLowerCase()
    const sameName=(item:StudioSchedule)=>item.agent.id===agent.id&&normalized(item.name)===normalized(name)
    const matches=useScheduleStore.getState().items.filter(sameName)
    const same=(item:StudioSchedule)=>sameName(item)&&item.goal===goal.trim()&&item.timezone===timezone&&(JSON.stringify(item.rule)===JSON.stringify(rule)||(relative&&item.rule.kind==='interval'&&rule.kind==='interval'&&item.rule.minutes===rule.minutes))&&(item.resultDestination??'history')===destination
    let item:StudioSchedule|undefined
    let updated=false
    if(requestedId){
      item=useScheduleStore.getState().items.find(item=>item.id===requestedId&&item.agent.id===agent.id)
      if(!item)throw new Error('Agendamento não encontrado para este agente. Consulte studio_agents_list.')
      await useScheduleStore.getState().update(requestedId,name,goal,agent,timezone,rule,destination)
      item=useScheduleStore.getState().items.find(item=>item.id===requestedId)
      updated=true
    }else{
      item=matches.find(same)
      if(!item&&matches.length)throw new Error('Já existe um agendamento com este nome para o agente. Consulte studio_agents_list e informe scheduleId para corrigir o existente, sem duplicar a tarefa.')
      if(!item){await useScheduleStore.getState().add(name,goal,agent,timezone,rule,destination);item=useScheduleStore.getState().items.find(same)}
    }
    if(!item || !await backupStoresNow())throw new Error('Não foi possível confirmar o agendamento salvo no backup nativo. Confira a Agenda antes de tentar novamente.')
    return JSON.stringify({scheduled:true,updated,schedule:{id:item.id,name:item.name,agentId:agent.id,rule:item.rule,timezone:item.timezone,nextAt:item.nextAt,nextAtLocal:item.nextAt?new Date(item.nextAt).toLocaleString('pt-BR',{timeZone:item.timezone}):null,resultDestination:item.resultDestination},location:'Agenda',requiresRunningApp:true})
    })
  })
}
