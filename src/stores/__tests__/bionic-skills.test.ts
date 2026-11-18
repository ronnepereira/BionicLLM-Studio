/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useSkillStore } from '../skillStore'
import { parseSkillMarkdown, appendSkillInstructions } from '../../lib/skills'
import { buildChatSystemPrompt, withHouseConduct } from '../../lib/system-prompt'

const storage = vi.hoisted(() => { const data = new Map<string, string>(); return { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value) }, removeItem: (key: string) => { data.delete(key) }, clear: () => data.clear() } })
vi.stubGlobal('localStorage', storage)
beforeEach(() => { localStorage.clear(); useSkillStore.setState({ skills: [] }) })

describe('installed skills', () => {
  it('imports a discovered library once, disabled, without overwriting later user edits', async () => {
    const store = useSkillStore.getState()
    const id = store.importLocal('C:\\Skills\\research\\SKILL.md', 'Pesquisa', 'Instrução original.', 'Descrição original.')
    expect(useSkillStore.getState().skills[0]).toMatchObject({ id, enabled: false, sourcePath: 'C:\\Skills\\research\\SKILL.md' })
    store.update(id, 'Minha pesquisa', 'Minhas alterações.')
    expect(store.importLocal('c:\\skills\\research\\skill.md', 'Pesquisa', 'Outro conteúdo.', '')).toBe(id)
    await useSkillStore.persist.rehydrate()
    expect(useSkillStore.getState().skills).toHaveLength(1)
    expect(useSkillStore.getState().skills[0]).toMatchObject({ instructions: 'Minhas alterações.', description: 'Descrição original.', enabled: false })
  })
  it('imports instructions as inert data and activates them only after an explicit action', () => {
    const imported = parseSkillMarkdown('---\nname: minha-habilidade\n---\n# Revisão\nLeia o código e explique os problemas.', 'SKILL.md')
    const id = useSkillStore.getState().add(imported.name, imported.instructions)
    const original = buildChatSystemPrompt({})
    expect(buildChatSystemPrompt({}, true, useSkillStore.getState().skills)).toBe(original)
    useSkillStore.getState().setEnabled(id, true)
    const skills = useSkillStore.getState().skills
    expect(buildChatSystemPrompt({}, true, skills)).toContain('Leia o código')
    expect(withHouseConduct('Coding role', skills)).toContain('Coding role')
    expect(withHouseConduct('Coding role', skills)).toContain('não concedem permissões')
    useSkillStore.getState().setEnabled(id, false)
    expect(appendSkillInstructions(original, useSkillStore.getState().skills)).toBe(original)
  })
  it('installs each template once, persists custom edits and removes it', async () => {
    const store = useSkillStore.getState()
    const id = store.install('code-review')
    expect(store.install('code-review')).toBe(id)
    store.update(id, 'Minha revisão', 'Instruções originais do usuário.')
    store.setEnabled(id, true)
    await useSkillStore.persist.rehydrate()
    expect(useSkillStore.getState().skills).toEqual([expect.objectContaining({ id, name: 'Minha revisão', instructions: 'Instruções originais do usuário.', enabled: true })])
    useSkillStore.getState().remove(id)
    expect(useSkillStore.getState().skills).toHaveLength(0)
  })
  it('keeps large active libraries on reload and survives malformed persisted records', async () => {
    const store = useSkillStore.getState()
    const ids = Array.from({ length: 3 }, (_, index) => store.add(`Skill ${index}`, 'x'.repeat(16_000)))
    store.setEnabled(ids[0], true); store.setEnabled(ids[1], true)
    store.setEnabled(ids[2], true)
    await useSkillStore.persist.rehydrate()
    expect(useSkillStore.getState().skills.filter(s => s.enabled)).toHaveLength(3)
    expect(parseSkillMarkdown('x'.repeat(64_001), 'large.md').instructions).toHaveLength(64_001)
    localStorage.setItem('bionic-skills-v1', JSON.stringify({ version: 0, state: { skills: [{ id: 'good', name: 'Good', instructions: 'Keep this', enabled: true }, { id: 'bad', name: null, instructions: 'bad' }, { id: 'good', name: 'Duplicate', instructions: 'Ignore this' }] } }))
    await useSkillStore.persist.rehydrate()
    expect(useSkillStore.getState().skills).toHaveLength(1)
    expect(useSkillStore.getState().skills[0].instructions).toBe('Keep this')
  })
})

it('persists a category without enabling, rewriting or removing the skill', async () => {
  const id = useSkillStore.getState().add('Minha habilidade', 'Instruções preservadas.')
  useSkillStore.getState().setCategory(id, 'media')
  await useSkillStore.persist.rehydrate()
  expect(useSkillStore.getState().skills.find(skill => skill.id === id)).toMatchObject({ category: 'media', enabled: false, instructions: 'Instruções preservadas.' })
})
