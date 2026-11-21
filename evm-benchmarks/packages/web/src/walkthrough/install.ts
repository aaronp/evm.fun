import { checks, done, newRun, perform, record, type Env } from './run'
import { saveRun } from './runs'
import type { Check, Run, Step, Walkthrough } from './types'

export type Installed = { run: Run; failed: { step: string; check: Check; actual: string }[] }

/** "Install" a walkthrough: perform every step from its JSON inputs, headless, on a fresh run (a new chain), as the
 *  `bun test` runner does. The run is saved after each step, so a failure part-way can be resumed in the ribbon.
 *  Throws `Step n (title): …` naming the step that failed or didn't complete. Each step's checks are evaluated right
 *  after it (they describe that moment, e.g. "the Swap holds 1,000 GBP" before the take), and failures returned. */
export async function install(w: Walkthrough, env: Env, onStep?: (index: number, step: Step) => void): Promise<Installed> {
  let run = newRun(w)
  const failed: Installed['failed'] = []
  await saveRun(run)
  for (const [i, step] of w.steps.entries()) {
    onStep?.(i, step)
    try {
      if (!(await done(w, step, env, run))) {
        run = record(w, run, step, await perform(w, step, env, run))
        await saveRun(run)
        if (!(await done(w, step, env, run))) throw new Error("it didn't complete (see its report)")
      }
      for (const r of await checks(w, step, env, run)) if (!r.pass) failed.push({ step: step.id, check: r.check, actual: r.actual })
    } catch (e) {
      throw new Error(`Step ${i + 1} (${step.title}): ${e instanceof Error ? e.message : String(e)}`)
    }
  }
  return { run, failed }
}
