import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const dockerfile = readFileSync(new URL('../Dockerfile', import.meta.url), 'utf8')
const runtimeStage = dockerfile.split('FROM node:22-slim AS runner')[1] ?? ''

describe('production container', () => {
  it('runs migrations and the application as the unprivileged node user', () => {
    expect(runtimeStage).toContain('USER node')
    expect(runtimeStage.indexOf('USER node')).toBeLessThan(runtimeStage.indexOf('CMD ['))
    expect(runtimeStage.match(/COPY --chown=node:node/g)).toHaveLength(3)
  })
})
