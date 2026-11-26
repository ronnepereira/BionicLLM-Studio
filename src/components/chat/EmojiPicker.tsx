import { useEffect, useRef, useState } from 'react'
import data from 'emojibase-data/pt/compact.json'
import messages from 'emojibase-data/pt/messages.json'

const normalize = (text: string) => text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
const emojis = data.filter(emoji => emoji.group !== undefined).flatMap(emoji => [emoji, ...('skins' in emoji ? emoji.skins ?? [] : [])])

export default function EmojiPicker({ onSelect, onClose }: { onSelect: (emoji: string) => void; onClose: () => void }) {
  const [query, setQuery] = useState('')
  const [group, setGroup] = useState('')
  const [limit, setLimit] = useState(144)
  const host = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const click = (event: PointerEvent) => { if (!host.current?.contains(event.target as Node)) onClose() }
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    document.addEventListener('pointerdown', click)
    document.addEventListener('keydown', key)
    return () => { document.removeEventListener('pointerdown', click); document.removeEventListener('keydown', key) }
  }, [onClose])
  const found = emojis.filter(emoji => (group === '' || emoji.group === Number(group)) && normalize(`${emoji.label} ${'tags' in emoji ? emoji.tags?.join(' ') : ''}`).includes(normalize(query)))
  return <div ref={host} role="dialog" aria-label="Emojis" className="absolute bottom-full left-0 z-50 mb-2 w-[320px] max-w-[80vw] rounded-lg border border-gray-300 dark:border-white/20 bg-white dark:bg-gray-900 p-3 shadow-xl text-gray-800 dark:text-gray-100">
    <div className="flex items-center justify-between mb-2"><span className="text-sm font-medium">Emojis ({found.length})</span><button type="button" onClick={onClose} aria-label="Fechar emojis">×</button></div>
    <input autoFocus aria-label="Buscar emoji" placeholder="Buscar: Brasil, coração, sorriso…" value={query} onChange={event => { setQuery(event.target.value); setLimit(144) }} className="w-full rounded border border-gray-300 dark:border-white/20 bg-transparent p-2 text-sm mb-2" />
    <select aria-label="Categoria de emoji" value={group} onChange={event => { setGroup(event.target.value); setLimit(144) }} className="w-full rounded bg-gray-100 dark:bg-gray-800 p-1 text-sm mb-2"><option value="">Todas as categorias</option>{messages.groups.map(category => <option key={category.key} value={category.order}>{category.message}</option>)}</select>
    <div className="max-h-[250px] overflow-y-auto scrollbar-thin">
      <div className="grid grid-cols-8 gap-1">{found.slice(0, limit).map(emoji => <button type="button" key={emoji.hexcode} title={emoji.label} aria-label={emoji.label} onClick={() => onSelect(emoji.unicode)} className="studio-emoji rounded p-1 text-xl hover:bg-gray-100 dark:hover:bg-white/10">{emoji.unicode}</button>)}</div>
      {!found.length && <p className="p-2 text-sm">Nenhum emoji encontrado.</p>}
      {found.length > limit && <button type="button" className="w-full p-2 text-sm" onClick={() => setLimit(value => value + 144)}>Mostrar mais</button>}
    </div>
  </div>
}
