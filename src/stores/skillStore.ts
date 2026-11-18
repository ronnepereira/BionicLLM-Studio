import { isSkillCategory, type SkillCategory } from '../lib/skill-categories'
import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { v4 as uuid } from 'uuid'
import { idbStorage } from '../lib/idbStorage'
import { isRecord } from '../types/json-guards'
import { SKILL_TEMPLATES, skillInput, type StudioSkill } from '../lib/skills'

interface SkillState {
  skills: StudioSkill[]
  add: (name: string, instructions: string) => string
  importLocal: (path: string, name: string, instructions: string, description: string) => string
  install: (templateId: string) => string
  update: (id: string, name: string, instructions: string) => void
  setCategory: (id: string, category?: SkillCategory) => void
  setEnabled: (id: string, enabled: boolean) => void
  remove: (id: string) => void
}

export const useSkillStore = create<SkillState>()(persist((set, get) => ({
  skills: [],
  add: (name, instructions) => {
    const input = skillInput(name, instructions)
    const id = uuid()
    set(s => ({ skills: [...s.skills, { ...input, id, enabled: false }] }))
    return id
  },
  install: (templateId) => {
    const existing = get().skills.find(s => s.templateId === templateId)
    if (existing) return existing.id
    const template = SKILL_TEMPLATES.find(t => t.id === templateId)
    if (!template) throw new Error('Habilidade não encontrada.')
    const id = uuid()
    set(s => ({ skills: [...s.skills, { id, templateId, name: template.name, instructions: template.instructions, enabled: false }] }))
    return id
  },
  importLocal: (path, name, instructions, description) => {
    const input = skillInput(name, instructions)
    if (!path || path.length > 4000 || path.includes('\0')) throw new Error('O caminho da habilidade é inválido.')
    const existing = get().skills.find(skill => skill.sourcePath?.toLocaleLowerCase() === path.toLocaleLowerCase())
    if (existing) return existing.id
    const id = uuid()
    set(state => ({ skills: [...state.skills, { ...input, id, enabled: false, sourcePath: path, description: description.slice(0, 1200) }] }))
    return id
  },
  update: (id, name, instructions) => {
    const input = skillInput(name, instructions)
    const skills = get().skills.map(s => s.id === id ? { ...s, ...input } : s)
    set({ skills })
  },
  setCategory: (id, category) => {
    if (category !== undefined && !isSkillCategory(category)) return
    set(state => ({ skills: state.skills.map(skill => skill.id === id ? { ...skill, category } : skill) }))
  },
  setEnabled: (id, enabled) => {
    const skills = get().skills.map(s => s.id === id ? { ...s, enabled } : s)
    set({ skills })
  },
  remove: (id) => set(s => ({ skills: s.skills.filter(skill => skill.id !== id) })),
}), {
  name: 'bionic-skills-v1', storage: createJSONStorage(() => idbStorage),
  partialize: s => ({ skills: s.skills }),
  merge: (saved, current) => {
    const skills: StudioSkill[] = []
    const ids = new Set<string>()
    for (const raw of isRecord(saved) && Array.isArray(saved.skills) ? saved.skills : []) {
      if (!isRecord(raw) || typeof raw.id !== 'string' || !/^[\w-]{1,80}$/.test(raw.id) || ids.has(raw.id) || typeof raw.name !== 'string' || typeof raw.instructions !== 'string') continue
      try {
        const input = skillInput(raw.name, raw.instructions)
        const enabled = raw.enabled === true
        ids.add(raw.id)
        const templateId = typeof raw.templateId === 'string' && SKILL_TEMPLATES.some(t => t.id === raw.templateId) ? raw.templateId : undefined
        const sourcePath = typeof raw.sourcePath === 'string' && raw.sourcePath.length <= 4000 && !raw.sourcePath.includes('\0') ? raw.sourcePath : undefined
        const description = typeof raw.description === 'string' ? raw.description.slice(0, 1200) : undefined
        skills.push({ ...input, id: raw.id, enabled, templateId, sourcePath, description, category: isSkillCategory(raw.category) ? raw.category : undefined })
      } catch { /* An invalid imported entry must not break startup. */ }
    }
    return { ...current, skills }
  },
}))
