import { execSync } from 'child_process'
import path from 'path'

const MOBILE_ROOT = path.resolve(__dirname, '..')

describe('Expo SDK compatibility', () => {
  it('all dependencies match versions required by the installed Expo SDK', () => {
    try {
      execSync('npx expo install --check', {
        cwd: MOBILE_ROOT,
        stdio: 'pipe',
        timeout: 30_000,
      })
    } catch (err: unknown) {
      const output =
        err instanceof Error && 'stdout' in err
          ? (err as Error & { stdout: Buffer }).stdout?.toString()
          : ''
      throw new Error(
        `Expo dependency version mismatch detected. Run "npx expo install --fix" in apps/mobile to auto-fix.\n\n${output}`,
        { cause: err },
      )
    }
  })
})
