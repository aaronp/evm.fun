export const THEMES = ['dark', 'light', 'paper'] as const
export type Theme = typeof THEMES[number]
const KEY = 'evmb.theme'

// Keep in sync with the inline pre-paint script in index.html.
export function initialTheme(stored: string | null, prefersDark: boolean): Theme {
  return (THEMES as string[]).includes(stored ?? '') ? (stored as Theme) : prefersDark ? 'dark' : 'light'
}

let current: Theme | undefined
const listeners = new Set<(t: Theme) => void>()

function read(): string | null {
  try { return localStorage.getItem(KEY) } catch { return null }
}
const osDark = () => typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches

export function getTheme(): Theme {
  return (current ??= initialTheme(read(), osDark()))
}

export function setTheme(t: Theme): void {
  current = t
  document.documentElement.dataset.theme = t
  try { localStorage.setItem(KEY, t) } catch { /* storage blocked: keep it for this session */ }
  listeners.forEach((cb) => cb(t))
}

export function onThemeChange(cb: (t: Theme) => void): () => void {
  listeners.add(cb)
  return () => void listeners.delete(cb)
}
