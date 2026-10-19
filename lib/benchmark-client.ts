import type {BenchmarkOptionsType, BenchmarkReport, Runtime} from '../types.ts'

// What every benchmark file does before and after measuring: work out which cell it is (options
// name + runtime), fetch that cell's options from the benchmark server, and post its report back.
// Shared by the vitest benchmarks (node and chromium) and the script benchmarks (plain node).
//
// BROWSER-SAFE: no node: imports.

declare const window: {benchmarkOptionsName?: string; benchmarkProfiled?: string; benchmarkServerPort?: string} | undefined

const isBrowser = typeof window !== 'undefined' && !!window?.benchmarkOptionsName

const env = (name: string): string | undefined => (typeof process !== 'undefined' ? process.env?.[name] : undefined)

// BENCHMARK_SERVER_PORT moves the benchmark server off 3000 (for machines where 3000 is taken)
export const benchmarkServerUrl = `http://127.0.0.1:${(isBrowser ? window?.benchmarkServerPort : env('BENCHMARK_SERVER_PORT')) || '3000'}`

// start.ts --profile runs each profilable cell once more under the CPU profiler; that repetition
// reports under its own name so its (profiler-inflated) timings never mix with the real ones
export const isProfiledRun = (): boolean => (isBrowser ? window?.benchmarkProfiled === '1' : env('BENCHMARK_PROFILED') === '1')
export const profiledSuffix = ' (cpu profiled)'

export interface BenchmarkContext<T> {
  benchmarkOptionsName: string
  runtime: Runtime
  options: T
  // the report name: the options name, plus profiledSuffix on the profiled repetition
  reportName: string
}

export const getBenchmarkContext = async <T extends {name: string}>(benchmarkOptionsType: BenchmarkOptionsType): Promise<BenchmarkContext<T>> => {
  const runtime: Runtime = isBrowser ? 'chrome' : 'node'
  const benchmarkOptionsName = isBrowser ? window!.benchmarkOptionsName : env('BENCHMARK_OPTIONS_NAME')
  if (!benchmarkOptionsName) throw Error('missing benchmarkOptionsName')
  const options: T | null = await fetch(
    `${benchmarkServerUrl}/benchmark-options?benchmarkOptionsName=${encodeURIComponent(benchmarkOptionsName)}&benchmarkOptionsType=${benchmarkOptionsType}`,
  ).then((res) => res.json())
  if (!options) throw Error(`failed fetching benchmarkOptions '${benchmarkOptionsName}'`)
  return {
    benchmarkOptionsName,
    runtime,
    options,
    reportName: options.name + (isProfiledRun() ? profiledSuffix : ''),
  }
}

export const postToServer = async <T>(path: string, body?: unknown): Promise<T> => {
  const res = await fetch(`${benchmarkServerUrl}${path}`, {
    method: 'POST',
    body: JSON.stringify(body ?? {}),
    headers: {'Content-Type': 'application/json'},
  })
  const json = (await res.json()) as T & {error?: {message: string}}
  if (!res.ok || json?.error) throw Error(`${path} failed: ${json?.error?.message ?? res.status}`)
  return json
}

export const writeReport = async (report: BenchmarkReport): Promise<void> => {
  const res = await fetch(`${benchmarkServerUrl}/report`, {
    method: 'POST',
    body: JSON.stringify(report),
    headers: {'Content-Type': 'application/json'},
  })
  if (res.status !== 200) throw Error('failed writing report')
}

export const exitProcess = (): void => {
  try {
    process.exit()
  } catch (e) {
    // browser: no process to exit
  }
}

export const median = (values: number[]): number | null => {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  const value = sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2
  return Number(value.toFixed(3))
}

// nearest-rank percentile
export const percentile = (values: number[], p: number): number | null => {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b)
  return Number(sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)]!.toFixed(3))
}
