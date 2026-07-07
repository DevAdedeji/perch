/**
 * Optional new-message chime (§3.4). Synthesized with the Web Audio API — no
 * asset file, CSP-safe. The on/off preference persists in localStorage.
 */
let ctx: AudioContext | null = null

export function useNotificationSound() {
  const enabled = useState('notif:sound', () => true)

  // hydrate the preference from localStorage on the client
  if (import.meta.client) {
    const stored = localStorage.getItem('perch:sound')
    if (stored !== null) enabled.value = stored === '1'
  }

  function toggle() {
    enabled.value = !enabled.value
    if (import.meta.client) localStorage.setItem('perch:sound', enabled.value ? '1' : '0')
  }

  function play() {
    if (!enabled.value || !import.meta.client) return
    try {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
      ctx ??= new AC()
      if (ctx.state === 'suspended') void ctx.resume()
      const now = ctx.currentTime
      // a soft two-note "ding" (A5 → D6)
      for (const [freq, at] of [[880, 0], [1174.66, 0.09]] as const) {
        const osc = ctx.createOscillator()
        const gain = ctx.createGain()
        osc.type = 'sine'
        osc.frequency.value = freq
        osc.connect(gain)
        gain.connect(ctx.destination)
        const start = now + at
        gain.gain.setValueAtTime(0.0001, start)
        gain.gain.exponentialRampToValueAtTime(0.16, start + 0.02)
        gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.3)
        osc.start(start)
        osc.stop(start + 0.32)
      }
    } catch {
      // audio blocked (no user gesture yet) — ignore
    }
  }

  return { enabled, toggle, play }
}
