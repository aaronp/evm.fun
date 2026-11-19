import type { ButtonHTMLAttributes } from 'react'

const base =
  'inline-flex items-center justify-center rounded-md px-3 py-1.5 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 disabled:pointer-events-none disabled:opacity-50'
const variants = {
  default: 'bg-slate-900 text-white hover:bg-slate-700',
  outline: 'border border-slate-300 bg-white hover:bg-slate-100',
  destructive: 'bg-red-600 text-white hover:bg-red-500',
}

export function Button({
  variant = 'default',
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: keyof typeof variants }) {
  return <button className={`${base} ${variants[variant]} ${className}`} {...props} />
}
