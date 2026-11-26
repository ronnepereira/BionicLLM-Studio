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
  if (isReadOnlyShellTurn(run)) throw new Error('Este turno é somente leitura; não pode alterar agentes, executar equipes ou alterar agendamentos.')
  if (signal?.aborted || run?.abortSignal?.aborted) throw new Error('Cancelado antes de alterar o aplicativo.')
}
const timingError = 'Regra inválida. Para executar a cada 1 hora, use rule: {"kind":"interval","minutes":60}. startInMinutes:0 inicia agora; omitido inicia após 60 minutos.'
const timingSchema = {
  type:'object' as const,
  description:'Timing object. Hourly: {"kind":"interval","minutes":60}. Supply kind and the fields for that frequency.',
  properties:{
    kind:{type:'string' as const,description:'Frequency: interval for recurring minutes/hours.',enum:['once','daily','weekly','monthly','interval']},
    type:{type:'string' as const,description:'Compatibility alias for kind; prefer kind.',enum:['once','daily','weekly','monthly','interval']},
    local:{type:'string' as const,description:'For once: local YYYY-MM-DDTHH:mm.'},
    time:{type:'string' as const,description:'For daily/weekly/monthly: local HH:mm.'},
    days:{type:'array' as const,description:'For weekly: weekdays 0=Sunday through 6=Saturday.',items:{type:'number' as const}},
    day:{type:'number' as const,description:'For monthly: day of month, 1 through 31.'},
    minutes:{type:'number' as const,minimum:1,description:'For interval: minutes between runs. Every hour means 60.'},
    everyMinutes:{type:'number' as const,minimum:1,description:'Compatibility alias for minutes; prefer minutes.'},
    startAt:{type:'number' as const,description:'Explicit absolute first execution in Unix milliseconds. Usually omit.'},
    startInMinutes:{type:'number' as const,minimum:0,description:'Initial delay in minutes: 0 starts now; omitted starts after one full interval.'},
  },
}
export function registerStudioTools(registry: ToolRegistry) {
  registry.registerBuiltin({name:'studio_capabilities',source:'builtin',category:'system',description:'Inspect the native BionicLLM Studio features, current local time and scheduling limits. Use before claiming an app feature does not exist. Does not change anything.',inputSchema:{type:'object',properties:{},required:[]}}, async()=>JSON.stringify({app:'BionicLLM Studio',features:['Agents: saved profiles in the Agents window; execute one or an ordered author/reviewer team with studio_agents_run; delete with studio_agent_delete','Schedules: once, daily, weekly, monthly or intervals of at least 1 minute; studio_schedule_delete removes a schedule and its linked agent','RAG documents','Chat and Code','Configured image, video, voice and browser tools','Settings and MCP plugins'],tools:STUDIO_TOOL_NAMES,time:new Date().toISOString(),timezone:Intl.DateTimeFormat().resolvedOptions().timeZone,scheduling:'Runs while this app is running, including minimized/tray. A fully exited app cannot execute timers.'}))
  registry.registerBuiltin({name:'studio_agents_list',source:'builtin',category:'system',description:'List saved native agent profiles and schedules from the same Agents/Agenda windows. Use returned agent IDs when scheduling.',inputSchema:{type:'object',properties:{},required:[]}},async()=>{
    useScheduleStore.getState().refresh()
    if(useScheduleStore.getState().error) throw new Error(useScheduleStore.getState().error!)
    return JSON.stringify({time:new Date().toISOString(),timezone:Intl.DateTimeFormat().resolvedOptions().timeZone,agents:useAgentProfileStore.getState().profiles,schedules:useScheduleStore.getState().items.map(({id,name,agent,goal,rule,timezone,nextAt,enabled})=>({id,name,agentId:agent.id,goal,rule,timezone,nextAt,enabled}))})
  })
  registry.registerBuiltin({name:'studio_agent_create',source:'builtin',category:'workflow',description:'Create and SAVE an agent profile inside the native Agents window, not a script or sub-agent execution. List existing profiles first. Give a name and task instructions. For corrections pass the existing agentId instead of creating another profile with the same name. Optional model defaults to this conversation model. After success use studio_schedule_create if a timer was requested.',inputSchema:{type:'object',properties:{agentId:{type:'string',description:'Existing profile ID to update.'},name:{type:'string',description:'Short display name of the agent.'},instructions:{type:'string',description:'Task instructions to execute. For weather include city and fresh lookup each run.'},model:{type:'string',description:'Optional model identifier; omit for the current conversation model.'}},required:['name','instructions']}},async(args,run,signal)=>{
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
  registry.registerBuiltin({name:'studio_schedule_create',source:'builtin',category:'workflow',description:'Save a REAL timer/schedule in the native Agenda for an existing saved agent ID. List existing schedules first. To correct one, pass its scheduleId instead of creating another. Duplicate names for the same agent are rejected. Use once with local YYYY-MM-DDTHH:mm, daily with HH:mm, weekly with days 0=Sunday..6, monthly with day 1..31, or interval with minutes>=1. Omit startAt to start after one interval, or set startInMinutes:0 to start now. Relative starts use the real app clock; never invent an epoch/date. Use startAt Unix milliseconds only for an explicit absolute start. Ask the user for unspecified timing/goal; never guess. No external script needed.',inputSchema:{type:'object',properties:{scheduleId:{type:'string',description:'Existing schedule ID to update, keeping one task instead of duplicating it.'},agentId:{type:'string',description:'Exact agent.id from studio_agent_create or studio_agents_list. Create agent first.'},name:{type:'string',description:'Short display name of the schedule.'},goal:{type:'string',description:'Task to execute on each run, including city for weather.'},timezone:{type:'string',description:'IANA timezone; omit for local timezone.'},destination:{type:'string',description:'Result destination; defaults to history.',enum:['history','chat','popup','txt']},rule:timingSchema},required:['agentId','name','goal','rule']}},async(args,run,signal)=>{
    mutable(run,signal)
    const agent=useAgentProfileStore.getState().profiles.find(p=>p.id===string(args,'agentId'))
    if(!agent)throw new Error('Agente não encontrado. Use studio_agents_list ou studio_agent_create primeiro.')
    const timezone=string(args,'timezone',true)||Intl.DateTimeFormat().resolvedOptions().timeZone
    // Some prompt/XML transports encode a nested object as JSON text.
    let ruleValue=args.rule
    if(typeof ruleValue==='string'){
      try{ruleValue=JSON.parse(ruleValue)}catch{throw new Error('rule deve ser um objeto JSON válido, por exemplo {"kind":"interval","minutes":60}.')}
    }
    const rawRule=isRecord(ruleValue)?{...ruleValue}:ruleValue
    if(!isRecord(rawRule))throw new Error(timingError)
    // Observed Nemotron calls use type/everyMinutes despite the canonical schema.
    // Accept these unambiguous aliases; never invent a missing frequency/interval.
    if(rawRule.kind!==undefined&&rawRule.type!==undefined&&rawRule.kind!==rawRule.type)throw new Error(`kind e type conflitantes. ${timingError}`)
    if(rawRule.minutes!==undefined&&rawRule.everyMinutes!==undefined&&rawRule.minutes!==rawRule.everyMinutes)throw new Error(`minutes e everyMinutes conflitantes. ${timingError}`)
    rawRule.kind??=rawRule.type
    rawRule.minutes??=rawRule.everyMinutes
    delete rawRule.type
    delete rawRule.everyMinutes
    if(typeof rawRule.kind!=='string')throw new Error(timingError)
    if(rawRule.kind==='interval'&&(typeof rawRule.minutes!=='number'||!Number.isFinite(rawRule.minutes)||rawRule.minutes<1))throw new Error(timingError)
    const relative=isRecord(rawRule)&&rawRule.kind==='interval'&&rawRule.startAt===undefined
    if(relative&&isRecord(rawRule)){
      const delay=rawRule.startInMinutes??rawRule.minutes
      if(typeof delay!=='number'||!Number.isFinite(delay)||delay<0||delay>525600)throw new Error('Informe um atraso inicial válido em minutos.')
      rawRule.startAt=Date.now()+Math.max(1000,delay*60000)
    }
    const name=string(args,'name'),goal=string(args,'goal'),rule=(()=>{try{return scheduleRule(rawRule)}catch(error){throw new Error(`${String(error)} ${timingError}`)}})(),destination=scheduleDestination(args.destination)
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
  registry.registerBuiltin({name:'studio_agents_run',source:'builtin',category:'workflow',description:'Execute saved native agent profiles NOW in this chat. List profiles first; pass exact IDs in work order (author first, reviewer last). Each agent uses its saved instructions/model, shares the workspace and receives prior results. Review findings return to the author automatically until verified completion, a real blocker, Stop, or repeated lack of progress. Working slices continue with preserved context rather than stopping at the delegate_task iteration cap. Do not substitute delegate_task for saved profiles. Supply a concrete shared goal including paths and acceptance criteria from the user.',inputSchema:{type:'object',properties:{agentIds:{type:'array',items:{type:'string'},description:'1 to 8 distinct saved profile IDs, in order: author then reviewer(s).'},goal:{type:'string',description:'Self-contained shared goal, workspace paths, deliverables and checks requested by the user.'}},required:['agentIds','goal']}},async(args,run,signal)=>{
    mutable(run,signal)
    if(!run?.conversationId)throw new Error('Execute a equipe dentro de uma conversa para receber os resultados e poder interromper.')
    if(!Array.isArray(args.agentIds)||args.agentIds.some(id=>typeof id!=='string'))throw new Error('Informe agentIds como uma lista de IDs de studio_agents_list.')
    const profiles=useAgentProfileStore.getState().profiles
    const agents=args.agentIds.map(id=>{const agent=profiles.find(p=>p.id===id);if(!agent)throw new Error('Agente não encontrado. Consulte studio_agents_list.');return {...agent,model:agent.model||modelFor(run)}})
    const [{runStudioTeam},{buildDelegateExecutor,defaultSubAgentRunner}]=await Promise.all([import('../agents/studio-team'),import('../agents/sub-agent')])
    const result=await runStudioTeam(agents,string(args,'goal'),async(agent,goal,context,session)=>{
      const execute=buildDelegateExecutor((brief,details,options)=>defaultSubAgentRunner(brief,details,{...options,session}))
      // Team workers must inspect each other's real files in the same chat
      // workspace. Plain-chat artifact capture would hide writes from reviewers.
      return execute({goal,context,model:agent.model},{...run,artifactMode:false,abortSignal:signal??run.abortSignal},signal)
    },{
      signal:signal??run.abortSignal,
      exists:id=>useAgentProfileStore.getState().profiles.some(p=>p.id===id),
      progress:text=>run.onToolProgress?.(text),
      report:(agent,report)=>useChatStore.getState().addMessage(run.conversationId!,{id:crypto.randomUUID(),role:'system',notice:report.status==='blocked'?'warn':'info',content:`${agent.name} — ${report.status==='completed'?'etapa concluída':report.status==='changes_required'?'solicitou ajustes':'precisa de você'}\n${report.summary}`,timestamp:Date.now()}),
    })
    return JSON.stringify(result)
  })
  registry.registerBuiltin({name:'studio_agent_delete',source:'builtin',category:'workflow',description:'Delete a saved native agent profile and ALL schedules linked to it. Use only when the user requests removal; first list and identify the exact agentId. This uses the same cascading deletion as the Agents window.',inputSchema:{type:'object',properties:{agentId:{type:'string',description:'Exact saved profile ID from studio_agents_list.'}},required:['agentId']}},async(args,run,signal)=>{
    mutable(run,signal)
    const id=string(args,'agentId')
    if(!useAgentProfileStore.getState().profiles.some(p=>p.id===id))throw new Error('Agente não encontrado. Consulte studio_agents_list.')
    await useAgentProfileStore.getState().remove(id)
    if(!await backupStoresNow())throw new Error('Exclusão aplicada, mas não foi possível confirmar o backup. Confira Agentes e Agenda.')
    return JSON.stringify({deleted:true,agentId:id,linkedSchedulesDeleted:true})
  })
  registry.registerBuiltin({name:'studio_schedule_delete',source:'builtin',category:'workflow',description:'Delete a native schedule AND its associated saved agent, following the same cascading deletion as the Agenda window. First list records and use the exact scheduleId; use only for a user-requested removal.',inputSchema:{type:'object',properties:{scheduleId:{type:'string',description:'Exact saved schedule ID from studio_agents_list.'}},required:['scheduleId']}},async(args,run,signal)=>{
    mutable(run,signal)
    useScheduleStore.getState().refresh()
    if(useScheduleStore.getState().error)throw new Error(useScheduleStore.getState().error!)
    const id=string(args,'scheduleId'),item=useScheduleStore.getState().items.find(s=>s.id===id)
    if(!item)throw new Error('Agendamento não encontrado. Consulte studio_agents_list.')
    await useScheduleStore.getState().remove(id)
    if(!await backupStoresNow())throw new Error('Exclusão aplicada, mas não foi possível confirmar o backup. Confira Agentes e Agenda.')
    return JSON.stringify({deleted:true,scheduleId:id,agentId:item.agent.id,linkedAgentDeleted:true})
  })
}
