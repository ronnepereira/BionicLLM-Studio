import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Check, Brain } from 'lucide-react'
import { usePopoverPlatz } from '../../hooks/usePopoverPlatz'
import { useUiText } from '../../lib/ui-text'
import { effortLabel } from '../../lib/effort'

interface Props {
  thinking: boolean
  lockedOn: boolean
  levels: string[]
  selected: string
  defaultSelected: boolean
  allowDefault: boolean
  onSelect: (value: string | null) => void
}

export function ReasoningEffortPicker({ thinking, lockedOn, levels, selected, defaultSelected, allowDefault, onSelect }: Props) {
  const text = useUiText()
  const [open, setOpen] = useState(false)
  const anchor = useRef<HTMLButtonElement>(null)
  const menu = useRef<HTMLDivElement>(null)
  const placement = usePopoverPlatz(menu, open, { anker: anchor, fest: 'links', bevorzugt: 'oben', deckel: 300, breiteDeckeln: true })
  const options = [...(lockedOn ? [] : ['off']), ...(allowDefault ? [null] : []), ...levels]
  const label = !thinking ? text('Off') : defaultSelected ? text('Default') : text(effortLabel(selected))
  useEffect(() => {
    if (!open) return
    const dismiss = (event: PointerEvent) => {
      if (!menu.current?.contains(event.target as Node) && !anchor.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', dismiss)
    menu.current?.querySelector<HTMLButtonElement>('[aria-checked="true"]')?.focus()
    return () => document.removeEventListener('pointerdown', dismiss)
  }, [open])
  return <>
    <button ref={anchor} data-testid="effort-toggle" className="lu-control lu-control--icon" aria-haspopup="menu" aria-expanded={open}
      aria-label={text('Reasoning effort: {v0}', { v0: label })} title={text('Reasoning effort: {v0}', { v0: label })}
      onClick={() => setOpen(value => !value)}>
      <Brain size={13} />
    </button>
    {open && createPortal(<div ref={menu} role="menu" aria-label={text('Reasoning effort')}
      style={placement.style} className="lu-elevated studio-menu fixed z-[100] min-w-40 overflow-y-auto rounded-xl text-gray-800 dark:text-gray-100 border border-gray-200 dark:border-white/15 bg-white dark:bg-[#242424] p-1 shadow-xl"
      onKeyDown={event => {
        if (event.key === 'Escape') { setOpen(false); anchor.current?.focus() }
        if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
          event.preventDefault()
          const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button')]
          const index = buttons.indexOf(document.activeElement as HTMLButtonElement)
          const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length
          buttons[next]?.focus()
        }
      }}>
      {options.map(value => <button key={value ?? 'default'} type="button" role="menuitemradio"
        aria-checked={value === 'off' ? !thinking : thinking && (value === null ? defaultSelected : !defaultSelected && value === selected)}
        className="flex w-full items-center justify-between gap-4 rounded-lg px-3 py-2 text-left text-sm hover:bg-gray-100 focus:bg-gray-100 dark:hover:bg-white/10 dark:focus:bg-white/10 outline-none"
        onClick={() => { onSelect(value); setOpen(false); anchor.current?.focus() }}>
        {value === 'off' ? text('Off') : value === null ? text('Default') : text(effortLabel(value))}
        {(value === 'off' ? !thinking : thinking && (value === null ? defaultSelected : !defaultSelected && value === selected)) && <Check size={13} />}
      </button>)}
    </div>, document.body)}
  </>
}
