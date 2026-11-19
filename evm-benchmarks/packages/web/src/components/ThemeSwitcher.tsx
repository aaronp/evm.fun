import { useEffect, useState } from 'react'
import { THEMES, getTheme, onThemeChange, setTheme } from '../theme/theme'

const label = { dark: 'Dark', light: 'Light', paper: 'Paper' }

export function ThemeSwitcher() {
  const [theme, set] = useState(getTheme)
  useEffect(() => onThemeChange(set), [])
  return (
    <fieldset aria-label="Theme" className="flex gap-0.5 rounded-lg border border-line-strong bg-bg p-0.5">
      {THEMES.map(t => (
        <label key={t} className={`cursor-pointer rounded-md px-2 py-1 text-xs font-medium has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-accent ${theme === t ? 'bg-selected text-text' : 'text-muted hover:text-text'}`}>
          <input type="radio" name="theme" value={t} checked={theme === t} onChange={() => setTheme(t)} className="sr-only" />
          {label[t]}
        </label>
      ))}
    </fieldset>
  )
}
