/** A notice for the next page the shell shows (e.g. after navigating back): kept for one read in sessionStorage. */
const KEY = 'evmb.notice'
export type Tone = 'warn' | 'success'

export function pushNotice(text: string, tone: Tone = 'warn') {
  try { sessionStorage.setItem(KEY, JSON.stringify({ text, tone })) } catch { /* not shown */ }
}

export function takeNotice(): { text: string; tone: Tone } | undefined {
  try {
    const raw = sessionStorage.getItem(KEY)
    sessionStorage.removeItem(KEY)
    return raw ? JSON.parse(raw) : undefined
  } catch { return undefined }
}
