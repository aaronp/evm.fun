import { useMemo } from 'react'
import { encode } from 'uqr'

const QUIET = 4 // modules of quiet zone, per the QR spec

/** `value` as an SVG QR code, dark on light in every theme (theme-invariant qr tokens) with a quiet zone. */
export function QrCode({ value, className = 'size-48' }: { value: string; className?: string }) {
  const qr = useMemo(() => { try { return encode(value, { border: 0 }) } catch { return undefined } }, [value]) // too long for a QR code
  const d = useMemo(() => qr?.data.flatMap((row, y) => row.map((on, x) => (on ? `M${x + QUIET} ${y + QUIET}h1v1h-1z` : ''))).join('') ?? '', [qr])
  if (!qr) return <p className="text-sm text-muted">Link too long for a QR code; copy the link instead.</p>
  const n = qr.size + 2 * QUIET
  return (
    <svg role="img" aria-label="QR code of the join link" viewBox={`0 0 ${n} ${n}`} shapeRendering="crispEdges" className={`rounded bg-qr-bg ${className}`}>
      <rect width={n} height={n} className="fill-qr-bg" />
      <path d={d} className="fill-qr-fg" />
    </svg>
  )
}
