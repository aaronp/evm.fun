import type { ButtonHTMLAttributes } from 'react'

const base =
  'inline-flex items-center justify-center transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:pointer-events-none disabled:text-disabled disabled:opacity-60'
const variants = {
  primary: 'rounded-lg bg-accent text-on-accent hover:bg-accent-hover',
  ghost: 'rounded-lg border border-line-strong bg-surface text-text hover:bg-surface-hover',
  outline: 'rounded-lg border border-input-line bg-surface text-text hover:bg-surface-hover',
  bar: 'rounded-[10px] border border-input-line bg-transparent text-text hover:bg-surface-hover',
  'danger-outline': 'rounded-[7px] border border-danger-line bg-transparent text-danger hover:bg-surface-hover',
  danger: 'rounded-lg border border-danger bg-danger-soft text-danger hover:bg-surface-hover',
}
const sizes = {
  sm: 'px-2.5 py-1 text-xs font-medium',
  md: 'px-3.5 py-2 text-sm font-medium',
  field: 'min-h-9 px-3 text-[13px] font-medium',
  chip: 'min-h-8 px-2.5 text-xs font-medium',
  bar: 'min-h-10 px-3.5 text-[13px] font-medium',
  barPrimary: 'min-h-10 gap-2 px-4 text-[13px] font-semibold',
}

/** Button classes for a non-button element (e.g. a link styled as a button). */
export const buttonClass = (variant: keyof typeof variants = 'primary', size: keyof typeof sizes = 'md') => `${base} ${variants[variant]} ${sizes[size]}`

export function Button({
  variant = 'primary',
  size = 'md',
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: keyof typeof variants; size?: keyof typeof sizes }) {
  return <button className={`${base} ${variants[variant]} ${sizes[size]} ${className}`} {...props} />
}
