// Environments of a collection (placeholder until environments land).
import { EmptyState } from '../../components/ui'

export function EnvironmentsPanel({ collection }: { collection: string }) {
  return <EmptyState title="Environments">{collection}</EmptyState>
}
