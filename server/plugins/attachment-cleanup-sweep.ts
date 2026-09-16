import { nextAttachmentCleanupAt, runAttachmentCleanupSweep } from '@@/server/domains/attachments/lifecycle'
import { cloudinaryConfig, cloudinaryUploadAvailable } from '@@/server/integrations/cloudinary'
import { safeErrorSummary } from '@@/server/utils/request-security'
import { startBackgroundSweep } from '@@/server/infrastructure/background-sweep'

export default defineNitroPlugin((app) => {
  if (import.meta.prerender || !cloudinaryUploadAvailable(cloudinaryConfig())) return
  const stop = startBackgroundSweep({
    intervalMs: 60_000,
    nextRunAt: nextAttachmentCleanupAt,
    initialDelayMs: 15_000,
    run: () => runAttachmentCleanupSweep(),
    onError: error => console.error('[attachments] sweep failed', safeErrorSummary(error))
  })
  app.hooks.hook('close', stop)
})
