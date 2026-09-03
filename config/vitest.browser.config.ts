import {defineConfig} from 'vitest/config'
import {playwright} from '@vitest/browser-playwright'

const benchmarkOptionsName = process.env.BENCHMARK_OPTIONS_NAME || ''
const file = process.env.BENCHMARK_FILE || ''

export default defineConfig({
  test: {
    // reply-propagation samples an ipfs-gateway reader, which only learns about a new reply on
    // its next poll (pkc-js updateInterval, 60s by default), so a cell can legitimately run minutes
    testTimeout: 1200000,
    hookTimeout: 1200000,
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
