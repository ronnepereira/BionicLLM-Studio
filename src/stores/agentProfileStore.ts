import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { v4 as uuid } from 'uuid'
import { safeJSONStorage } from '../lib/storage-quota'
import { changeSchedules } from './scheduleStore'
import { isRecord } from '../types/json-guards'
import { agentProfileInput, type StudioAgentProfile } from '../lib/agent-profiles'

interface ProfileState {
  profiles: StudioAgentProfile[]
  add: (name: string, instructions: string, model: string) => string
  update: (id: string, name: string, instructions: string, model: string) => void
  remove: (id: string) => Promise<void>
}

export const useAgentProfileStore = create<ProfileState>()(persist((set) => ({
  profiles: [],
  add: (name, instructions, model) => {
    const profile = { ...agentProfileInput(name, instructions, model), id: uuid() }
    set(s => ({ profiles: [...s.profiles, profile] }))
    return profile.id
  },
  update: (id, name, instructions, model) => {
    const input = agentProfileInput(name, instructions, model)
    set(s => ({ profiles: s.profiles.map(profile => profile.id === id ? { ...profile, ...input } : profile) }))
  },
  remove: async id => {
    // Remove durable schedules first: their embedded agent snapshot could otherwise
    // keep executing after its profile is gone. Running tasks observe removal and abort.
    // If the agenda cannot be saved, keep the profile so deletion can be retried.
    await changeSchedules(items => items.filter(item => item.agent.id !== id))
    set(s => ({ profiles: s.profiles.filter(profile => profile.id !== id) }))
  },
}), {
  name: 'bionic-agent-profiles-v1', storage: safeJSONStorage(),
  partialize: state => ({ profiles: state.profiles }),
  merge: (saved, current) => {
    const profiles: StudioAgentProfile[] = [], ids = new Set<string>()
    for (const raw of isRecord(saved) && Array.isArray(saved.profiles) ? saved.profiles : []) {
      if (!isRecord(raw) || typeof raw.id !== 'string' || !/^[\w-]{1,80}$/.test(raw.id) || ids.has(raw.id) || typeof raw.name !== 'string' || typeof raw.instructions !== 'string' || typeof raw.model !== 'string') continue
      try {
        profiles.push({ ...agentProfileInput(raw.name, raw.instructions, raw.model), id: raw.id })
        ids.add(raw.id)
      } catch { /* Invalid records cannot break application startup. */ }
    }
    return { ...current, profiles }
  },
}))
