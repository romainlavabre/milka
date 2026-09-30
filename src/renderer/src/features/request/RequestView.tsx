// Request editor (placeholder until the HTTP engine lands).
import { EmptyState } from '../../components/ui'

export function RequestView({ collection, path }: { collection: string; path: string }) {
  return <EmptyState title={path}>{collection}</EmptyState>
}
