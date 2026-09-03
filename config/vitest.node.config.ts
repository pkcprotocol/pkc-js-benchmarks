import {defineConfig} from 'vitest/config'

const benchmarkOptionsName = process.env.BENCHMARK_OPTIONS_NAME || ''

export default defineConfig({
  test: {
    // reply-propagation samples an ipfs-gateway reader, which only learns about a new reply on
    // its next poll (pkc-js updateInterval, 60s by default), so a cell can legitimately run minutes
    testTimeout: 1200000,
    hookTimeout: 1200000,
    include: ['benchmark/**/*.ts'],
    environment: 'node',
    globals: false,
    env: {
      BENCHMARK_OPTIONS_NAME: benchmarkOptionsName,
    },
  },
})
