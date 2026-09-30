// Cookies received during the session: the jar the requests of the workspace share.
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Cookie, Trash2 } from 'lucide-react'
import { useState } from 'react'
import type { CookieInfo } from '@core/results'
import { api, errorMessage } from '../../lib/bridge'
import { toast } from '../../components/feedback'
import { Button, Dialog, EmptyState, IconButton } from '../../components/ui'

function expiry(cookie: CookieInfo): string {
  return cookie.expires ? new Date(cookie.expires).toLocaleString() : 'Session'
}

/** Opens the cookies of the workspace, from the request bar or the sidebar. */
export function CookiesButton({ className }: { className?: string }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <IconButton label="Cookies" className={className} onClick={() => setOpen(true)}>
        <Cookie className="size-4" />
      </IconButton>
      <Dialog open={open} onOpenChange={setOpen} title="Cookies" width={760}>
        {open && <CookiesList />}
      </Dialog>
    </>
  )
}

function CookiesList() {
  const queryClient = useQueryClient()
  const { data: cookies } = useQuery({ queryKey: ['cookies'], queryFn: () => api.http.cookies(), staleTime: 0 })

  const run = async (action: () => Promise<void>): Promise<void> => {
    try {
      await action()
      await queryClient.invalidateQueries({ queryKey: ['cookies'] })
    } catch (error) {
      toast(errorMessage(error), 'error')
    }
  }

  if (!cookies) return null
  if (cookies.length === 0)
    return (
      <EmptyState icon={<Cookie className="size-8" />} title="No cookie">
        <p className="max-w-sm text-xs">
          Cookies set by the responses are kept here and sent back to the requests they match, until Milka quits. Scripts reach them with{' '}
          <code>milka.cookies</code>.
        </p>
      </EmptyState>
    )

  const domains = [...new Set(cookies.map((c) => c.domain))]
  return (
    <div className="flex min-h-0 flex-col gap-3 p-4">
      <p className="text-[11px] text-muted">
        Sent back to the requests they match until Milka quits; never saved in the workspace. Scripts reach them with{' '}
        <code>milka.cookies</code>.
      </p>
      <div className="selectable min-h-0 overflow-auto rounded-md border border-border">
        <table className="w-full table-fixed border-collapse text-xs">
          <thead>
            <tr className="border-b border-border text-left text-[11px] text-muted">
              <th className="w-36 px-2 py-1.5 font-medium">Name</th>
              <th className="px-2 py-1.5 font-medium">Value</th>
              <th className="w-24 px-2 py-1.5 font-medium">Path</th>
              <th className="w-40 px-2 py-1.5 font-medium">Expires</th>
              <th className="w-8" />
            </tr>
          </thead>
          {domains.map((domain) => (
            <tbody key={domain}>
              <tr className="bg-panel-2">
                <td colSpan={5} className="px-2 py-1 font-mono text-[11px] font-semibold">
                  {domain}
                </td>
              </tr>
              {cookies
                .filter((c) => c.domain === domain)
                .map((cookie) => (
                  <tr key={`${cookie.path}\n${cookie.name}`} className="group border-t border-border">
                    <td className="truncate px-2 py-1.5 font-mono" title={cookie.name}>
                      {cookie.name}
                    </td>
                    <td className="truncate px-2 py-1.5 font-mono text-muted" title={cookie.value}>
                      {cookie.value}
                    </td>
                    <td className="truncate px-2 py-1.5 font-mono">{cookie.path}</td>
                    <td
                      className="truncate px-2 py-1.5"
                      title={[cookie.secure && 'Secure', cookie.httpOnly && 'HttpOnly'].filter(Boolean).join(', ')}
                    >
                      {expiry(cookie)}
                    </td>
                    <td className="text-center">
                      <IconButton
                        label="Delete"
                        className="size-6 opacity-0 group-hover:opacity-100"
                        onClick={() =>
                          void run(() => api.http.deleteCookie({ domain: cookie.domain, path: cookie.path, name: cookie.name }))
                        }
                      >
                        <Trash2 className="size-3.5" />
                      </IconButton>
                    </td>
                  </tr>
                ))}
            </tbody>
          ))}
        </table>
      </div>
      <div className="flex justify-end">
        <Button size="sm" icon={<Trash2 className="size-3.5" />} onClick={() => void run(() => api.http.clearCookies())}>
          Clear all
        </Button>
      </div>
    </div>
  )
}
