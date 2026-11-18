import { Modal } from '../ui/Modal'
import { SkillCategoryFilters } from './SkillCategoryFilters'
import { skillCategoryFor, skillCategoryCounts, skillCategoryLabel, type SkillCategoryFilter } from '../../lib/skill-categories'
import { useCallback, useEffect, useState } from 'react'
import { FolderSearch, FolderOpen, RefreshCw, Download, Check } from 'lucide-react'
import { useUiText } from '../../lib/ui-text'
import { backendCall, isTauri } from '../../api/backend'
import { useSkillStore } from '../../stores/skillStore'
import { previewSkillMarkdown, SKILL_TEXT_LIMIT } from '../../lib/skills'

interface LocalSkill { path: string; name: string; description: string; origin: string; bytes: number; importable: boolean }
interface Scan { skills: LocalSkill[]; roots: string[]; warnings: string[]; limited: boolean }
const button = 'inline-flex items-center justify-center gap-2 rounded-lg border border-gray-300 dark:border-white/15 px-3 py-2 text-sm hover:bg-gray-100 dark:hover:bg-white/5 disabled:opacity-50'

export function LocalSkillsDiscovery({ query }: { query: string }) {
  const text = useUiText()
  const skills = useSkillStore(state => state.skills)
  const [category, selectCategory] = useState<SkillCategoryFilter>('all')
  const [found, setFound] = useState<Scan | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [review, setReview] = useState<{ source: LocalSkill; name: string; instructions: string } | null>(null)
  const scan = useCallback(async (chooseFolder = false) => {
    setBusy(true); setError('')
    try { setFound(await backendCall<Scan>('studio_skills_scan', { chooseFolder })); setReview(null) }
    catch (error) { setError(error instanceof Error ? error.message : String(error)) }
    finally { setBusy(false) }
  }, [])
  useEffect(() => { if (isTauri()) void scan() }, [scan])
  const inspect = async (source: LocalSkill) => {
    setBusy(true); setError('')
    try {
      const markdown = await backendCall<string>('studio_skill_read', { path: source.path })
      setReview({ source, ...previewSkillMarkdown(markdown, source.path.split(/[\\/]/).at(-2) || source.name) })
    } catch (error) { setError(error instanceof Error ? error.message : String(error)) }
    finally { setBusy(false) }
  }
  const install = () => {
    if (!review) return
    try {
      useSkillStore.getState().importLocal(review.source.path, review.name, review.instructions, review.source.description)
      setReview(null); setError('')
    } catch (error) { setError(error instanceof Error ? error.message : String(error)) }
  }
  const needle = query.trim().toLocaleLowerCase()
  const searched = found?.skills.map(skill => ({ ...skill, category: skills.find(installed => installed.sourcePath?.toLocaleLowerCase() === skill.path.toLocaleLowerCase())?.category })).filter(skill => !needle || [skill.name, skill.description, skill.origin, skill.path].some(value => value.toLocaleLowerCase().includes(needle))) ?? []
  const matching = searched.filter(skill => category === 'all' || skillCategoryFor(skill) === category)
  const reviewedInstalled = review ? skills.some(skill => skill.sourcePath?.toLocaleLowerCase() === review.source.path.toLocaleLowerCase()) : false
  return <section className="space-y-4" aria-label={text('Skills found on this PC')}>
    <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-base font-semibold flex items-center gap-2"><FolderSearch size={17} />{text('Skills found on this PC')}{found ? ` · ${found.skills.length}` : ''}</h2><p className="text-xs text-gray-500 mt-1">{text('Find SKILL.md libraries used by Cline, Codex, Claude, Hermes and Agent Skills. Originals remain unchanged.')}</p></div><div className="flex gap-2 flex-wrap"><button className={button} disabled={!isTauri() || busy} onClick={() => { void scan() }}><RefreshCw size={14} className={busy ? 'animate-spin' : ''} />{text('Scan PC')}</button><button className={button} disabled={!isTauri() || busy} onClick={() => { void scan(true) }}><FolderOpen size={14} />{text('Choose another folder')}</button></div></div>
    {!isTauri() && <p className="text-sm text-gray-500">{text('Local skill discovery is available in the desktop app. You can still import Markdown files in this web preview.')}</p>}
    {error && <p role="alert" className="rounded-lg border border-red-400/40 p-3 text-sm text-red-600 dark:text-red-400">{error}</p>}
    {review && <Modal open={!!review} title={review.name} onClose={() => setReview(null)} maxWidth="max-w-2xl"><div className="space-y-3"><h3 className="font-medium">{text('Review before importing')} · {review.name}</h3>{error && <p role="alert" className="text-sm text-red-500">{error}</p>}<p className="text-xs text-gray-500 break-all">{review.source.path}</p><textarea readOnly aria-label={text('Skill import preview')} className="w-full min-h-48 rounded-lg border border-gray-300 dark:border-white/15 bg-transparent p-3 text-sm" value={review.instructions} /><p className="text-xs text-gray-500">{text('Only the Markdown instructions are copied. Auxiliary files are not copied, scripts are not executed and the skill starts disabled.')}</p>{review.instructions.length > SKILL_TEXT_LIMIT && <p className="text-xs text-amber-500">Leitura completa disponível. A importação aceita até 16.000 caracteres de instruções.</p>}<div className="flex gap-2"><button className={button} disabled={reviewedInstalled || review.instructions.length > SKILL_TEXT_LIMIT} onClick={install}><Download size={14} />{text(reviewedInstalled ? 'Skill installed' : 'Import into BionicLLM')}</button><button className={button} onClick={() => setReview(null)}>{text('Cancel')}</button></div></div></Modal>}
    {found && <>
      <details className="text-xs text-gray-500"><summary className="cursor-pointer">{text('Searched folders')} · {found.roots.length}</summary><ul className="mt-2 space-y-1">{found.roots.map(root => <li key={root} className="break-all">{root}</li>)}</ul></details>
      {found.limited && <p className="text-sm text-amber-600 dark:text-amber-400">{text('The scan reached its safety limit. Choose a more specific folder to find additional skills.')}</p>}
      {found.warnings.map(warning => <p key={warning} className="text-xs text-amber-600 dark:text-amber-400">{warning}</p>)}
      <SkillCategoryFilters value={category} onChange={selectCategory} counts={skillCategoryCounts(searched)} label="Categorias das habilidades encontradas no PC" />
      <p className="text-xs text-gray-500">{matching.length} de {searched.length} habilidades nesta busca</p>
      {!matching.length && <p className="text-sm text-gray-500">{text('No matching skills were found. Try another folder.')}</p>}
      <div className="grid gap-3 md:grid-cols-2">{matching.map(skill => {
        const installed = skills.find(installed => installed.sourcePath?.toLocaleLowerCase() === skill.path.toLocaleLowerCase())
        return <article key={skill.path} className="min-w-0 rounded-xl border border-gray-200 bg-gray-50 p-3 dark:border-white/10 dark:bg-white/[0.02]" data-testid="discovered-skill-card">
          <div className="flex items-start justify-between gap-2"><button type="button" disabled={busy || !skill.importable} onClick={() => { void inspect(skill) }} title={skill.path} className="min-w-0 break-words text-left text-sm font-semibold hover:text-blue-500">{skill.name}</button>
            {installed && <button role="switch" aria-checked={installed.enabled} aria-label={'Ativar ' + installed.name} className="shrink-0 rounded px-2 py-1 text-xs text-blue-500" onClick={() => {
              try { useSkillStore.getState().setEnabled(installed.id, !installed.enabled); setError('') }
              catch (error) { setError(error instanceof Error ? error.message : String(error)) }
            }}>{installed.enabled ? 'Ativa · desativar' : 'Inativa · ativar'}</button>}
          </div>
          {skill.description && <p className="mt-2 line-clamp-2 text-xs leading-relaxed text-gray-500">{skill.description}</p>}
          <div className="mt-3 flex flex-wrap items-center gap-2"><span className="mr-auto rounded-full bg-blue-500/10 px-2 py-0.5 text-[0.65rem] text-blue-600 dark:text-blue-400">{skillCategoryLabel(skillCategoryFor(skill))}</span>
            <span className="text-[0.65rem] text-gray-500">{skill.origin} · {Math.ceil(skill.bytes / 1024)} KB</span>
            <button className="inline-flex items-center gap-1 text-xs text-blue-500 disabled:opacity-40" disabled={busy || !skill.importable} onClick={() => { void inspect(skill) }} aria-label={text('Review {v0}', { v0: skill.name })}>{installed ? <Check size={13} /> : <Download size={13} />}{installed ? 'Ler original' : text('Review and import')}</button>
          </div>
          {!skill.importable && <p className="mt-2 text-xs text-amber-600 dark:text-amber-400">{text('This file exceeds the 64 KB import limit. The original remains available in its source folder.')}</p>}
        </article>
      })}</div>
    </>}
  </section>
}
