const AUTOMATION_SWEEP_INTERVAL = 60_000

export default defineNitroPlugin(() => {
  let running = false
  setInterval(async () => {
    if (running) return
    running = true
    try {
      await runAutomationSweep()
    } catch (error) {
      console.error('[automation] sweep failed', error)
    } finally {
      running = false
    }
  }, AUTOMATION_SWEEP_INTERVAL).unref()
})
