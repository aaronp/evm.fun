import { Button } from './button'

export function Pager({ page, set, more }: { page: number; set(p: number): void; more: boolean }) {
  return (
    <div className="flex items-center justify-between gap-2 border-t border-line px-4 py-3 text-sm text-muted">
      <span>Page {page + 1}</span>
      <span className="flex gap-2">
        <Button variant="ghost" size="sm" disabled={page === 0} onClick={() => set(page - 1)}>Prev</Button>
        <Button variant="ghost" size="sm" disabled={!more} onClick={() => set(page + 1)}>Next</Button>
      </span>
    </div>
  )
}
