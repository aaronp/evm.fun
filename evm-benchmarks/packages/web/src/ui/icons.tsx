import type { ReactNode, SVGProps } from 'react'

// Paths copied from design/project/*.dc.html (24x24, 2px stroke).
const icon = (paths: ReactNode) => (props: SVGProps<SVGSVGElement>) => (
  <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
    {paths}
  </svg>
)

export const AccountsIcon = icon(<><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></>)
export const ChainsIcon = icon(<><path d="m12 2 10 5-10 5L2 7z" /><path d="m2 17 10 5 10-5" /><path d="m2 12 10 5 10-5" /></>)
export const StudioIcon = icon(<><polyline points="16 18 22 12 16 6" /><polyline points="8 6 2 12 8 18" /></>)
export const TransactIcon = icon(<><path d="M22 2 11 13" /><path d="M22 2 15 22l-4-9-9-4z" /></>)
export const ExplorerIcon = icon(<><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></>)
export const BenchmarkIcon = icon(<polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />)
export const BrandIcon = icon(<><path d="M12 2 3 7v10l9 5 9-5V7z" /><path d="m3 7 9 5 9-5" /><path d="M12 12v10" /></>)
export const CopyIcon = icon(<><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></>)
export const ExternalIcon = icon(<><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" /><polyline points="15 3 21 3 21 9" /><path d="M10 14 21 3" /></>)
export const CheckIcon = icon(<polyline points="20 6 9 17 4 12" />)
export const AlertIcon = icon(<><circle cx="12" cy="12" r="10" /><path d="M12 8v4" /><path d="M12 16h.01" /></>)
export const MoonIcon = icon(<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />)
export const SunIcon = icon(<><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></>)
export const PaperIcon = icon(<><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" /><path d="M8 13h8M8 17h5" /></>)
