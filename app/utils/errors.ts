/** Pull a human message out of a `$fetch` error (h3 createError shape). */
export function getErrorMessage(e: unknown, fallback = 'Something went wrong'): string {
  const err = e as {
    data?: { statusMessage?: string, message?: string }
    statusMessage?: string
    message?: string
  }
  return err?.data?.statusMessage || err?.data?.message || err?.statusMessage || err?.message || fallback
}
