import { useMemo } from 'react'
import { encode } from 'uqr'

const QUIET = 4 // modules of quiet zone, per the QR spec

/** `value` as an SVG QR code, dark on light in every theme (theme-invariant qr tokens) with a quiet zone. */
export function QrCode({ value, className = 'size-48' }: { value: string; className?: string }) {
  const { data, size } = useMemo(() => encode(value, { border: 0 }), [value])
  const d = useMemo(() => data.flatMap((row, y) => row.map((on, x) => (on ? `M${x + QUIET} ${y + QUIET}h1v1h-1z` : ''))).join(''), [data])
  const n = size + 2 * QUIET
  return (
    <svg role="img" aria-label="QR code of the join link" viewBox={`0 0 ${n} ${n}`} shapeRendering="crispEdges" className={`rounded bg-qr-bg ${className}`}>
      <rect width={n} height={n} className="fill-qr-bg" />
      <path d={d} className="fill-qr-fg" />
    </svg>
  )
}
