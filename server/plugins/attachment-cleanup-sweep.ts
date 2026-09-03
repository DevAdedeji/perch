import { cloudinaryConfig, cloudinaryUploadAvailable } from '../utils/cloudinary'
import { safeErrorSummary } from '../utils/request-security'

const ATTACHMENT_SWEEP_INTERVAL_MS = 60_000

export default defineNitroPlugin(() => {
  if (import.meta.prerender || !cloudinaryUploadAvailable(cloudinaryConfig())) return
  let running = false
  const sweep = async () => {
    if (running) return
    running = true
    try {
      await runAttachmentCleanupSweep()
    } catch (error) {
      console.error('[attachments] cleanup sweep failed', safeErrorSummary(error))
    } finally {
      running = false
    }
  }
  setTimeout(sweep, 15_000).unref()
  setInterval(sweep, ATTACHMENT_SWEEP_INTERVAL_MS).unref()
})
