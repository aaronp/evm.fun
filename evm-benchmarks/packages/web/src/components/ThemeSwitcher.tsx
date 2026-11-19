import { useEffect, useState } from 'react'
import { THEMES, getTheme, onThemeChange, setTheme } from '../theme/theme'
import { MoonIcon, PaperIcon, SunIcon } from '../ui/icons'

const label = { dark: 'Dark', light: 'Light', paper: 'Paper' }
const Icon = { dark: MoonIcon, light: SunIcon, paper: PaperIcon }

export function ThemeSwitcher() {
  const [theme, set] = useState(getTheme)
  useEffect(() => onThemeChange(set), [])
  return (
    <fieldset aria-label="Theme" className="flex gap-0.5 rounded-lg border border-line-strong bg-bg p-0.5">
      {THEMES.map(t => {
        const I = Icon[t]
        return (
          <label key={t} title={label[t]} className={`flex cursor-pointer items-center rounded-md border p-1.5 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-accent ${theme === t ? 'border-accent bg-selected text-text' : 'border-transparent text-muted hover:text-text'}`}>
            <input type="radio" name="theme" value={t} checked={theme === t} onChange={() => setTheme(t)} className="sr-only" />
            <I />
            <span className="sr-only">{label[t]}</span>
          </label>
        )
      })}
    </fieldset>
  )
}
