import { SKILL_CATEGORIES, type SkillCategoryFilter } from '../../lib/skill-categories'
export function SkillCategoryFilters({ value, onChange, counts, label }: {
  value: SkillCategoryFilter; onChange: (value: SkillCategoryFilter) => void
  counts: Partial<Record<SkillCategoryFilter, number>>; label: string
}) {
  return <div role="group" aria-label={label} className="flex flex-wrap gap-1.5">
    {[{ id: 'all' as const, label: 'Todas' }, ...SKILL_CATEGORIES].map(category => {
      const count = counts[category.id] || 0
      if (!count && category.id !== 'all' && value !== category.id) return null
      return <button key={category.id} type="button" aria-pressed={value === category.id} onClick={() => onChange(category.id)}
        className={'rounded-full border px-3 py-1.5 text-xs transition-colors focus-visible:ring-2 focus-visible:ring-blue-500 ' + (value === category.id ? 'border-[#1f6feb] bg-[#1f6feb] text-white' : 'border-gray-200 text-gray-600 hover:border-blue-400 dark:border-white/15 dark:text-gray-400')}>
        {category.label} <span className="ml-1 tabular-nums opacity-75">{count}</span>
      </button>
    })}
  </div>
}
