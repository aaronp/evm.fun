import type { ButtonHTMLAttributes } from 'react'

const base =
  'inline-flex items-center justify-center rounded-lg font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:pointer-events-none disabled:text-disabled disabled:opacity-60'
const variants = {
  primary: 'bg-accent text-on-accent hover:bg-accent-hover',
  ghost: 'border border-line-strong bg-surface text-text hover:bg-surface-hover',
  outline: 'min-h-9 rounded-lg border border-input-line bg-surface px-3 text-[13px] text-text hover:bg-surface-hover',
  danger: 'border border-danger bg-danger-soft text-danger hover:bg-surface-hover',
}
const sizes = { sm: 'px-2.5 py-1 text-xs', md: 'px-3.5 py-2 text-sm' }

export function Button({
  variant = 'primary',
  size = 'md',
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: keyof typeof variants; size?: keyof typeof sizes }) {
  return <button className={`${base} ${variants[variant]} ${sizes[size]} ${className}`} {...props} />
}
