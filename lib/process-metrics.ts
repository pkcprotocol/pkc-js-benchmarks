import fs from 'node:fs'
import v8 from 'node:v8'
import vm from 'node:vm'
import {monitorEventLoopDelay, performance, PerformanceObserver} from 'node:perf_hooks'
import type {ProcessMetrics} from '../types.ts'

// Process-health sampler for a node process: memory, CPU, event loop and GC, plus the RSS of any
// kubo daemons the process drives. Cheap enough to run around every cell (perf_hooks histograms
// and a 250ms /proc poll); the timings a cell reports are not affected in any measurable way.
//
// node only — the browser half lives in lib/runtime-metrics.ts.

const MB = 1024 * 1024
const round = (n: number, digits = 2): number => Number(n.toFixed(digits))

// `gc()` without having to start node with --expose-gc
let gcFunction: (() => void) | undefined
const forceGc = (): boolean => {
  try {
    if (!gcFunction) {
      v8.setFlagsFromString('--expose_gc')
      gcFunction = vm.runInNewContext('gc') as () => void
    }
    gcFunction()
    return true
  } catch (e) {
    return false
  }
}

const openFdsCount = (): number | null => {
  try {
    return fs.readdirSync('/proc/self/fd').length
  } catch (e) {
    return null // not linux
  }
}

export const readRssMB = (pid: number): number | null => {
  try {
    const status = fs.readFileSync(`/proc/${pid}/status`, 'utf-8')
    const kb = Number(status.match(/^VmRSS:\s+(\d+)\s+kB/m)?.[1])
    return Number.isFinite(kb) ? round(kb / 1024) : null
  } catch (e) {
    return null // exited, or not linux
  }
}

export interface ProcessMetricsSampler {
  stop: () => ProcessMetrics
}

export const startProcessMetrics = ({kuboPids = {}, intervalMs = 250}: {kuboPids?: Record<string, number | undefined>; intervalMs?: number} = {}): ProcessMetricsSampler => {
  const cpuStart = process.cpuUsage()
  const eluStart = performance.eventLoopUtilization()
  const delay = monitorEventLoopDelay({resolution: 10})
  delay.enable()

  let gcCount = 0
  let gcPauseTotalMs = 0
  let gcPauseMaxMs = 0
  let gcObserver: PerformanceObserver | undefined
  try {
    gcObserver = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        gcCount++
        gcPauseTotalMs += entry.duration
        gcPauseMaxMs = Math.max(gcPauseMaxMs, entry.duration)
      }
    })
    gcObserver.observe({entryTypes: ['gc']})
  } catch (e) {
    gcObserver = undefined
  }

  let peakRss = 0
  let peakHeapUsed = 0
  let peakFds: number | null = null
  const kuboPeakRss: Record<string, number | null> = {}
  const sample = () => {
    const memory = process.memoryUsage()
    peakRss = Math.max(peakRss, memory.rss)
    peakHeapUsed = Math.max(peakHeapUsed, memory.heapUsed)
    const fds = openFdsCount()
    if (fds !== null) peakFds = Math.max(peakFds ?? 0, fds)
    for (const [name, pid] of Object.entries(kuboPids)) {
      if (!pid) continue
      const rss = readRssMB(pid)
      if (rss !== null) kuboPeakRss[name] = Math.max(kuboPeakRss[name] ?? 0, rss)
      else if (!(name in kuboPeakRss)) kuboPeakRss[name] = null
    }
  }
  sample()
  const timer = setInterval(sample, intervalMs)
  timer.unref?.()

  const stop = (): ProcessMetrics => {
    clearInterval(timer)
    sample()
    delay.disable()
    gcObserver?.disconnect()
    const cpu = process.cpuUsage(cpuStart)
    const elu = performance.eventLoopUtilization(eluStart)
    const heapUsedAfterGc = forceGc() ? process.memoryUsage().heapUsed : null
    const metrics: ProcessMetrics = {
      peakRssMB: round(peakRss / MB),
      peakHeapUsedMB: round(peakHeapUsed / MB),
      heapUsedAfterGcMB: heapUsedAfterGc === null ? null : round(heapUsedAfterGc / MB),
      cpuUserMs: round(cpu.user / 1000, 1),
      cpuSystemMs: round(cpu.system / 1000, 1),
      eventLoopUtilizationPercent: round(elu.utilization * 100, 1),
      // the histogram is in nanoseconds; with no samples (a cell shorter than its resolution) it
      // reports NaN/huge sentinels, which are not a measurement
      eventLoopDelayP99Ms: delay.count ? round(delay.percentile(99) / 1e6) : null,
      eventLoopDelayMaxMs: delay.count ? round(delay.max / 1e6) : null,
      gcPauseTotalMs: gcObserver ? round(gcPauseTotalMs, 1) : null,
      gcPauseMaxMs: gcObserver ? round(gcPauseMaxMs, 1) : null,
      gcCount: gcObserver ? gcCount : null,
      peakOpenFdsCount: peakFds,
    }
    if (Object.keys(kuboPeakRss).length) metrics.kuboPeakRssMBByNode = kuboPeakRss
    return metrics
  }
  return {stop}
}
