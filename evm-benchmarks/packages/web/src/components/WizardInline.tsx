import { Button } from '../ui/button'
import { useWizard } from '../walkthrough/wizard'
import type { StepType } from '../walkthrough/types'

/** The current step's text and Next inside a modal dialog of that step (the page and ribbon behind it are inert).
 *  `data-wz-ribbon` keeps focus mode from dimming it: the dialog sits under `main`, beside its marked inputs. */
export function WizardInline({ step }: { step: StepType }) {
  const c = useWizard()
  if (!c?.step || c.step.do !== step) return null
  return (
    <div data-wz-ribbon="" className="mb-4 space-y-2 rounded-lg border border-accent bg-accent-soft p-3 text-sm">
      <p className="font-semibold text-text">{c.step.title}</p>
      <p className="text-text-2">{c.step.text}</p>
      {c.error && <p role="alert" className="text-danger">{c.error}</p>}
      <div className="flex justify-end">
        <Button type="button" size="sm" disabled={c.busy} onClick={() => void c.next()}>Next</Button>
      </div>
    </div>
  )
}
