import {test} from 'vitest'
import {startRuntimeMetrics} from '../lib/runtime-metrics.ts'
import {exitProcess, getBenchmarkContext, writeReport} from '../lib/benchmark-client.ts'
import type {BenchmarkReport, ImportMetrics, ImportTimeBenchmarkOptions} from '../types.ts'

// What `import('@pkcprotocol/pkc-js')` costs before any pkc-js code has run. Import cost regressed
// silently more than once (it was then cut from ~535ms to ~120ms, and from ~2.0s to ~1.4s on a
// production host, in steps), so it is tracked per release like everything else.
//   node:   fresh processes, cold and warm compile cache, modules loaded, tarball size (lib/import-time.ts)
//   chrome: the first dynamic import() of the browser build in the page
// This file must not import pkc-js statically: that would load it before the measurement.

const benchmarkOptionsType = 'importTimeBenchmarkOptions'

test('benchmark', async () => {
  const {options, runtime, reportName} = await getBenchmarkContext<ImportTimeBenchmarkOptions>(benchmarkOptionsType)
  const runtimeMetrics = await startRuntimeMetrics()
  const beforeReportTimestamp = Date.now()

  let imports: ImportMetrics
  try {
    if (runtime === 'node') {
      const specifier = '../lib/import-time.ts'
      const {measureNodeImport} = (await import(/* @vite-ignore */ specifier)) as typeof import('../lib/import-time.ts')
      imports = await measureNodeImport(options.samples)
    } else {
      // only the first import in a page is cold; later ones hit the module map
      const before = performance.now()
      await import('@pkcprotocol/pkc-js')
      imports = {browserImportTimeSeconds: {first: Number(((performance.now() - before) / 1000).toFixed(3))}}
    }
  } catch (e) {
    imports = {error: {message: (e as Error).message}}
  }

  const report: BenchmarkReport = {
    name: reportName,
    type: benchmarkOptionsType,
    timestamp: Date.now(),
    timeSeconds: (Date.now() - beforeReportTimestamp) / 1000,
    runtime,
    imports,
    process: runtimeMetrics.stop(),
  }
  await writeReport(report)
  console.log(imports)
  exitProcess()
})
