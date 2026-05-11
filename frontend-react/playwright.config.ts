import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './tests',
  timeout: 20_000,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',

  webServer: {
    command: 'npm run dev',
    port: 5173,
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },

  use: {
    baseURL: 'http://localhost:5173',
    trace: 'on-first-retry',
  },

  projects: [
    {
      name: 'desktop',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      // Chromium at iPhone 14 viewport — tests mobile layout without needing WebKit
      name: 'mobile',
      use: {
        browserName: 'chromium',
        viewport:         { width: 390, height: 844 },
        deviceScaleFactor: 3,
        isMobile:          true,
        hasTouch:          true,
      },
    },
  ],
})
