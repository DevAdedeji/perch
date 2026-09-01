/** Cheap process-only probe for container orchestration; readiness lives at `/api/health`. */
export default defineEventHandler(() => ({ ok: true }))
