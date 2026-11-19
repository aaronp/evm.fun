import type { HTMLAttributes } from 'react'

const variants = {
  neutral: 'bg-selected text-text-2',
  accent: 'bg-accent-soft text-accent',
  success: 'bg-success-soft text-success-text',
  warn: 'bg-warn-soft text-warn-text',
  danger: 'bg-danger-soft text-danger',
}

export function Badge({ variant = 'neutral', className = '', ...props }: HTMLAttributes<HTMLSpanElement> & { variant?: keyof typeof variants }) {
  return <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${variants[variant]} ${className}`} {...props} />
}
