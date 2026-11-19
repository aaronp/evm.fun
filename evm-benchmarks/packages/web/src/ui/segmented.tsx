import type { ReactNode } from 'react'

/** Radio group styled as a segmented control; the selected segment gets the accent border. */
export function Segmented<T extends string>({ label, name, value, options, onChange, className = '', itemClassName = '' }: {
  label: string; name: string; value: T; onChange(v: T): void
  options: { value: T; content: ReactNode; title?: string }[]
  className?: string; itemClassName?: string
}) {
  return (
    <fieldset aria-label={label} className={className}>
      {options.map(o => (
        <label key={o.value} title={o.title} className={`cursor-pointer rounded-md border has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-accent ${itemClassName} ${value === o.value ? 'border-accent bg-selected text-text' : 'border-transparent text-muted hover:text-text'}`}>
          <input type="radio" name={name} value={o.value} checked={value === o.value} onChange={() => onChange(o.value)} className="sr-only" />
          {o.content}
        </label>
      ))}
    </fieldset>
  )
}
