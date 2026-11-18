import { describe, it, expect } from 'vitest'
import { appendSkillInstructions, skillInput, type StudioSkill } from '../skills'
import { buildChatSystemPrompt, withHouseConduct } from '../system-prompt'
const skills: StudioSkill[] = Array.from({ length: 4 }, (_, i) => ({ id: String(i), name: `Skill ${i}`, instructions: 'Leia o código e revise. '.repeat(2500) + `FIM-${i}`, enabled: true }))
describe('skills follow model capacity instead of a fixed character ceiling', () => {
  it('imports more than 16K and sends every active skill to a large cloud model', () => {
    expect(skillInput(skills[0].name, skills[0].instructions).instructions).toBe(skills[0].instructions)
    for (const prompt of [appendSkillInstructions('Base', skills, { local: false, tokens: 400000 }), buildChatSystemPrompt({}, true, skills, {}, { local: false, tokens: 400000 }), withHouseConduct('Code', skills, {}, { local: false, tokens: 400000 })]) {
      for (const skill of skills) expect(prompt).toContain(skill.instructions)
    }
  })
  it('warns for a small cloud window and for local limits, without partial instructions', () => {
    expect(() => appendSkillInstructions('Base', skills, { local: false, tokens: 2000 })).toThrow('não cabem')
    expect(() => appendSkillInstructions('Base', skills, { local: true, tokens: 400000 })).toThrow('não cabem')
  })
  it('counts dense scripts and the base prompt and keeps disabled skills out', () => {
    const dense = [{ ...skills[0], instructions: '漢'.repeat(5000) }]
    expect(() => appendSkillInstructions('Base', dense, { local: false, tokens: 3000 })).toThrow('não cabem')
    expect(() => appendSkillInstructions('Base'.repeat(10000), dense, { local: false, tokens: 5000 })).toThrow('não cabem')
    expect(appendSkillInstructions('Base', skills.map(s => ({ ...s, enabled: false })), { local: false, tokens: 1 })).toBe('Base')
  })
})
