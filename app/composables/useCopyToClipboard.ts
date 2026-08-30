/**
 * Shared clipboard interaction with consistent success and failure feedback.
 * Returns whether the copy succeeded so callers can react when needed.
 */
export function useCopyToClipboard() {
  const toast = useToast()

  async function copy(text: string, successTitle = 'Copied'): Promise<boolean> {
    try {
      await navigator.clipboard.writeText(text)
      toast.add({ title: successTitle, icon: 'i-lucide-check', color: 'success' })
      return true
    } catch {
      toast.add({ title: 'Copy failed', color: 'error' })
      return false
    }
  }

  return { copy }
}
