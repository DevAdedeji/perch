const REMINDER_SWEEP_INTERVAL = 60_000

export default defineNitroPlugin(() => {
  if (import.meta.prerender) return
  let running = false
  const sweep = async () => {
    if (running) return
    running = true
    try {
      await runUnansweredReminderSweep()
    } catch (error) {
      console.error('[reminders] sweep failed', error)
    } finally {
      running = false
    }
  }
  setTimeout(sweep, 10_000).unref()
  setInterval(sweep, REMINDER_SWEEP_INTERVAL).unref()
})
