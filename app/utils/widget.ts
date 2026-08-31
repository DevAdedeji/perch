/** The visitor-facing widget settings an admin can change without touching the embed code. */
export interface WidgetAppearance {
  widgetPrimaryColor: string
  widgetGreeting: string
  widgetIntro: string
  widgetOfflineMessage: string
  widgetPosition: 'left' | 'right'
  widgetSize: 'compact' | 'standard' | 'large'
  widgetTheme: 'light' | 'dark' | 'system'
  widgetShowBranding: boolean
}

export function widgetAppearanceDefaults(): WidgetAppearance {
  return {
    widgetPrimaryColor: '#f59e0b',
    widgetGreeting: 'Hi there 👋',
    widgetIntro: 'Tell us a bit about you and how we can help.',
    widgetOfflineMessage: 'We’re away right now, but leave a message and we’ll get back to you.',
    widgetPosition: 'right',
    widgetSize: 'standard',
    widgetTheme: 'system',
    widgetShowBranding: true
  }
}

/** Copy just the appearance fields off a fuller workspace record. */
export function pickWidgetAppearance(source: WidgetAppearance): WidgetAppearance {
  return {
    widgetPrimaryColor: source.widgetPrimaryColor,
    widgetGreeting: source.widgetGreeting,
    widgetIntro: source.widgetIntro,
    widgetOfflineMessage: source.widgetOfflineMessage,
    widgetPosition: source.widgetPosition,
    widgetSize: source.widgetSize,
    widgetTheme: source.widgetTheme,
    widgetShowBranding: source.widgetShowBranding
  }
}
