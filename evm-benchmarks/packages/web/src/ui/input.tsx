import type { InputHTMLAttributes, SelectHTMLAttributes } from 'react'

const field =
  'rounded-lg border border-input-line bg-bg px-2.5 py-1.5 text-sm text-text placeholder:text-subtle focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent'

export function Input({ className = '', ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={`${field} ${className}`} {...props} />
}
export function Select({ className = '', ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={`${field} ${className}`} {...props} />
}

/** Field label text (text-2) and its mono type hint (muted), shared by every form. */
export const fieldLabel = 'flex flex-col gap-1.5 text-sm text-text-2'
export const fieldHint = 'font-mono text-xs text-muted'
