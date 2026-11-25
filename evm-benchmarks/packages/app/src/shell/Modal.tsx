import type { ReactNode } from 'react'
import { C, ICONS, R, S, SHADOW } from '../theme'

/** The prototype's MODALS frame: title, intro, body, error, Cancel + confirm. Enter submits. */
export function Modal(p: {
  title: string; intro: string; error?: string; children?: ReactNode
  cancelLabel?: string; confirmLabel: string; canConfirm: boolean; onConfirm(): void; onClose(): void
  /** false: Close and Cancel are disabled (e.g. while a request is in flight) */
  canClose?: boolean
}) {
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 50, background: 'rgba(16,24,40,.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px 16px', overflowY: 'auto' }}>
      <form
        role="dialog" aria-modal="true" aria-labelledby="modal-title"
        onSubmit={(e) => { e.preventDefault(); if (p.canConfirm) p.onConfirm() }}
        style={{ width: '100%', maxWidth: 560, background: '#FFFFFF', borderRadius: R.modal, boxShadow: SHADOW.modal, display: 'flex', flexDirection: 'column', margin: 'auto' }}
      >
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: '22px 24px 0' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1 }}>
            <h2 id="modal-title" style={{ margin: 0, fontSize: 20, fontWeight: 600 }}>{p.title}</h2>
            <p style={{ margin: 0, fontSize: 14, lineHeight: 1.5, color: C.muted }}>{p.intro}</p>
          </div>
          <button type="button" onClick={p.onClose} disabled={p.canClose === false} aria-label="Close" className="hov" style={{ flex: 'none', width: 40, height: 40, border: 0, borderRadius: R.md, background: 'transparent', display: 'grid', placeItems: 'center', cursor: 'pointer' }}>
            <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={C.muted} strokeWidth="2" strokeLinecap="round"><path d={ICONS.close} /></svg>
          </button>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18, padding: '20px 24px 24px' }}>
          {p.children}
          {p.error && (
            <p role="alert" style={{ margin: 0, padding: '10px 12px', borderRadius: R.md, background: C.errorBg, border: `1px solid ${C.errorBorder}`, fontSize: 13, color: C.error }}>{p.error}</p>
          )}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, flexWrap: 'wrap' }}>
            <button type="button" onClick={p.onClose} disabled={p.canClose === false} className="hov" style={S.secondary(p.canClose !== false)}>{p.cancelLabel ?? 'Cancel'}</button>
            <button type="submit" disabled={!p.canConfirm} style={S.primary(p.canConfirm)}>{p.confirmLabel}</button>
          </div>
        </div>
      </form>
    </div>
  )
}
