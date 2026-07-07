/**
 * The current agent's own presence (online/away), shared across the dashboard
 * chrome. Toggling sends `presence.update` over the socket; the server broadcasts
 * the resulting `presence` event which updates everyone's rosters.
 */
export function usePresence() {
  const away = useState('presence:away', () => false)
  const rt = useRealtime()

  const status = computed<'online' | 'away' | 'offline'>(() =>
    rt.status.value === 'open' ? (away.value ? 'away' : 'online') : 'offline'
  )

  function setAway(value: boolean) {
    away.value = value
    rt.sendPresence(value ? 'away' : 'online')
  }

  return { away, status, setAway }
}
