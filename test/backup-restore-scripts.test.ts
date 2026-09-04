import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const backupPath = new URL('../scripts/backup.sh', import.meta.url)
const restorePath = new URL('../scripts/restore-verify.sh', import.meta.url)

describe('backup and restore safety scripts', () => {
  it('remain valid Bash programs', () => {
    for (const path of [backupPath, restorePath]) {
      const result = spawnSync('bash', ['-n', path.pathname], { encoding: 'utf8' })
      expect(result.stderr).toBe('')
      expect(result.status).toBe(0)
    }
  })

  it('creates an atomic checked archive instead of publishing a partial dump', () => {
    const source = readFileSync(backupPath, 'utf8')
    expect(source).toContain('mktemp')
    expect(source).toContain('pg_restore --list')
    expect(source).toContain('shasum -a 256')
    expect(source.indexOf('mv "$TMP_FILE" "$FILE"')).toBeGreaterThan(source.indexOf('pg_restore --list'))
  })

  it('refuses production-like or non-empty restore targets', () => {
    const source = readFileSync(restorePath, 'utf8')
    expect(source).toContain('RESTORE_CONFIRM=verify-fresh-database')
    expect(source).toContain('"$RESTORE_TARGET_URL" = "$NEON_CONNECTION_STRING"')
    expect(source).toContain('refusing to overwrite a database')
    expect(source).toContain('--single-transaction')
  })
})
