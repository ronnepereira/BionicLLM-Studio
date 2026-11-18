import type { ReactNode } from 'react'
import { ChevronDown } from 'lucide-react'

export function ConnectorSection({ title, status, children, testId }: {
  title: ReactNode
  status?: ReactNode
  children: ReactNode
  testId?: string
}) {
  // Native disclosure keeps forms mounted and receivers independent of visibility.
  return <details data-testid={testId} className="group/connector rounded-xl border border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-white/[0.02]">
    <summary className="flex cursor-pointer list-none items-center gap-3 rounded-xl p-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lu-accent [&::-webkit-details-marker]:hidden">
      <h3 className="flex min-w-0 flex-1 flex-wrap items-center gap-2 font-medium">{title}</h3>
      {status && <span role="status" className="max-w-[40%] text-right text-xs text-gray-500 break-words">{status}</span>}
      <ChevronDown size={17} aria-hidden="true" className="shrink-0 text-gray-500 group-open/connector:rotate-180" />
    </summary>
    <div className="space-y-4 border-t border-gray-200 dark:border-white/10 p-4">{children}</div>
  </details>
}
