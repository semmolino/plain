import { defineConfig } from '@playwright/test'
import base from './playwright.config'

/**
 * Neben-Config fuer die Pilot-Bilder (tests/pilot-screens.spec.ts).
 *
 * Zwei Unterschiede zur Haupt-Config, beide nur fuer lokale Aufnahmen:
 *  - PLAYWRIGHT_EXECUTABLE erlaubt einen vorhandenen Chromium, wenn der zur
 *    installierten @playwright/test-Version passende Build fehlt (z. B. in
 *    Sandkaesten ohne Download-Zugriff).
 *  - Nur die Bilder-Spec; CI laeuft weiter ueber playwright.config.ts.
 *
 * Aufruf:  PILOT_SCREENS=1 npx playwright test -c playwright.pilot.config.ts
 */
const executablePath = process.env.PLAYWRIGHT_EXECUTABLE || undefined

export default defineConfig({
  ...base,
  testMatch: /(pilot-screens|zz-[\w-]+)\.spec\.ts$/,
  timeout: 60_000,
  workers: 2,
  use: {
    ...base.use,
    // Deutsche Systemsprache fuer den Browser: `locale` allein reicht nicht,
    // Datumsfelder zeigten sonst „08/31/2026" statt „31.08.2026".
    launchOptions: {
      args: ['--lang=de-DE'],
      env: { ...process.env, LANG: 'de_DE.UTF-8', LANGUAGE: 'de' },
      ...(executablePath ? { executablePath } : {}),
    },
  },
})
