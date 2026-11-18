import { useRef, useState, type InputHTMLAttributes } from 'react'

/** Keep partial numbers editable; validation runs only when the user commits. */
function DraftInput({ value, onChange, onFocus, onBlur, onKeyDown, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  const [draft, setDraft] = useState(String(value ?? ''))
  const [focused, setFocused] = useState(false)
  const cancel = useRef(false)
  return <input {...props} value={focused ? draft : String(value ?? '')}
    onFocus={event => { cancel.current = false; setDraft(String(value ?? '')); setFocused(true); onFocus?.(event) }}
    onChange={event => setDraft(event.target.value)}
    onBlur={event => {
      if (!cancel.current && draft !== String(value ?? '')) onChange?.({ ...event, type: 'change', target: event.currentTarget })
      cancel.current = false; setFocused(false); onBlur?.(event)
    }}
    onKeyDown={event => {
      onKeyDown?.(event)
      if (event.defaultPrevented) return
      if (event.key === 'Enter') { event.preventDefault(); event.currentTarget.blur() }
      if (event.key === 'Escape') { event.preventDefault(); cancel.current = true; setDraft(String(value ?? '')); event.currentTarget.blur() }
    }} />
}

export function SettingsNumberInput(props: InputHTMLAttributes<HTMLInputElement>) {
  return <DraftInput {...props} type="number" />
}

export function SettingsTextInput(props: InputHTMLAttributes<HTMLInputElement>) {
  return <DraftInput {...props} />
}
