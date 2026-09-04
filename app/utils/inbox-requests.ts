export class InboxRequests {
  private version = 0
  private disposed = false
  private requests = new Map<string, AbortController>()

  constructor(private identity: () => string | null) {}

  get active(): boolean {
    return !this.disposed
  }

  capture(): () => boolean {
    const version = this.version
    const identity = this.identity()
    return () => !this.disposed && identity !== null && identity === this.identity() && version === this.version
  }

  start(lane: string) {
    this.cancel(lane)
    const controller = new AbortController()
    this.requests.set(lane, controller)
    const current = this.capture()
    return {
      signal: controller.signal,
      current: () => current() && this.requests.get(lane) === controller && !controller.signal.aborted
    }
  }

  cancel(lane: string) {
    this.requests.get(lane)?.abort()
    this.requests.delete(lane)
  }

  invalidate() {
    this.version++
    for (const controller of this.requests.values()) controller.abort()
    this.requests.clear()
  }

  dispose() {
    this.invalidate()
    this.disposed = true
  }
}

const owners = new WeakMap<object, InboxRequests>()

export function claimInboxRequests(app: object, identity: () => string | null): InboxRequests {
  owners.get(app)?.dispose()
  const requests = new InboxRequests(identity)
  owners.set(app, requests)
  return requests
}
