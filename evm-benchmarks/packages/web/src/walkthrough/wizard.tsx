import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useApp } from '../state'
import { accounts } from '../store/accounts'
import { registry } from '../chain/revm'
import { kv } from '../store/kv'
import { bundled } from '../../walkthroughs'
import { binding, lastRegistered, type Binding } from './bindings'
import { checks, done, initialInputs, newRun, record, type Env } from './run'
import { sameRoute, setAutoDelay, withAuto } from './auto'
import { activeId, loadRun, saveRun, setActiveId } from './runs'
import type { Outputs, Run, Step, StepType, Walkthrough } from './types'
import type { Fix } from '../fix'
import { useGasFix } from '../components/Shortfall'

type Active = { w: Walkthrough; run: Run; index: number }
export type CheckResult = Awaited<ReturnType<typeof checks>>[number]
/** A step's failure: the page's message, and a one-click fix when there is one (e.g. "Request 5 GBP from alice"). */
export type Failure = { message: string; fix?: Fix }
/** What a page's handler returns: its error message (or `Failure`) when it did not succeed, else nothing. */
export type Outcome = string | Failure | undefined | void
type Press = () => Outcome | Promise<Outcome>
/** Wraps a page handler for `useWizardAction`: throws the page's own message (and fix), so Next shows it as the step's error. */
export const orThrow = async (o: Outcome | Promise<Outcome>) => {
  const e = await o
  if (e) throw typeof e === 'string' ? new Error(e) : Object.assign(new Error(e.message), { fix: e.fix })
}
/** A handler's error message paired with `fix` (when both); success and fix-less failures unchanged. */
export const withFix = (e: string | undefined, fix?: Fix): Outcome => (e && fix ? { message: e, fix } : e)
/** What Next shows for a thrown failure: its message and the fix `orThrow` attached. */
export const failure = (e: unknown): Failure => ({ message: message(e), fix: (e as { fix?: Fix } | undefined)?.fix })
const tick = () => new Promise(r => setTimeout(r, 50))
/** A fix's round trip is over: it was opened (`opened`) and the location has left it — its Send landed and came back
 *  (or you went elsewhere). The step's error and fix are then stale, and a second Request would send twice. */
export const fixReturned = (opened: boolean, here: string, href: string) => opened && !sameRoute(here, href)

export type Layout = 'horizontal' | 'vertical'

export type Wizard = {
  w?: Walkthrough; run?: Run; index: number; step?: Step; b?: Binding
  isDone(step: Step): boolean
  results: Record<string, CheckResult[]>
  error?: string; busy: boolean
  /** the step error's one-click fix, shown under it */
  fix?: Fix
  /** account steps recorded because the label already existed */
  reused: Set<string>
  start(w: Walkthrough): Promise<void>
  restart(w?: Walkthrough): void
  exit(): void
  next(): Promise<void>
  back(): void
  layout: Layout; setLayout(l: Layout): void
  focus: boolean; setFocus(f: boolean): void
  // for the hooks
  actions: Map<string, Press>
  initial(id: string): string | undefined
  values: Record<string, string>
  filled: Record<string, string>
  /** bumped after Next switched chain/account: bound fields the switch emptied are filled again */
  refill: number
  bump(): void
  report(id: string, outputs: Outputs[StepType]): void
}

const Ctx = createContext<Wizard | null>(null)
export const useWizard = () => useContext(Ctx)

const LAYOUT = 'evmb.walkthrough.layout', FOCUS = 'evmb.walkthrough.focus'
const read = (k: string) => { try { return localStorage.getItem(k) } catch { return null } }
const write = (k: string, v: string) => { try { localStorage.setItem(k, v) } catch { /* not remembered */ } }
const message = (e: unknown) => e instanceof Error ? e.message : String(e)
/** The step to stand on: the first not done (by `done` when known, else by the run's records), or the last. */
export const firstOpen = (w: Walkthrough, run: Run, done?: Record<string, boolean>) =>
  (i => i === -1 ? w.steps.length - 1 : i)(w.steps.findIndex(s => !(done ? done[s.id] : run.steps[s.id])))
const addressOf = (run: Run, ref: unknown) => (run.values[String(ref).replace(/^\$/, '')] as { address?: string } | undefined)?.address
const chainOf = (w: Walkthrough, run: Run) => {
  const key = Object.keys(w.keys).find(k => 'chain' in w.keys[k]!)
  return key ? run.values[key] as Outputs['chain'] | undefined : undefined
}

/** pass ✓; fail red; fail after the user changed a value amber ("Differs from the walkthrough"). */
export const checkTone = (pass: boolean, edited: boolean) => pass ? 'pass' : edited ? 'differs' : 'fail'

const defaultEnv: Env = { accounts, registry } // module-level: a fresh object per render would re-run the status effect forever

type Status = { run?: Run; done: Record<string, boolean>; results: Record<string, CheckResult[]>; errors: Record<string, string> }

export function WizardProvider({ children, seed, env = defaultEnv }: { children?: ReactNode; seed?: { w: Walkthrough; run: Run; index?: number; error?: Failure }; env?: Env }) {
  const app = useApp() as ReturnType<typeof useApp> | undefined
  const goTo = useNavigate()
  /** every walkthrough navigation carries the current `?auto=` so the speed stays in the address */
  const navigate = useCallback((path: string) => goTo(withAuto(path)), [goTo])
  const location = useLocation()
  const [active, setActive] = useState<Active | undefined>(seed && { ...seed, index: seed.index ?? firstOpen(seed.w, seed.run) })
  const [status, setStatus] = useState<Status>({ done: {}, results: {}, errors: {} })
  const [fail, setFail] = useState<Failure | undefined>(seed?.error)
  const setError = useCallback((m?: string) => setFail(m === undefined ? undefined : { message: m }), [])
  const [busy, setBusy] = useState(false)
  const [reused, setReused] = useState(() => new Set<string>())
  const [layout, setLayoutState] = useState<Layout>(() => read(LAYOUT) === 'vertical' ? 'vertical' : 'horizontal')
  const [focus, setFocusState] = useState(() => read(FOCUS) !== '0')
  const [version, setVersion] = useState(0)
  const [refill, setRefill] = useState(0)
  const actions = useRef(new Map<string, Press>()).current
  const fields = useRef({ values: {} as Record<string, string>, filled: {} as Record<string, string> }).current
  const bump = useCallback(() => setVersion(v => v + 1), [])

  const { w, run, index } = active ?? {}
  const step = w?.steps[index!]
  const b = step && binding(step, w!)
  const taken = (app?.chains ?? []).map(c => c.name).join('\0')
  const { initials, initialError } = useMemo(() => {
    if (!w || !step || !run) return { initials: {} as Record<string, string> }
    try { return { initials: initialInputs(w, step, run, taken ? taken.split('\0') : []) } }
    catch (e) { return { initials: {} as Record<string, string>, initialError: message(e) } }
  }, [w, step, run, taken])

  // persist when the run changes (not the one just loaded or seeded)
  const saved = useRef(seed?.run)
  useEffect(() => {
    if (!run || run === saved.current) return
    saved.current = run
    saveRun(run).catch(e => setError(`The walkthrough's progress was not saved: ${message(e)}`))
  }, [run])

  // which steps are done and their checks; after start/resume, stand on the first step not done
  const place = useRef<Run>(undefined)
  useEffect(() => {
    if (!w || !run) return
    let live = true
    ;(async () => {
      const st: Status = { run, done: {}, results: {}, errors: {} }
      for (const s of w.steps) {
        try {
          st.done[s.id] = await done(w, s, env, run)
          if (run.steps[s.id]) st.results[s.id] = await checks(w, s, env, run)
        } catch (e) { st.done[s.id] = false; st.errors[s.id] = message(e) }
      }
      if (!live) return
      setStatus(st)
      if (place.current === run) {
        place.current = undefined
        setActive(a => a && a.run === run ? { ...a, index: firstOpen(w, run, st.done) } : a)
      }
    })()
    return () => { live = false }
  }, [w, run, env])

  const reset = useCallback(() => {
    fields.values = {}
    fields.filled = {}
    setReused(new Set())
    setError(undefined)
  }, [fields])

  /** Resumes the saved run (or starts one) and, unless resuming after a reload, opens the step's page. */
  const start = useCallback(async (w: Walkthrough, open = true) => {
    const loaded = await loadRun(w.id)
    const run = loaded ?? newRun(w), index = firstOpen(w, run)
    saved.current = loaded
    place.current = run
    reset()
    setActiveId(w.id)
    setActive({ w, run, index })
    if (open) navigate(binding(w.steps[index]!, w).path(run))
  }, [navigate, reset])

  // resume the walkthrough in progress after a reload
  useEffect(() => {
    if (seed) return
    const id = activeId()
    if (!id) return
    ;(async () => {
      const w = (await kv.get<Walkthrough>('walkthroughEdits', id)) ?? bundled.find(x => x.id === id)
      if (!w) throw new Error(`there is no walkthrough "${id}"`)
      await start(w, false)
    })().catch(e => setError(`Couldn't resume the walkthrough: ${message(e)}`))
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // a step that failed for lack of ETH for fees gets "Request … ETH from …", fixed when found (its href keeps the failing page)
  const gas = useGasFix(fail && !fail.fix ? fail.message : undefined)
  useEffect(() => { if (gas) setFail(f => f && !f.fix ? { ...f, fix: gas } : f) }, [gas?.href]) // eslint-disable-line react-hooks/exhaustive-deps
  // after the fix's round trip, clear the step's error (and fix): pressing Request again would send twice
  const here = location.pathname + location.search, fixHref = fail?.fix?.href, opened = useRef(false)
  useEffect(() => {
    if (!fixHref) opened.current = false
    else if (fixReturned(opened.current, here, fixHref)) { opened.current = false; setFail(undefined) }
    else if (sameRoute(here, fixHref)) opened.current = true
  }, [here, fixHref])

  const latest = useRef({ active, status, initials, busy, location, app })
  latest.current = { active, status, initials, busy, location, app }

  const isDone = useCallback((s: Step) => {
    const { active, status } = latest.current
    if (!active) return false
    return status.run === active.run ? !!status.done[s.id] : !!active.run.steps[s.id]
  }, [])

  const go = useCallback((i: number) => {
    fields.values = {}
    fields.filled = {}
    setError(undefined)
    setActive(a => a && { ...a, index: i })
  }, [fields])
  const setRun = (run: Run) => setActive(a => a && { ...a, run })

  const report = useCallback((id: string, outputs: Outputs[StepType]) => {
    const { active, initials } = latest.current
    if (!active) return
    const step = active.w.steps[active.index]!, b = binding(step, active.w)
    if (b.report !== id) return
    const inputs = Object.fromEntries(b.fields.filter(f => f in fields.values).map(f => [f, fields.values[f]!]))
    setActive(a => a && { ...a, run: record(a.w, a.run, step, outputs, Object.keys(inputs).length ? inputs : undefined, { ...initials, ...fields.filled }) })
  }, [fields])

  const next = useCallback(async () => {
    const { active, busy, location, app } = latest.current
    if (!active || busy) return
    const { w, run, index } = active, step = w.steps[index]!
    setError(undefined)
    if (isDone(step)) {
      // open the next step's page, so its control pulses there before the following Next presses it
      if (index < w.steps.length - 1) { go(index + 1); navigate(binding(w.steps[index + 1]!, w).path(run)) }
      return
    }
    setBusy(true)
    try {
      const b = binding(step, w), path = b.path(run)
      if (step.do === 'account') {
        // the label as the page has it now (the user may have edited it), else the walkthrough's
        const initial = { ...latest.current.initials, ...fields.filled }
        const label = fields.values['account.label'] ?? initial['account.label']
        const existing = env.accounts.list().find(a => a.label === label)
        if (existing) {
          setReused(r => new Set(r).add(step.id))
          setRun(record(w, run, step, { label: existing.label, address: existing.address }, { 'account.label': label! }, initial))
          return
        }
      }
      if (step.do === 'view') {
        if (!sameRoute(location.pathname + location.search, path)) navigate(path)
        setRun(record(w, run, step, {})); return
      }
      // chain and acting account first, and wait until the app (and so the page) has them: an action already
      // registered must not be pressed with the closure of the previous account
      const chain = chainOf(w, run)
      const from = step.args?.from ? addressOf(run, step.args.from) : undefined
      const ready = () => {
        const a = latest.current.app
        return (!chain || a?.chain?.info.id === chain.id) && (!from || a?.account?.toLowerCase() === from.toLowerCase())
      }
      if (!ready()) {
        if (chain && app?.chain?.info.id !== chain.id) await app?.selectChain(chain.id)
        if (from) app?.selectAccount(from)
        for (let i = 0; i < 100 && !ready(); i++) await tick()
        if (!ready()) throw new Error("Couldn't switch to the walkthrough's chain and account.")
        await tick() // the page's effects for the switch (e.g. Swap clearing its selection) run first
        setRefill(n => n + 1)
      }
      if (!sameRoute(location.pathname + location.search, path)) navigate(path)
      await tick() // the page re-renders (or mounts) before its actions are looked up
      // ponytail: polls for the page to mount and register; 5 s ceiling, an event per registration if it's ever too slow
      let id: string | undefined
      for (let i = 0; i < 100 && !(id = lastRegistered(b.actions, actions)); i++) await new Promise(r => setTimeout(r, 50))
      if (!id) throw new Error("This page didn't offer the step's action. Open it and try again.")
      await actions.get(id)!()
    } catch (e) {
      setFail(failure(e))
    } finally {
      setBusy(false)
    }
  }, [actions, env, fields, go, isDone, navigate])

  const back = useCallback(() => {
    const { active } = latest.current
    if (!active || active.index === 0) return
    const prev = active.w.steps[active.index - 1]!
    go(active.index - 1)
    navigate(binding(prev, active.w).path(active.run))
  }, [go, navigate])

  const restart = useCallback((nw?: Walkthrough) => {
    const target = nw ?? latest.current.active?.w
    if (!target) return
    const run = newRun(target)
    reset()
    setActiveId(target.id)
    setActive({ w: target, run, index: 0 })
    navigate(binding(target.steps[0]!, target).path(run))
  }, [navigate, reset])

  const exit = useCallback(() => { setActiveId(undefined); setActive(undefined); setAutoDelay(null); reset() }, [reset])
  const setLayout = useCallback((l: Layout) => { write(LAYOUT, l); setLayoutState(l) }, [])
  const setFocus = useCallback((f: boolean) => { write(FOCUS, f ? '1' : '0'); setFocusState(f) }, [])

  const value = useMemo<Wizard>(() => ({
    w, run, index: index ?? 0, step, b, isDone, results: status.run === run ? status.results : {},
    // the step's own failure first, then why its values can't be worked out, then why done/checks couldn't be read
    error: fail?.message ?? initialError ?? (status.run === run && step ? status.errors[step.id] : undefined), fix: fail?.fix, busy, reused,
    start, restart, exit, next, back, layout, setLayout, focus, setFocus,
    actions, values: fields.values, filled: fields.filled, refill, bump, report,
    initial: (id: string) => (step && run?.steps[step.id]?.inputs[id]) ?? initials[id],
  }), [w, run, index, status, fail, initialError, busy, reused, layout, focus, version, refill, initials]) // eslint-disable-line react-hooks/exhaustive-deps

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

/**
 * Binds a page field to the current step: on arrival at a step that lists `id`, sets the actual (else initial)
 * value once; afterwards the page's value is read back as the step's input. Call it in the component that owns
 * the state: the value is set during render so it shows on the first paint.
 */
export function useWizardField(id: string, value: string, set: (v: string) => void) {
  const c = useContext(Ctx)
  const key = c?.step && c.run && c.b!.fields.includes(id) ? `${c.run.started}\0${c.step.id}` : undefined
  const [filled, setFilled] = useState<string>()
  const [refilled, setRefilled] = useState<number>()
  if (!c || !key) return
  const fill = () => { const v = c.initial(id); if (v !== undefined) { c.filled[id] = v; set(v) } }
  if (filled !== key) {
    setFilled(key)
    setRefilled(c.refill)
    fill()
  } else if (refilled !== c.refill) {
    setRefilled(c.refill)
    if (value === '') fill() // only what the switch emptied; the user's edits stay
  }
  c.values[id] = value
}

/** Registers what Next presses for `id`; pass `undefined` while the control isn't offered (e.g. its dialog is closed). */
export function useWizardAction(id: string, fn: Press | undefined) {
  const c = useContext(Ctx)
  const ref = useRef(fn)
  ref.current = fn
  const press = useCallback(() => ref.current?.(), [])
  const on = !!c?.w && !!fn
  if (on) c!.actions.set(id, press) // during render too, so the first paint (and SSR) knows what pulses
  const actions = c?.actions, bump = c?.bump
  useLayoutEffect(() => {
    if (!on || !actions) return
    actions.set(id, press)
    bump!()
    return () => { if (actions.get(id) === press) actions.delete(id); bump!() }
  }, [on, id, actions, bump, press])
}

/** The actual address of the asset the current step's `amount` names ("1000 $GBP" → GBP's), e.g. which token an approve step is for. */
export function useWizardAmountAsset(): string | undefined {
  const c = useContext(Ctx)
  const ref = /\$\w+/.exec(String(c?.step?.args?.amount ?? ''))?.[0]
  return ref && c?.run ? addressOf(c.run, ref) : undefined
}

const noop = () => {}
/** `report(id, outputs)` when the page's action completes; does nothing unless `id` is the current step's. */
export const useWizardReport = (): ((id: string, outputs: Outputs[StepType]) => void) => useContext(Ctx)?.report ?? noop

export type Mark = { 'data-wizard': string; 'data-wz-on'?: ''; 'data-wz-pulse'?: '' }
/** Props for a marked control or area: `data-wz-on` in the current step's areas, `data-wz-pulse` on what Next presses now. */
export function useWizardMark(): (id: string) => Mark {
  const c = useContext(Ctx)
  return (id: string) => {
    const m: Mark = { 'data-wizard': id }
    if (!c?.step || !c.b) return m
    if (c.b.areas.includes(id)) m['data-wz-on'] = ''
    if (!c.isDone(c.step) && lastRegistered(c.b.actions, c.actions) === id) m['data-wz-pulse'] = ''
    return m
  }
}
