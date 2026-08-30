import { describe, expect, it } from 'vitest'
import { widgetCustomizationSchema } from '../server/utils/validators'

describe('widget customization validation', () => {
  it('accepts a complete safe customization payload', () => {
    const result = widgetCustomizationSchema.safeParse({
      widgetPrimaryColor: '#0ea5e9',
      widgetGreeting: 'Welcome to Acme support',
      widgetIntro: 'Ask us anything about your account.',
      widgetOfflineMessage: 'We are away, but we will reply tomorrow.',
      widgetPosition: 'left',
      widgetSize: 'large',
      widgetTheme: 'dark',
      widgetShowBranding: false
    })

    expect(result.success).toBe(true)
  })

  it('rejects invalid presentation values and blank copy', () => {
    expect(widgetCustomizationSchema.safeParse({ widgetPosition: 'center' }).success).toBe(false)
    expect(widgetCustomizationSchema.safeParse({ widgetSize: 'fullscreen' }).success).toBe(false)
    expect(widgetCustomizationSchema.safeParse({ widgetTheme: 'sepia' }).success).toBe(false)
    expect(widgetCustomizationSchema.safeParse({ widgetGreeting: '   ' }).success).toBe(false)
    expect(widgetCustomizationSchema.safeParse({ widgetPrimaryColor: 'red' }).success).toBe(false)
  })

  it('trims visitor-facing copy before persistence', () => {
    const result = widgetCustomizationSchema.parse({ widgetGreeting: '  Hello there  ' })
    expect(result.widgetGreeting).toBe('Hello there')
  })
})
