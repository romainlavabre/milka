// Last response of each request tab, and sending.
import { create } from 'zustand'
import type { HttpRequest } from '@core/model'
import type { ExecutionResult } from '@core/results'
import { api, errorMessage } from '../../lib/bridge'

interface ResponseState {
  result: ExecutionResult | null
  running: boolean
  requestId: string | null
}

export const useResponses = create<Record<string, ResponseState>>(() => ({}))

export function useResponse(tabId: string): ResponseState {
  return useResponses((s) => s[tabId]) ?? { result: null, running: false, requestId: null }
}

export async function sendRequest(args: { tabId: string; collection: string; path: string; request: HttpRequest; env: string | null }): Promise<void> {
  const requestId = crypto.randomUUID()
  useResponses.setState((s) => ({ [args.tabId]: { result: s[args.tabId]?.result ?? null, running: true, requestId } }))
  let result: ExecutionResult
  try {
    result = await api.http.send({ requestId, collection: args.collection, path: args.path, request: args.request, env: args.env })
  } catch (error) {
    result = { name: args.request.name, path: args.path, request: null, response: null, error: errorMessage(error), skipped: null, logs: [], tests: [], durationMs: 0 }
  }
  // Ignore the answer of a request cancelled or replaced in the meantime.
  if (useResponses.getState()[args.tabId]?.requestId !== requestId) return
  useResponses.setState({ [args.tabId]: { result, running: false, requestId: null } })
}

export function cancelRequest(tabId: string): void {
  const state = useResponses.getState()[tabId]
  if (!state?.requestId) return
  void api.http.cancel({ requestId: state.requestId })
}
