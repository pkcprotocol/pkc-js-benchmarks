import {spawn, execFileSync} from 'node:child_process'
import fs from 'fs-extra'
import os from 'node:os'
import {fileURLToPath} from 'node:url'
import path from 'node:path'
import yargs from 'yargs/yargs'
import {hideBin} from 'yargs/helpers'
import benchmarkOptionsFile from './benchmark-options.ts'
import startServer from './lib/server.ts'
import {localCommunityHost} from './lib/local-community-host.ts'
import {isAtLeast} from './lib/semver.ts'
import {profilesPath, slugify, summarizeCpuProfileFile} from './lib/cpu-profile.ts'
import {benchmarks, type BenchmarkDefinition} from './lib/benchmark-registry.ts'
import type {BaseBenchmarkOptions, BenchmarkReport, RunEnvironment, Runtime} from './types.ts'

interface Argv {
  debugPkcJs?: boolean
  runtime?: string | string[]
  benchmark?: string | string[]
  // also run every profilable cell once more under the CPU profiler (see lib/cpu-profile.ts)
  profile?: boolean
  // only the cells whose options name contains one of these (e.g. --only 'board M')
  only?: string | string[]
}

const argv = yargs(hideBin(process.argv)).argv as Argv
console.log({argv})
const rootPath = path.dirname(fileURLToPath(import.meta.url))
const reportPath = path.join(rootPath, 'report.json')

fs.removeSync(reportPath)

// A rejection nobody handled must cost at most the cell it happened in. Node's default is to crash
// the process, and this process is the benchmark server: one unawaited publishChallengeAnswers that
// failed once took the server down mid-run and lost a whole version's report (v0.0.95).
process.on('unhandledRejection', (e) => console.log('unhandled rejection (ignored):', (e as Error)?.stack ?? e))

const server = await startServer()

const pkcJsVersion: string = fs.readJsonSync(path.join(rootPath, 'node_modules', '@pkcprotocol', 'pkc-js', 'package.json')).version
const harnessCommit = (() => {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], {cwd: rootPath, encoding: 'utf-8'}).trim()
  } catch (e) {
    return undefined
  }
})()
const environment: RunEnvironment = {
  cpuModel: os.cpus()[0]?.model,
  cpus: os.cpus().length,
  memoryGB: Number((os.totalmem() / 1024 ** 3).toFixed(1)),
  kernel: os.release(),
  node: process.version,
  ...(process.env.RUNNER_NAME ? {runnerName: process.env.RUNNER_NAME} : {}),
}
console.log(`benchmarking pkc-js ${pkcJsVersion} (harness ${harnessCommit?.slice(0, 7) ?? 'unknown'})`, environment)

const asArray = (v: string | string[] | undefined): string[] => (Array.isArray(v) ? v : v ? [v] : [])
const requestedBenchmarks = asArray(argv.benchmark)
const requestedRuntimes = asArray(argv.runtime)
for (const name of requestedBenchmarks) {
  if (!benchmarks.some((b) => b.name === name)) throw Error(`unknown --benchmark '${name}', known: ${benchmarks.map((b) => b.name).join(', ')}`)
}
const isBenchmark = (b: BenchmarkDefinition): boolean =>
  requestedBenchmarks.length ? requestedBenchmarks.includes(b.name) : !b.optIn
const isRuntime = (name: Runtime): boolean => requestedRuntimes.length === 0 || requestedRuntimes.includes(name)
// --only narrows the benchmarks that have a matching cell and leaves the others whole, so
// `--benchmark soak --benchmark seeded-board --only 'board M'` runs all of soak and only board M
const onlyCells = asArray(argv.only)
const matchesOnly = (optionsName: string): boolean => onlyCells.some((part) => optionsName.includes(part))

const readReports = (): BenchmarkReport[] => {
  try {
    return JSON.parse(fs.readFileSync(reportPath, 'utf-8'))
  } catch (e) {
    return []
  }
}
const writeReports = (reports: BenchmarkReport[]) => fs.writeFileSync(reportPath, JSON.stringify(reports))

const appendReport = (entry: BenchmarkReport) => writeReports([...readReports(), entry])

// Run one cell in its own process group, so a cap can kill npm, vitest and chromium together.
const runProcess = (
  command: string,
  args: string[],
  env: Record<string, string>,
  timeoutMs: number,
): Promise<{code: number | null; timedOut: boolean}> =>
  new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: rootPath,
      env: {...process.env, ...env, ...(argv.debugPkcJs ? {DEBUG: 'pkc*', FORCE_COLOR: '1'} : {})},
      detached: true,
      stdio: argv.debugPkcJs ? 'inherit' : 'pipe',
    })
    child.stdout?.on('data', (data: Buffer) => process.stdout.write(`${data}`))
    child.stderr?.on('data', (data: Buffer) => process.stderr.write(`${data}`))
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      console.log(`cell hit its ${Math.round(timeoutMs / 60000)} minute cap, killing it`)
      try {
        process.kill(-child.pid!, 'SIGKILL')
      } catch (e) {
        child.kill('SIGKILL')
      }
    }, timeoutMs)
    child.on('close', (code) => {
      clearTimeout(timer)
      // whatever the cell left running in its group (chromium, a kubo it spawned) goes with it
      try {
        process.kill(-child.pid!, 'SIGKILL')
      } catch (e) {
        // already gone
      }
      resolve({code, timedOut})
    })
  })

const profiledSuffix = ' (cpu profiled)'

const runCell = async (benchmark: BenchmarkDefinition, options: BaseBenchmarkOptions & {cellTimeoutMinutes?: number}, runtime: Runtime, profiled = false) => {
  const reportName = options.name + (profiled ? profiledSuffix : '')
  const errorEntry = (message: string, extra: Partial<BenchmarkReport> = {}): BenchmarkReport => ({
    name: reportName,
    type: benchmark.optionsType,
    timestamp: Date.now(),
    timeSeconds: 0,
    runtime,
    error: {message},
    ...extra,
  })
  if (!isAtLeast(pkcJsVersion, options.minPkcJsVersion)) {
    console.log(`skipping '${options.name}' (${runtime}): needs pkc-js >= ${options.minPkcJsVersion}`)
    appendReport(errorEntry(`unsupported in pkc-js v${pkcJsVersion} (needs >= ${options.minPkcJsVersion})`, {unsupported: true}))
    return
  }
  const countBefore = readReports().filter((r) => r.type === benchmark.optionsType && r.name === reportName && r.runtime === runtime).length
  const dataPath = (options.pkcOptions as {dataPath?: string})?.dataPath
  if (dataPath && runtime === 'node') fs.removeSync(path.join(rootPath, dataPath))

  const timeoutMs = (options.cellTimeoutMinutes ?? benchmark.cellTimeoutMinutes) * 60 * 1000
  const env: Record<string, string> = {
    BENCHMARK_OPTIONS_NAME: options.name,
    BENCHMARK_CELL_DEADLINE_MS: String(timeoutMs),
    ...(profiled ? {BENCHMARK_PROFILED: '1'} : {}),
  }
  const started = Date.now()
  let result: {code: number | null; timedOut: boolean}
  let profileDir: string | undefined
  if (benchmark.runner === 'script') {
    const args = [`benchmark/${benchmark.file}`]
    if (profiled) {
      profileDir = path.join(profilesPath, `${slugify(benchmark.name)}-${slugify(options.name)}-${Date.now()}`)
      fs.ensureDirSync(profileDir)
      args.unshift('--cpu-prof', '--cpu-prof-dir', profileDir)
    }
    result = await runProcess(process.execPath, args, env, timeoutMs)
  } else if (runtime === 'node') {
    result = await runProcess('npm', ['run', 'benchmark:node', '--', `benchmark/${benchmark.file}`], env, timeoutMs)
  } else {
    result = await runProcess('npm', ['run', 'benchmark:browser', '--', `benchmark/${benchmark.file}`], {...env, BENCHMARK_FILE: benchmark.file}, timeoutMs)
  }

  const reports = readReports()
  const mine = reports.filter((r) => r.type === benchmark.optionsType && r.name === reportName && r.runtime === runtime)
  if (mine.length === countBefore) {
    const why = result.timedOut
      ? `cell timed out after ${Math.round(timeoutMs / 60000)} minutes`
      : `cell exited (code ${result.code}) without writing a report`
    console.log(`'${reportName}' (${runtime}): ${why}`)
    appendReport(errorEntry(why, {timeSeconds: (Date.now() - started) / 1000}))
    return
  }
  // --cpu-prof writes its file as the script exits, so the summary is attached here
  if (profileDir) {
    const file = fs
      .readdirSync(profileDir)
      .filter((f) => f.endsWith('.cpuprofile'))
      .map((f) => path.join(profileDir!, f))
      .sort((a, b) => fs.statSync(b).size - fs.statSync(a).size)[0]
    if (file) {
      const entry = mine[mine.length - 1]!
      entry.cpuProfile = summarizeCpuProfileFile(file)
      entry.profiled = true
      writeReports(reports)
    }
  }
}

let hostRunning = false
for (const benchmark of benchmarks) {
  if (!isBenchmark(benchmark)) continue
  // the local community host's mesh is only needed by the benchmarks that use it; stop it before
  // the next one so its kubo daemons don't sit in the background of unrelated measurements
  if (hostRunning && !benchmark.usesLocalCommunityHost) {
    await localCommunityHost.stop()
    hostRunning = false
  }
  const allOptions = (benchmarkOptionsFile[benchmark.optionsType] ?? []) as (BaseBenchmarkOptions & {cellTimeoutMinutes?: number})[]
  const narrowed = onlyCells.length > 0 && allOptions.some((options) => matchesOnly(options.name))
  console.log(`benchmarking ${benchmark.name}...`)
  for (const runtime of benchmark.runtimes) {
    if (!isRuntime(runtime)) continue
    for (const options of allOptions) {
      if (options.runtimes && !options.runtimes.includes(runtime)) continue
      if (narrowed && !matchesOnly(options.name)) continue
      if (benchmark.usesLocalCommunityHost) hostRunning = true
      await runCell(benchmark, options, runtime)
      // the profiled repetition is node only: in chromium the community side is what gets profiled,
      // and that already happens on the node repetition
      if (argv.profile && benchmark.profile && options.profile && runtime === 'node' && isAtLeast(pkcJsVersion, options.minPkcJsVersion)) {
        await runCell(benchmark, options, runtime, true)
      }
    }
  }
}
if (hostRunning) await localCommunityHost.stop()

// stamp every entry with what was measured and where (see RunEnvironment)
const measuredAt = new Date().toISOString()
const environmentDependentCells = new Set<string>()
for (const benchmark of benchmarks) {
  for (const options of (benchmarkOptionsFile[benchmark.optionsType] ?? []) as BaseBenchmarkOptions[]) {
    if (benchmark.environmentDependent || options.environmentDependent) {
      environmentDependentCells.add(`${benchmark.optionsType}|${options.name}`)
      environmentDependentCells.add(`${benchmark.optionsType}|${options.name}${profiledSuffix}`)
    }
  }
}
writeReports(
  readReports().map((entry) => ({
    pkcJsVersion,
    ...(harnessCommit ? {harnessCommit} : {}),
    measuredAt,
    environment,
    ...(environmentDependentCells.has(`${entry.type}|${entry.name}`) ? {environmentDependent: true} : {}),
    ...entry,
  })),
)

if (fs.existsSync(reportPath)) {
  await new Promise<void>((resolve) => {
    const child = spawn('npm', ['run', 'report'])
    child.stdout.on('data', (data: Buffer) => process.stdout.write(`${data}`))
    child.stderr.on('data', (data: Buffer) => process.stderr.write(`${data}`))
    child.on('close', () => resolve())
  })
} else {
  console.log(`can't print report, no file '${reportPath}'`)
}
server.close()
process.exit()
