import type { ReactNode } from 'react'

/** Card with a header strip (title left, optional badge right), as in the mockup's table cards. `inset` = page-bg body (Result panels). */
export function Panel({ title, badge, children, as: Tag = 'section', inset, 'aria-label': ariaLabel }: {
  title: string; badge?: ReactNode; children: ReactNode; as?: 'section' | 'aside'; inset?: boolean; 'aria-label'?: string
}) {
  return (
    <Tag aria-label={ariaLabel} className={`overflow-hidden rounded-xl border border-line-strong ${inset ? 'bg-bg' : 'bg-surface'} text-sm`}>
      <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
        <h2 className="min-w-0 break-all font-display text-sm font-semibold">{title}</h2>
        {badge}
      </div>
      {children}
    </Tag>
  )
}
