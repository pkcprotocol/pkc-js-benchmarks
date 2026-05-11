import {spawn} from 'node:child_process'
import fs from 'fs-extra'
import {fileURLToPath} from 'node:url'
import path from 'node:path'
import yargs from 'yargs/yargs'
import {hideBin} from 'yargs/helpers'
import benchmarkOptionsFile from './benchmark-options.ts'
import startServer from './lib/server.ts'

interface Argv {
  debugPkcJs?: boolean
  runtime?: string | string[]
  benchmark?: string | string[]
}

const argv = yargs(hideBin(process.argv)).argv as Argv
console.log({argv})
const rootPath = path.dirname(fileURLToPath(import.meta.url))
const reportPath = path.join(rootPath, 'report.json')

fs.removeSync(reportPath)

const server = await startServer()

interface BenchOpt {
  name: string
  pkcOptions?: {dataPath?: string}
}

let benchmarkNode = (benchmarkFile: string, benchmarkOptions: BenchOpt): Promise<void> =>
  new Promise((resolve) => {
    const benchmarkProcess = spawn('npm', ['run', 'benchmark:node', '--', 'benchmark/' + benchmarkFile], {
      env: {...process.env, BENCHMARK_OPTIONS_NAME: benchmarkOptions.name},
    })
    benchmarkProcess.stdout.on('data', (data: Buffer) => process.stdout.write(`${data}`))
    benchmarkProcess.stderr.on('data', (data: Buffer) => process.stderr.write(`${data}`))
    benchmarkProcess.on('close', () => resolve())
  })

if (argv.debugPkcJs) {
  let seconds = 0
  setInterval(() => {
    console.log(`\n\n${seconds++}s\n\n`)
  }, 1000)
  benchmarkNode = (benchmarkFile, benchmarkOptions) =>
    new Promise((resolve) => {
      seconds = 0
      const benchmarkProcess = spawn('npm', ['run', 'benchmark:node', '--', 'benchmark/' + benchmarkFile], {
        env: {
          ...process.env,
          DEBUG: 'pkc*',
          FORCE_COLOR: '1',
          BENCHMARK_OPTIONS_NAME: benchmarkOptions.name,
        },
        stdio: 'inherit',
      })
      benchmarkProcess.on('close', () => resolve())
    })
}

const benchmarkChrome = (benchmarkFile: string, benchmarkOptions: BenchOpt): Promise<void> =>
  new Promise((resolve) => {
    const benchmarkProcess = spawn('npm', ['run', 'benchmark:browser', '--', 'benchmark/' + benchmarkFile], {
      env: {
        ...process.env,
        BENCHMARK_OPTIONS_NAME: benchmarkOptions.name,
        BENCHMARK_FILE: benchmarkFile,
      },
    })
    benchmarkProcess.stdout.on('data', (data: Buffer) => process.stdout.write(`${data}`))
    benchmarkProcess.stderr.on('data', (data: Buffer) => process.stderr.write(`${data}`))
    benchmarkProcess.on('close', () => resolve())
  })

const printReport = (): Promise<void> | undefined => {
  if (!fs.existsSync(reportPath)) {
    console.log(`can't print report, no file '${reportPath}'`)
    return
  }
  return new Promise((resolve) => {
    const benchmarkProcess = spawn('npm', ['run', 'report'])
    benchmarkProcess.stdout.on('data', (data: Buffer) => process.stdout.write(`${data}`))
    benchmarkProcess.stderr.on('data', (data: Buffer) => process.stderr.write(`${data}`))
    benchmarkProcess.on('close', () => resolve())
  })
}

const asArray = (v: string | string[] | undefined): string[] => (Array.isArray(v) ? v : v ? [v] : [])

const isRuntime = (name: string): boolean => {
  const list = asArray(argv.runtime)
  return list.length === 0 || list.includes(name)
}
const isBenchmark = (name: string): boolean => {
  const list = asArray(argv.benchmark)
  return list.length === 0 || list.includes(name)
}

if (isBenchmark('publish')) {
  console.log('benchmarking publish...')
  const benchmarkFile = 'benchmark-publish.ts'
  if (isRuntime('node')) {
    for (const benchmarkOptions of benchmarkOptionsFile.publishBenchmarkOptions) {
      const dp = (benchmarkOptions.pkcOptions as {dataPath?: string}).dataPath
      if (dp) fs.removeSync(dp)
      await benchmarkNode(benchmarkFile, benchmarkOptions)
    }
  }
  if (isRuntime('chrome')) {
    for (const benchmarkOptions of benchmarkOptionsFile.publishBenchmarkOptions) {
      await benchmarkChrome(benchmarkFile, benchmarkOptions)
    }
  }
}

if (isBenchmark('fetch-ipns')) {
  console.log('benchmarking fetch-ipns...')
  const benchmarkFile = 'benchmark-fetch-ipns.ts'
  if (isRuntime('node')) {
    for (const benchmarkOptions of benchmarkOptionsFile.fetchIpnsBenchmarkOptions) {
      const dp = (benchmarkOptions.pkcOptions as {dataPath?: string}).dataPath
      if (dp) fs.removeSync(dp)
      await benchmarkNode(benchmarkFile, benchmarkOptions)
    }
  }
  if (isRuntime('chrome')) {
    for (const benchmarkOptions of benchmarkOptionsFile.fetchIpnsBenchmarkOptions) {
      await benchmarkChrome(benchmarkFile, benchmarkOptions)
    }
  }
}

if (isBenchmark('fetch-comment')) {
  console.log('benchmarking fetch-comment...')
  const benchmarkFile = 'benchmark-fetch-comment.ts'
  if (isRuntime('node')) {
    for (const benchmarkOptions of benchmarkOptionsFile.fetchCommentBenchmarkOptions) {
      const dp = (benchmarkOptions.pkcOptions as {dataPath?: string}).dataPath
      if (dp) fs.removeSync(dp)
      await benchmarkNode(benchmarkFile, benchmarkOptions)
    }
  }
  if (isRuntime('chrome')) {
    for (const benchmarkOptions of benchmarkOptionsFile.fetchCommentBenchmarkOptions) {
      await benchmarkChrome(benchmarkFile, benchmarkOptions)
    }
  }
}

if (isBenchmark('resolve-addresses')) {
  console.log('benchmarking resolve-addresses...')
  const benchmarkFile = 'benchmark-resolve-addresses.ts'
  if (isRuntime('node')) {
    for (const benchmarkOptions of benchmarkOptionsFile.resolveAddressesBenchmarkOptions) {
      const dp = (benchmarkOptions.pkcOptions as {dataPath?: string}).dataPath
      if (dp) fs.removeSync(dp)
      await benchmarkNode(benchmarkFile, benchmarkOptions)
    }
  }
  if (isRuntime('chrome')) {
    for (const benchmarkOptions of benchmarkOptionsFile.resolveAddressesBenchmarkOptions) {
      await benchmarkChrome(benchmarkFile, benchmarkOptions)
    }
  }
}

if (isBenchmark('gateway-fetch-ipns')) {
  console.log('benchmarking gateway-fetch-ipns...')
  const benchmarkFile = 'benchmark-gateway-fetch-ipns.ts'
  if (isRuntime('node')) {
    for (const benchmarkOptions of benchmarkOptionsFile.gatewayFetchIpnsBenchmarkOptions) {
      await benchmarkNode(benchmarkFile, benchmarkOptions)
    }
  }
  if (isRuntime('chrome')) {
    for (const benchmarkOptions of benchmarkOptionsFile.gatewayFetchIpnsBenchmarkOptions) {
      await benchmarkChrome(benchmarkFile, benchmarkOptions)
    }
  }
}

await printReport()
server.close()
process.exit()
