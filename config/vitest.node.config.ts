import {defineConfig} from 'vitest/config'

const benchmarkOptionsName = process.env.BENCHMARK_OPTIONS_NAME || ''

export default defineConfig({
  test: {
    testTimeout: 600000,
    hookTimeout: 600000,
    include: ['benchmark/**/*.ts'],
    environment: 'node',
    globals: false,
    env: {
      BENCHMARK_OPTIONS_NAME: benchmarkOptionsName,
    },
  },
})
