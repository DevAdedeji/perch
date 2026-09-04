type BrowserNotificationState = NotificationPermission | 'unsupported' | 'insecure'

export function useBrowserNotifications() {
  const permission = useState<BrowserNotificationState>('notifications:browser-permission', () => 'unsupported')

  function refreshPermission() {
    if (!import.meta.client || !('Notification' in window)) {
      permission.value = 'unsupported'
      return
    }
    if (!window.isSecureContext) {
      permission.value = 'insecure'
      return
    }
    permission.value = Notification.permission
  }

  async function requestPermission() {
    refreshPermission()
    if (permission.value === 'unsupported' || permission.value === 'insecure') return permission.value
    if (permission.value !== 'default') return permission.value
    try {
      permission.value = await Notification.requestPermission()
    } catch {
      refreshPermission()
    }
    return permission.value
  }

  function show(options: { title: string, body: string, tag: string, onClick: () => void }) {
    refreshPermission()
    if (permission.value !== 'granted' || !document.hidden) return
    try {
      const notification = new Notification(options.title, {
        body: options.body,
        tag: options.tag,
        icon: '/favicon.svg'
      })
      notification.onclick = () => {
        notification.close()
        window.focus()
        options.onClick()
      }
    } catch {
      refreshPermission()
    }
  }

  if (import.meta.client) refreshPermission()

  return { permission, refreshPermission, requestPermission, show }
}
