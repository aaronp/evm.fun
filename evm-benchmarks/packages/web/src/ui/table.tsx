import type { HTMLAttributes } from 'react'

export function Table({ className = '', ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={`overflow-x-auto ${className}`} {...props} />
}

/** Shared header and cell padding for tables. */
export const th = 'px-4 py-2.5 text-left text-xs font-medium text-text-2'
export const td = 'px-4 py-3'
