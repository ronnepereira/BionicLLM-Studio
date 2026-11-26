// @vitest-environment jsdom
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { RemotionPluginRow } from '../RemotionPluginRow'
import { useSettingsStore } from '../../../stores/settingsStore'
import { useRemotionRuntime } from '../../../lib/plugins/remotion-runtime'
vi.mock('../../../lib/plugins/remotion-runtime',async()=>{
 const {create}=await import('zustand')
 return {useRemotionRuntime:create(()=>({phase:'off',status:null,error:null,activity:null})),syncRemotionPlugin:vi.fn(),executeRemotion:vi.fn(async()=> '{}')}
})
beforeEach(()=>{
 useSettingsStore.getState().updateSettings({remotionPluginEnabled:false,remotionProjectPath:'C:\\RemotionApp'})
 useRemotionRuntime.setState({phase:'off',status:null,error:null,activity:null})
})
afterEach(cleanup)
it('shows the installed-project path and persists the plugin switch in Chat and Code menu row',()=>{
 render(<RemotionPluginRow/>)
 expect((screen.getByLabelText('Pasta do projeto Remotion') as HTMLInputElement).value).toBe('C:\\RemotionApp')
 const toggle=screen.getByRole('switch',{name:'Ativar Remotion'})
 expect(toggle.getAttribute('aria-checked')).toBe('false')
 fireEvent.click(toggle)
 expect(useSettingsStore.getState().settings.remotionPluginEnabled).toBe(true)
 expect(toggle.getAttribute('aria-checked')).toBe('true')
 fireEvent.click(toggle);expect(useSettingsStore.getState().settings.remotionPluginEnabled).toBe(false)
})
it('saves an edited project folder only when the field is committed',()=>{
 render(<RemotionPluginRow/>)
 const field=screen.getByLabelText('Pasta do projeto Remotion')
 fireEvent.change(field,{target:{value:'D:\\MeuVideo'}})
 expect(useSettingsStore.getState().settings.remotionProjectPath).toBe('C:\\RemotionApp')
 fireEvent.blur(field)
 expect(useSettingsStore.getState().settings.remotionProjectPath).toBe('D:\\MeuVideo')
})
it('shows the actual installed version and a useful startup error',()=>{
 useRemotionRuntime.setState({phase:'on',status:{root:'C:\\RemotionApp',version:'4.0.546',node:'v26',guideVersion:'4.0.528'}})
 const rendered=render(<RemotionPluginRow/>)
 expect(screen.getByText(/Conectado · Remotion 4.0.546 · Chat e Código/)).toBeTruthy()
 rendered.unmount()
 useRemotionRuntime.setState({phase:'error',error:'Node.js não encontrado'})
 render(<RemotionPluginRow/>)
 expect(screen.getByText('Node.js não encontrado')).toBeTruthy()
})
