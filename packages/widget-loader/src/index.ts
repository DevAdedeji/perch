/**
 * Perch embed loader (`widget.js`). ~a few KB, no framework. Reads `data-site-id`
 * from its own <script> tag, draws a launcher bubble, and injects a sandboxed
 * iframe pointing at `<origin>/widget`. The frame is created eagerly (hidden)
 * so opening is instant and the bubble adopts the workspace's brand color
 * before first open. Bridges unread + open/close + theming via postMessage.
 */
interface Identity {
  user_id?: string
  name?: string
  email?: string
  // HMAC-SHA256 of user_id (or email), computed on the business's server
  hash?: string
}

interface PerchApi {
  identify: (traits: Identity) => void
  open: () => void
  close: () => void
}

type WinFlag = Window & {
  __perchLoaded?: boolean
  Perch?: PerchApi
  // set this before the loader runs to identify without waiting for it
  perchIdentity?: Identity
}

const CHAT_ICON
  = '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7.9 20A9 9 0 1 0 4 16.1L2 22z"/></svg>'
const CLOSE_ICON
  = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18M6 6l12 12"/></svg>'

const HEX = /^#[0-9a-f]{6}$/i

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

  // styles
  // Desktop/tablet: floating 380×600 panel that springs up from the launcher.
  // Mobile (≤480px): an inset sheet with a top gap + safe-area margins; the
  // launcher hides while open (the frame's own close button takes over).
  const style = document.createElement('style')
  style.textContent = `
.perch-bubble{position:fixed;bottom:calc(20px + env(safe-area-inset-bottom,0px));right:20px;width:56px;height:56px;border-radius:9999px;background:#0f172a;color:#fff;border:none;cursor:pointer;box-shadow:0 8px 30px rgba(0,0,0,.25);z-index:${Z + 1};display:grid;place-items:center;transition:transform .18s ease,opacity .18s ease,background-color .35s ease,color .35s ease}
.perch-bubble:hover{transform:scale(1.06)}
.perch-bubble:active{transform:scale(.94)}
.perch-icon{display:grid;place-items:center;transition:transform .16s ease,opacity .16s ease}
.perch-badge{position:absolute;top:-2px;right:-2px;min-width:20px;height:20px;border-radius:9999px;background:#ef4444;color:#fff;font-size:11px;font-weight:700;display:none;align-items:center;justify-content:center;padding:0 5px;box-sizing:border-box;font-family:system-ui,sans-serif;animation:perch-pop .3s cubic-bezier(.34,1.56,.64,1)}
@keyframes perch-pop{from{transform:scale(.3)}to{transform:scale(1)}}
.perch-frame{position:fixed;bottom:calc(88px + env(safe-area-inset-bottom,0px));right:20px;width:380px;height:min(600px,calc(100vh - 120px));max-width:calc(100vw - 40px);border:none;border-radius:16px;box-shadow:0 12px 48px rgba(0,0,0,.28);z-index:${Z};background:transparent;color-scheme:normal;opacity:0;visibility:hidden;pointer-events:none;transform:translateY(16px) scale(.96);transform-origin:bottom right;transition:opacity .2s ease,transform .3s cubic-bezier(.32,.72,.33,1),visibility 0s linear .3s}
.perch-frame.perch-open{opacity:1;visibility:visible;pointer-events:auto;transform:none;transition:opacity .2s ease,transform .3s cubic-bezier(.32,.72,.33,1)}
@media (max-width:480px){
.perch-frame{top:calc(env(safe-area-inset-top,0px) + 16px);left:12px;right:auto;bottom:auto;width:calc(100vw - 24px);height:calc(100vh - env(safe-area-inset-top,0px) - env(safe-area-inset-bottom,0px) - 28px);height:calc(100dvh - env(safe-area-inset-top,0px) - env(safe-area-inset-bottom,0px) - 28px);max-width:none;border-radius:18px;transform:translateY(28px) scale(.98)}
.perch-frame.perch-open{transform:none}
.perch-bubble.perch-hide{opacity:0;pointer-events:none;transform:scale(.5)}
}
@media (prefers-reduced-motion:reduce){.perch-bubble,.perch-icon,.perch-frame,.perch-frame.perch-open{transition:none}.perch-badge{animation:none}}
`
  document.head.appendChild(style)

  // launcher bubble
  const bubble = document.createElement('button')
  bubble.className = 'perch-bubble'
  bubble.setAttribute('aria-label', 'Open chat')

  const icon = document.createElement('span')
  icon.className = 'perch-icon'
  icon.innerHTML = CHAT_ICON
  bubble.appendChild(icon)

  const badge = document.createElement('span')
  badge.className = 'perch-badge'
  bubble.appendChild(badge)

  // iframe panel (created immediately, revealed on open)
  let iframe: HTMLIFrameElement | null = null
  let open = false

  function ensureIframe(): HTMLIFrameElement {
    if (iframe) return iframe
    const f = document.createElement('iframe')
    f.src = `${origin}/widget?site_id=${encodeURIComponent(siteId!)}`
    f.title = 'Chat'
    f.className = 'perch-frame'
    f.setAttribute('allow', 'clipboard-write')
    document.body.appendChild(f)
    iframe = f
    return f
  }

  function swapIcon(nextOpen: boolean) {
    icon.style.transform = 'scale(0) rotate(-90deg)'
    icon.style.opacity = '0'
    setTimeout(() => {
      icon.innerHTML = nextOpen ? CLOSE_ICON : CHAT_ICON
      icon.style.transform = 'none'
      icon.style.opacity = '1'
    }, 140)
  }

  function setOpen(next: boolean) {
    if (open === next) return
    open = next
    const f = ensureIframe()
    f.classList.toggle('perch-open', next)
    bubble.classList.toggle('perch-hide', next)
    if (next) badge.style.display = 'none'
    swapIcon(next)
    f.contentWindow?.postMessage({ source: 'perch-host', perch: next ? 'open' : 'close' }, '*')
  }

  bubble.addEventListener('click', () => setOpen(!open))

  // public API: window.Perch.identify({ name, email })
  // Lets the host site pass its signed-in user so the widget can skip the
  // pre-chat form. Resent on frame (re)mount so call order doesn't matter.
  let identity: Identity | null = null

  function sendIdentity() {
    if (identity) {
      iframe?.contentWindow?.postMessage({ source: 'perch-host', perch: 'identify', ...identity }, '*')
    }
  }

  // host page tracking
  // The iframe can't see SPA route changes (document.referrer is frozen at
  // load), so the loader reports location.href — on frame ready and on every
  // history change — for the live roster + proactive triggers.
  let lastPage = ''

  function sendPage() {
    if (location.href === lastPage) return
    lastPage = location.href
    iframe?.contentWindow?.postMessage({ source: 'perch-host', perch: 'page', url: location.href }, '*')
  }

  function trackNavigation() {
    const wrap = (method: 'pushState' | 'replaceState') => {
      const original = history[method].bind(history)
      history[method] = (...args: Parameters<History['pushState']>) => {
        original(...args)
        sendPage()
      }
    }
    wrap('pushState')
    wrap('replaceState')
    window.addEventListener('popstate', sendPage)
    window.addEventListener('hashchange', sendPage)
  }

  const api: PerchApi = {
    identify(traits) {
      if (!traits || typeof traits !== 'object') return
      const str = (v: unknown, max: number) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : undefined)
      const userId = str(traits.user_id, 128)
      const name = str(traits.name, 100)
      const email = str(traits.email, 200)
      const hash = str(traits.hash, 64)
      if (!userId && !name && !email) return
      identity = { user_id: userId, name, email, hash }
      sendIdentity()
    },
    open: () => setOpen(true),
    close: () => setOpen(false)
  }
  w.Perch = api
  if (w.perchIdentity) api.identify(w.perchIdentity)

  window.addEventListener('message', (e: MessageEvent) => {
    const d = e.data
    if (!d || d.source !== 'perch-widget') return
    if (d.perch === 'unread') {
      const n = Number(d.count) || 0
      if (n > 0 && !open) {
        badge.textContent = n > 9 ? '9+' : String(n)
        // retrigger the pop animation on every new count
        badge.style.animation = 'none'
        void badge.offsetHeight
        badge.style.animation = ''
        badge.style.display = 'flex'
      } else {
        badge.style.display = 'none'
      }
    } else if (d.perch === 'close') {
      setOpen(false)
    } else if (d.perch === 'open') {
      // the widget asked to open itself (proactive trigger fired)
      setOpen(true)
    } else if (d.perch === 'ready') {
      // frame (re)mounted — resync open state + identity + page in case a message was missed
      iframe?.contentWindow?.postMessage({ source: 'perch-host', perch: open ? 'open' : 'close' }, '*')
      sendIdentity()
      lastPage = ''
      sendPage()
    } else if (d.perch === 'config') {
      // adopt the workspace's brand color on the launcher
      if (typeof d.color === 'string' && HEX.test(d.color)) {
        bubble.style.background = d.color
        if (typeof d.fg === 'string' && HEX.test(d.fg)) bubble.style.color = d.fg
      }
    }
  })

  document.body.appendChild(bubble)
  ensureIframe()
  trackNavigation()
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init)
} else {
  init()
}
