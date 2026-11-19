import type { HTMLAttributes } from 'react'

export function Table({ className = '', ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={`overflow-x-auto ${className}`} {...props} />
}
