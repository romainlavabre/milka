// Application shell.
import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/bridge'

export function App(): React.JSX.Element {
  const info = useQuery({ queryKey: ['app'], queryFn: () => api.app.info() })
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2">
      <h1 className="text-2xl font-semibold">Milka</h1>
      <p className="text-muted">{info.data ? `v${info.data.version}` : ' '}</p>
    </div>
  )
}
