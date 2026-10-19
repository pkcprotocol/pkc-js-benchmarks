import type {ProcessMetrics} from '../types.ts'

// Process-health sampler for the benchmark files, which run in node AND in chromium. In node it
// defers to lib/process-metrics.ts (loaded with a non-literal specifier so the browser bundle never
// sees its node: imports); in chromium it measures what a page can see about itself: JS heap
// (performance.memory), main-thread long tasks, and event-loop lag from timer drift.
//
// BROWSER-SAFE: no static node: imports.

export interface RuntimeMetricsSampler {
  stop: () => ProcessMetrics
}

const MB = 1024 * 1024
const round = (n: number, digits = 2): number => Number(n.toFixed(digits))

const isNode = typeof process !== 'undefined' && !!process.versions?.node && typeof window === 'undefined'

const startBrowserMetrics = (): RuntimeMetricsSampler => {
  const memory = () => (performance as unknown as {memory?: {usedJSHeapSize: number}}).memory?.usedJSHeapSize
  let peakHeap = memory() ?? 0
  let longTaskCount = 0
  let longTaskTotalMs = 0
  let observer: PerformanceObserver | undefined
  try {
    observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        longTaskCount++
        longTaskTotalMs += entry.duration
      }
    })
    observer.observe({type: 'longtask', buffered: false})
  } catch (e) {
    observer = undefined
  }
  // a 50ms timer that fires late by X ms means the event loop was blocked for about X ms
  const intervalMs = 50
  const lags: number[] = []
  let last = performance.now()
  const timer = setInterval(() => {
    const now = performance.now()
    lags.push(Math.max(0, now - last - intervalMs))
    last = now
    const heap = memory()
    if (heap) peakHeap = Math.max(peakHeap, heap)
  }, intervalMs)

  const stop = (): ProcessMetrics => {
    clearInterval(timer)
    observer?.disconnect()
    const sorted = [...lags].sort((a, b) => a - b)
    const p99 = sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.99))]! : null
    return {
      peakHeapUsedMB: peakHeap ? round(peakHeap / MB) : null,
      eventLoopDelayP99Ms: p99 === null ? null : round(p99),
      eventLoopDelayMaxMs: sorted.length ? round(sorted[sorted.length - 1]!) : null,
      longTaskTotalMs: observer ? round(longTaskTotalMs, 1) : null,
      longTaskCount: observer ? longTaskCount : null,
    }
  }
  return {stop}
}

export const startRuntimeMetrics = async (): Promise<RuntimeMetricsSampler> => {
  if (!isNode) return startBrowserMetrics()
  const specifier = './process-metrics.ts'
  const {startProcessMetrics} = (await import(/* @vite-ignore */ specifier)) as typeof import('./process-metrics.ts')
  return startProcessMetrics()
}
