import { useEffect, useState } from 'react'
import { THEMES, getTheme, onThemeChange, setTheme } from '../theme/theme'
import { MoonIcon, PaperIcon, SunIcon } from '../ui/icons'
import { Segmented } from '../ui/segmented'

const label = { dark: 'Dark', light: 'Light', paper: 'Paper' }
const Icon = { dark: MoonIcon, light: SunIcon, paper: PaperIcon }

export function ThemeSwitcher() {
  const [theme, set] = useState(getTheme)
  useEffect(() => onThemeChange(set), [])
  return (
    <Segmented
      label="Theme" name="theme" value={theme} onChange={setTheme}
      className="flex gap-0.5 rounded-lg border border-line-strong bg-bg p-0.5" itemClassName="flex items-center p-1.5"
      options={THEMES.map(t => { const I = Icon[t]; return { value: t, title: label[t], content: <><I /><span className="sr-only">{label[t]}</span></> } })}
    />
  )
}
