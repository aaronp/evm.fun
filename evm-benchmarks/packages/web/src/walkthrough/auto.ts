/** `?auto=5s` — press the ribbon's Next after a delay. Accepts `5s`, `3` (seconds), `1500ms`, `0.5m`; `off` or `0` turns it off. */
const KEY = 'evmb.walkthrough.auto'

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
