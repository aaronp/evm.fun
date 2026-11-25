// The app's one context: the key store, the chosen `me`, the Workspace opened for it, and the passphrase prompt.
import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { Address, Hex } from 'viem'
import { wasmUrl } from 'revm-wasm/wasm-url' // Vite emits and rewrites this asset URL
import { BrowserKeyStore, IndexedDbKeyPersistence, WrongPassphrase, passphraseProvider, type KeyStore } from '@evmb/keys'
import { IndexedDbWorkspaceStorage, Workspace } from '@evmb/workspace'
import type { UnlockPrompt } from './keys/UnlockDialog'

export const WORKER_URL: string = import.meta.env.VITE_WORKER_URL ?? 'http://127.0.0.1:8799'
const ME_KEY = 'evmb-app-me'

export type Notice = { text: string; kind: 'ok' | 'warn' }
export type AppState = {
  workerUrl: string
  keys: BrowserKeyStore
  /** addresses held in this browser */
  held: Address[]
  me?: Address
  /** open for `me`; reopened when `me` changes */
  workspace?: Workspace
  issuer: boolean
  prompt?: UnlockPrompt & { seq: number }
  notice?: Notice
  setNotice(n: Notice | undefined): void
  generate(): Promise<void>
  importKey(k: Hex): Promise<void>
  choose(a: Address): void
  lock(): void
  submitPassphrase(p: string): void
  cancelPassphrase(): void
}

/** exported for tests, which provide a stub state */
export const Ctx = createContext<AppState | null>(null)
export const useApp = () => {
  const s = useContext(Ctx)
  if (!s) throw new Error('useApp outside AppProvider')
  return s
}

export const cancelled = (e: unknown) => e instanceof Error && e.message === 'cancelled'
export const text = (e: unknown) => (e instanceof Error ? e.message : String(e))
const remember = (a: Address) => { try { localStorage.setItem(ME_KEY, a) } catch {} }
const remembered = () => { try { return localStorage.getItem(ME_KEY) } catch { return null } }

export function AppProvider({ children }: { children: ReactNode }) {
  const [prompt, setPrompt] = useState<AppState['prompt']>()
  const [held, setHeld] = useState<Address[]>([])
  const [me, setMe] = useState<Address>()
  const [workspace, setWorkspace] = useState<Workspace>()
  const [issuer, setIssuer] = useState(false)
  const [notice, setNotice] = useState<Notice>()
  const answer = useRef<(p: string | null) => void>(undefined)

  const core = useMemo(() => {
    const persistence = new IndexedDbKeyPersistence()
    let wrong = false, seq = 0
    const provider = passphraseProvider({
      persistence,
      ask: async (purpose) => {
        const firstRun = (await persistence.list()).length === 0
        return new Promise<string | null>((res) => {
          answer.current = res
          setPrompt({ purpose, firstRun, error: wrong ? 'Wrong passphrase' : '', busy: false, seq: ++seq })
        })
      },
    })
    const store = new BrowserKeyStore({ persistence, provider })
    // Runs fn, re-asking on a wrong passphrase (the dialog stays open, busy, until fn settles).
    // ponytail: one dialog; a second concurrent prompt replaces the first (whose ask then never settles)
    async function unlocked<A>(fn: () => Promise<A>): Promise<A> {
      try {
        for (;;) {
          try { return await fn() } catch (e) {
            if (!(e instanceof WrongPassphrase)) throw e
            wrong = true
          }
        }
      } finally {
        wrong = false
        if (!answer.current) setPrompt(undefined) // else another unlock is waiting on the dialog
      }
    }
    // What the Workspace signs with: every unlock it triggers goes through the dialog.
    const keys: KeyStore = {
      id: store.id,
      list: () => store.list(),
      hasKey: (a) => store.hasKey(a),
      resolve: async (a, purpose) => {
        const scope = await unlocked(() => store.resolve(a, purpose))
        return { withSigner: (fn) => unlocked(() => scope.withSigner(fn)) }
      },
    }
    return { store, keys, unlocked, storage: new IndexedDbWorkspaceStorage() }
  }, [])

  const take = () => { const a = answer.current; answer.current = undefined; return a }
  const warn = (e: unknown) => { if (!cancelled(e)) setNotice({ text: text(e), kind: 'warn' }) }
  const use = (a: Address) => { remember(a); setMe(a) }
  const add = async (make: () => Promise<Address>) => {
    const a = await core.unlocked(make)
    setHeld(await core.store.list())
    use(a)
  }
  const generate = () => add(() => core.store.generate())

  // First run (no keys yet): generate one; else the last chosen key, or the first held.
  useEffect(() => {
    core.store.list().then(async (list) => {
      setHeld(list)
      const saved = remembered()?.toLowerCase()
      const pick = list.find((a) => a.toLowerCase() === saved) ?? list[0]
      if (pick) return setMe(pick)
      await generate()
    }).catch(warn)
  }, [])

  useEffect(() => {
    if (!me) return
    let live = true, ws: Workspace | undefined
    Workspace.open({ workerUrl: WORKER_URL, keys: core.keys, me, storage: core.storage, wasm: wasmUrl }).then((w) => {
      if (!live) return void w.dispose()
      ws = w
      setWorkspace(w)
      // reads root as me (may prompt); unreachable or refused → not an issuer
      w.isIssuer().then((i) => { if (live) setIssuer(i) }, () => {})
    }, (e) => setNotice({ text: `Couldn't open the workspace: ${text(e)}`, kind: 'warn' }))
    return () => {
      live = false
      setWorkspace(undefined)
      setIssuer(false)
      void ws?.dispose()
    }
  }, [me])

  const value: AppState = {
    workerUrl: WORKER_URL, keys: core.store, held, me, workspace, issuer, prompt, notice, setNotice,
    generate: () => generate().catch(warn),
    importKey: (k) => add(() => core.store.importKey(k)),
    choose: use,
    lock: () => core.store.lock(),
    submitPassphrase: (p) => { setPrompt((x) => x && { ...x, busy: true, error: '' }); take()?.(p) },
    cancelPassphrase: () => { take()?.(null); setPrompt(undefined) },
  }
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}
