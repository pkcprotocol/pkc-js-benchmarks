import {defineConfig} from 'vitest/config'
import {playwright} from '@vitest/browser-playwright'

const benchmarkOptionsName = process.env.BENCHMARK_OPTIONS_NAME || ''
const file = process.env.BENCHMARK_FILE || ''

export default defineConfig({
  test: {
    testTimeout: 600000,
    hookTimeout: 600000,
    include: file ? [`benchmark/${file}`] : ['benchmark/**/*.ts'],
    browser: {
      enabled: true,
      provider: playwright({
        launchOptions: {
          args: ['--disable-web-security', '--no-sandbox'],
          // allow pointing at a system chromium when Playwright can't manage its own
          // (e.g. PLAYWRIGHT_CHROMIUM_PATH=/snap/bin/chromium)
          ...(process.env.PLAYWRIGHT_CHROMIUM_PATH ? {executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH} : {}),
        },
      }),
      headless: true,
      instances: [{browser: 'chromium'}],
    },
    globals: false,
  },
  define: {
    'window.benchmarkOptionsName': JSON.stringify(benchmarkOptionsName),
  },
})
