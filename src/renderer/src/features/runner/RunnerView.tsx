// Collection runner (placeholder until the runner lands).
import { EmptyState } from '../../components/ui'

export function RunnerView({ collection, path }: { collection: string; path: string }) {
  return <EmptyState title={`Run ${path || collection}`}>Coming soon</EmptyState>
}
