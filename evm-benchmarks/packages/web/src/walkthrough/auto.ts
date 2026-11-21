import { withParams } from '../links'

/** `?auto=5s` — press the ribbon's Next after a delay. Accepts `5s`, `3` (seconds), `1500ms`, `0.5m`; `off` or `0` turns it off. */
const KEY = 'evmb.walkthrough.auto'
/** The delay ▶ starts when the address has no `?auto`. */
export const DEFAULT_AUTO = 5000

/** Milliseconds, `null` for "off", `undefined` when the text isn't a delay. */
export function parseAuto(text: string | null | undefined): number | null | undefined {
  if (text == null) return undefined
  const t = text.trim().toLowerCase()
  if (t === 'off' || t === 'false') return null
  const m = /^(\d+(?:\.\d+)?)(ms|s|m)?$/.exec(t)
  if (!m) return undefined
  const ms = Number(m[1]) * (m[2] === 'ms' ? 1 : m[2] === 'm' ? 60_000 : 1000)
  return ms > 0 ? Math.round(ms) : null
}

/** Kept for the tab's session: each step's navigation replaces the page's address and would drop the parameter. */
export function autoDelay(): number | undefined {
  try { const v = Number(sessionStorage.getItem(KEY)); return v > 0 ? v : undefined } catch { return undefined }
}
export function setAutoDelay(ms: number | null) {
  try { ms ? sessionStorage.setItem(KEY, String(ms)) : sessionStorage.removeItem(KEY) } catch { /* not kept */ }
}

/** Picks `auto` up from the hash route's query (`#/get-started?auto=5s`) or the page's own (`/?auto=5s#/…`). */
export function adoptAuto(hashSearch: string, pageSearch: string) {
  const v = parseAuto(new URLSearchParams(hashSearch).get('auto') ?? new URLSearchParams(pageSearch).get('auto'))
  if (v !== undefined) setAutoDelay(v)
}

/** `5000` → `5s`, `1500` → `1500ms`: the form written into the address. */
export const autoText = (ms: number) => (ms % 1000 === 0 ? `${ms / 1000}s` : `${ms}ms`)

/** `path` with `auto=` set to `ms` (default: the current delay), or removed when off; other query params kept.
 *  The ribbon writes it into every address it navigates to, so the speed stays visible and editable in the URL. */
export function withAuto(path: string, ms: number | undefined = autoDelay()): string {
  const i = path.indexOf('?')
  const p = i < 0 ? path : path.slice(0, i)
  const sp = new URLSearchParams(i < 0 ? '' : path.slice(i + 1))
  if (ms) sp.set('auto', autoText(ms)); else sp.delete('auto')
  const s = sp.toString()
  return s ? `${p}?${s}` : p
}

/** Same page and query, ignoring `auto` and `chain`/`as` (the URL sync re-adds those after a navigation). */
const bare = (p: string) => withParams(withAuto(p, 0), { chain: undefined, as: undefined })
export const sameRoute = (a: string, b: string) => bare(a) === bare(b)
