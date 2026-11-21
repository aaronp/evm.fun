import { Link } from 'react-router-dom'
import { FuseNext, useAutoUrl } from './FuseNext'
import { buttonClass } from '../ui/button'
import { useWizard } from '../walkthrough/wizard'
import type { StepType } from '../walkthrough/types'

/** The current step's text and Next inside a modal dialog of that step (the page and ribbon behind it are inert).
 *  `data-wz-ribbon` keeps focus mode from dimming it: the dialog sits under `main`, beside its marked inputs. */
export function WizardInline({ step }: { step: StepType }) {
  const c = useWizard()
  const autoUrl = useAutoUrl()
  if (!c?.step || c.step.do !== step) return null
  return (
    <div data-wz-ribbon="" className="mb-4 space-y-2 rounded-lg border-2 border-accent bg-accent-soft p-3 text-sm shadow-lg">
      <p className="font-semibold text-text"><span className="mr-2 inline-block rounded-full bg-accent px-2 py-0.5 text-[11px] font-semibold uppercase tracking-widest text-on-accent">Walkthrough</span>{c.step.title}</p>
      <p className="text-text-2">{c.step.text}</p>
      {c.error && <p role="alert" className="text-danger">{c.error}</p>}
      {c.error && c.fix && <Link to={c.fix.href} className={buttonClass('outline', 'chip')}>{c.fix.label}</Link>}
      <div className="flex justify-end">
        <FuseNext size="sm" step={c.step.id} busy={c.busy} error={c.error} disabled={c.busy} onNext={() => void c.next()} onPlay={autoUrl} />
      </div>
    </div>
  )
}
