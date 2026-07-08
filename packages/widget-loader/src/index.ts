/**
 * Perch embed loader (`widget.js`). ~a few KB, no framework. Reads `data-site-id`
 * from its own <script> tag, draws a launcher bubble, and lazily injects a
 * sandboxed iframe pointing at `<origin>/widget`. Bridges unread + open/close
 * with the frame via postMessage.
 */
type WinFlag = Window & { __perchLoaded?: boolean }

const CHAT_ICON
  = '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7.9 20A9 9 0 1 0 4 16.1L2 22z"/></svg>'
const CLOSE_ICON
  = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18M6 6l12 12"/></svg>'

function init() {
  const w = window as WinFlag
  if (w.__perchLoaded) return

  const script = (document.currentScript as HTMLScriptElement | null)
    ?? (document.querySelector('script[data-site-id]') as HTMLScriptElement | null)
  const siteId = script?.getAttribute('data-site-id')
  if (!script || !siteId) return

  const origin = new URL(script.src).origin
  w.__perchLoaded = true

  const Z = 2147483000

  // ── frame styles (a stylesheet so we can size responsively) ──
  // Desktop/tablet: a floating 380×600 panel above the launcher.
  // Mobile (≤480px): an inset sheet — full width minus margins, with a top gap
  // and safe-area insets, so it never eats the entire screen height.
  const style = document.createElement('style')
  style.textContent = `
.perch-frame{position:fixed;bottom:88px;right:20px;width:380px;height:600px;max-width:calc(100vw - 40px);max-height:calc(100vh - 120px);border:none;border-radius:16px;box-shadow:0 12px 48px rgba(0,0,0,0.28);z-index:${Z};background:transparent}
@media (max-width:480px){.perch-frame{top:calc(env(safe-area-inset-top, 0px) + 16px);left:12px;right:12px;bottom:calc(env(safe-area-inset-bottom, 0px) + 16px);width:auto;height:auto;max-width:none;max-height:none;border-radius:18px}}
`
  document.head.appendChild(style)

  // ── launcher bubble ──
  const bubble = document.createElement('button')
  bubble.setAttribute('aria-label', 'Open chat')
  Object.assign(bubble.style, {
    position: 'fixed', bottom: '20px', right: '20px', width: '56px', height: '56px',
    borderRadius: '9999px', background: '#0f172a', color: '#fff', border: 'none',
    cursor: 'pointer', boxShadow: '0 8px 30px rgba(0,0,0,0.25)', zIndex: String(Z + 1),
    display: 'grid', placeItems: 'center', transition: 'transform .15s ease'
  })

  const icon = document.createElement('span')
  icon.style.display = 'grid'
  icon.style.placeItems = 'center'
  icon.innerHTML = CHAT_ICON
  bubble.appendChild(icon)

  const badge = document.createElement('span')
  Object.assign(badge.style, {
    position: 'absolute', top: '-2px', right: '-2px', minWidth: '20px', height: '20px',
    borderRadius: '9999px', background: '#ef4444', color: '#fff', fontSize: '11px',
    fontWeight: '700', display: 'none', alignItems: 'center', justifyContent: 'center',
    padding: '0 5px', boxSizing: 'border-box', fontFamily: 'system-ui, sans-serif'
  })
  bubble.appendChild(badge)
  bubble.addEventListener('mouseenter', () => (bubble.style.transform = 'scale(1.05)'))
  bubble.addEventListener('mouseleave', () => (bubble.style.transform = 'scale(1)'))

  // ── iframe panel (lazy) ──
  let iframe: HTMLIFrameElement | null = null
  let open = false

  function ensureIframe(): HTMLIFrameElement {
    if (iframe) return iframe
    const f = document.createElement('iframe')
    f.src = `${origin}/widget?site_id=${encodeURIComponent(siteId!)}`
    f.title = 'Chat'
    f.className = 'perch-frame'
    f.setAttribute('allow', 'clipboard-write')
    f.style.display = 'none'
    document.body.appendChild(f)
    iframe = f
    return f
  }

  function setOpen(next: boolean) {
    open = next
    const f = ensureIframe()
    f.style.display = next ? 'block' : 'none'
    icon.innerHTML = next ? CLOSE_ICON : CHAT_ICON
    if (next) badge.style.display = 'none'
    f.contentWindow?.postMessage({ source: 'perch-host', perch: next ? 'open' : 'close' }, '*')
  }

  bubble.addEventListener('click', () => setOpen(!open))

  window.addEventListener('message', (e: MessageEvent) => {
    const d = e.data
    if (!d || d.source !== 'perch-widget') return
    if (d.perch === 'unread') {
      const n = Number(d.count) || 0
      if (n > 0 && !open) {
        badge.textContent = n > 9 ? '9+' : String(n)
        badge.style.display = 'flex'
      } else {
        badge.style.display = 'none'
      }
    } else if (d.perch === 'close') {
      setOpen(false)
    }
  })

  document.body.appendChild(bubble)
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init)
} else {
  init()
}
