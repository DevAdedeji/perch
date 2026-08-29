import type { MaybeRefOrGetter } from 'vue'

export interface ConversationSearchResult {
  id: string
  status: 'open' | 'unassigned' | 'resolved'
  assignedAgentId: string | null
  lastMessageAt: string
  snippet: string | null
  visitor: { id: string, name: string | null, email: string | null, visitorId: string }
}

/** Debounced workspace conversation search with stale-request cancellation. */
export function useConversationSearch(workspaceId: MaybeRefOrGetter<string | undefined>) {
  const query = ref('')
  const results = ref<ConversationSearchResult[]>([])
  const searching = ref(false)
  const active = computed(() => query.value.trim().length >= 2)

  let requestSequence = 0
  let controller: AbortController | undefined

  watch([query, () => toValue(workspaceId)], ([rawQuery, currentWorkspaceId], _, onCleanup) => {
    const sequence = ++requestSequence
    const normalizedQuery = rawQuery.trim()

    controller?.abort()
    controller = undefined

    if (normalizedQuery.length < 2 || !currentWorkspaceId) {
      results.value = []
      searching.value = false
      return
    }

    searching.value = true
    const timer = setTimeout(async () => {
      controller = new AbortController()
      try {
        const response = await $fetch<ConversationSearchResult[]>(
          `/api/workspaces/${currentWorkspaceId}/conversations/search`,
          { query: { q: normalizedQuery }, signal: controller.signal }
        )
        if (sequence === requestSequence) results.value = response
      } catch {
        if (sequence === requestSequence) results.value = []
      } finally {
        if (sequence === requestSequence) searching.value = false
      }
    }, 300)

    onCleanup(() => {
      clearTimeout(timer)
      controller?.abort()
    })
  })

  return { query, results, searching, active }
}
