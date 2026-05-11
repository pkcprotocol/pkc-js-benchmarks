import {readFileSync} from 'node:fs'
import {fileURLToPath} from 'node:url'
import path from 'node:path'
import type {BenchmarkReport, CommunityMetrics, CommentMetrics} from '../types.ts'

const reportPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'report.json')
const reports: BenchmarkReport[] = JSON.parse(readFileSync(reportPath, 'utf-8'))

let format: 'table' | 'inline' = 'table'
if (process.argv.includes('--inline')) {
  format = 'inline'
}

type MetricKey = keyof CommunityMetrics | keyof CommentMetrics
type MetricBag = Record<string, CommunityMetrics | CommentMetrics>

const numericValues = (data: MetricBag, key: MetricKey): number[] => {
  return Object.values(data)
    .map((entry) => (entry as Record<string, unknown>)[key])
    .filter((time): time is number => typeof time === 'number')
}

const getAverage = (data: MetricBag = {}, key: MetricKey): number => {
  const times = numericValues(data, key)
  const total = times.reduce((sum, time) => sum + time, 0)
  return Number((total / times.length).toFixed(3))
}

const getMedian = (data: MetricBag = {}, key: MetricKey): number => {
  const times = numericValues(data, key)
  const sortedTimes = [...times].sort((a, b) => a - b)
  const midIndex = Math.floor(sortedTimes.length / 2)
  let result: number
  if (sortedTimes.length % 2 === 0) {
    result = (sortedTimes[midIndex - 1]! + sortedTimes[midIndex]!) / 2
  } else {
    result = sortedTimes[midIndex]!
  }
  return Number(result.toFixed(3))
}

const getSuccessRatio = (data: MetricBag = {}, key: MetricKey): string => {
  const all = Object.values(data).map((entry) => (entry as Record<string, unknown>)[key])
  const failed = all.filter((time) => time === undefined || time === null)
  return `${all.length - failed.length}/${all.length}`
}

const hasTimePropName = (data: MetricBag = {}, key: MetricKey): boolean => {
  const all = Object.values(data).map((entry) => (entry as Record<string, unknown>)[key])
  if (all.length === 0) {
    return true
  }
  const failed = all.filter((time) => time === undefined)
  if (all.length === failed.length) {
    return false
  }
  return true
}

const incrementString = (string: string): string =>
  /\s\d+$/.test(string)
    ? string.replace(/(\d+)$/, (match) => `${+match + 1}`)
    : `${string} 2`

const toArrayGroupedByPrefix = <T>(obj: Record<string, T>): T[] => {
  const entries = Object.entries(obj)
  const grouped = new Map<string, T[]>()
  for (const [key, value] of entries) {
    const prefix = key.replace(/-[^-]+$/, '')
    if (!grouped.has(prefix)) grouped.set(prefix, [])
    grouped.get(prefix)!.push(value)
  }
  return Array.from(grouped.values()).flat()
}

const benchmarkTypes: Record<string, BenchmarkReport[]> = {}
for (const benchmark of reports) {
  const type = benchmark.type as string
  if (!benchmarkTypes[type]) {
    benchmarkTypes[type] = []
  }
}

const benchmarkTypesByName: Record<string, Record<string, BenchmarkReport>> = {}
for (const benchmark of reports) {
  const type = benchmark.type as string
  if (!benchmarkTypesByName[type]) {
    benchmarkTypesByName[type] = {}
  }
  while (benchmarkTypesByName[type][`${benchmark.name}-${benchmark.runtime}`]) {
    benchmark.name = incrementString(benchmark.name)
  }
  benchmarkTypesByName[type][`${benchmark.name}-${benchmark.runtime}`] = benchmark
}

for (const benchmarkType in benchmarkTypesByName) {
  benchmarkTypes[benchmarkType] = toArrayGroupedByPrefix(benchmarkTypesByName[benchmarkType]!)
}

const formatBenchmarkTypeTitle = (string: string): string =>
  string.replace('BenchmarkOptions', '').replace(/([a-z])([A-Z])/g, '$1 $2').toUpperCase()

type ReportType = 'comment' | 'publish' | 'community'

const benchmarkTypeToReportType = (benchmarkType: string): ReportType =>
  benchmarkType.match(/comment/i) ? 'comment' : benchmarkType.match(/publish/i) ? 'publish' : 'community'

if (format === 'table') {
  for (const benchmarkType in benchmarkTypes) {
    const table: Record<string, Record<string, unknown>> = {}
    const getNextRowName = () => ' '.repeat(Object.keys(table).length)
    const tableName = formatBenchmarkTypeTitle(benchmarkType)
    table[tableName] = {}
    table[getNextRowName()] = {}
    table[getNextRowName()] = {}

    for (const benchmark of benchmarkTypes[benchmarkType]!) {
      table[`${benchmark.name}`] = {}

      const reportType = benchmarkTypeToReportType(benchmark.type as string)
      if (reportType === 'community') {
        const communities = benchmark.communities ?? {}
        if (hasTimePropName(communities, 'resolvingAddressTimeSeconds')) {
          table[getNextRowName()] = {
            runtime: benchmark.runtime,
            benchmark: 'resolve address',
            median: getMedian(communities, 'resolvingAddressTimeSeconds'),
            average: getAverage(communities, 'resolvingAddressTimeSeconds'),
            success: getSuccessRatio(communities, 'resolvingAddressTimeSeconds'),
          }
        }
        if (hasTimePropName(communities, 'fetchingIpnsTimeSeconds')) {
          table[getNextRowName()] = {
            runtime: benchmark.runtime,
            benchmark: 'fetch ipns',
            median: getMedian(communities, 'fetchingIpnsTimeSeconds'),
            average: getAverage(communities, 'fetchingIpnsTimeSeconds'),
            success: getSuccessRatio(communities, 'fetchingIpnsTimeSeconds'),
          }
        }
        if (hasTimePropName(communities, 'fetchingIpfsTimeSeconds')) {
          table[getNextRowName()] = {
            runtime: benchmark.runtime,
            benchmark: 'fetch ipfs',
            median: getMedian(communities, 'fetchingIpfsTimeSeconds'),
            average: getAverage(communities, 'fetchingIpfsTimeSeconds'),
            success: getSuccessRatio(communities, 'fetchingIpfsTimeSeconds'),
          }
        }
      }
      if (reportType === 'comment') {
        const comments = benchmark.comments ?? {}
        if (hasTimePropName(comments, 'fetchCommentIpfsTimeSeconds')) {
          table[getNextRowName()] = {
            runtime: benchmark.runtime,
            benchmark: 'fetch comment ipfs',
            median: getMedian(comments, 'fetchCommentIpfsTimeSeconds'),
            average: getAverage(comments, 'fetchCommentIpfsTimeSeconds'),
            success: getSuccessRatio(comments, 'fetchCommentIpfsTimeSeconds'),
          }
        }
        if (hasTimePropName(comments, 'resolvingCommunityAddressTimeSeconds')) {
          table[getNextRowName()] = {
            runtime: benchmark.runtime,
            benchmark: 'resolve community address',
            median: getMedian(comments, 'resolvingCommunityAddressTimeSeconds'),
            average: getAverage(comments, 'resolvingCommunityAddressTimeSeconds'),
            success: getSuccessRatio(comments, 'resolvingCommunityAddressTimeSeconds'),
          }
        }
        if (hasTimePropName(comments, 'fetchingCommentUpdateTimeSeconds')) {
          table[getNextRowName()] = {
            runtime: benchmark.runtime,
            benchmark: 'fetch comment update',
            median: getMedian(comments, 'fetchingCommentUpdateTimeSeconds'),
            average: getAverage(comments, 'fetchingCommentUpdateTimeSeconds'),
            success: getSuccessRatio(comments, 'fetchingCommentUpdateTimeSeconds'),
          }
        }
      }
      if (reportType === 'publish') {
        const communities = benchmark.communities ?? {}
        if (hasTimePropName(communities, 'challengeRequestTimeSeconds')) {
          table[getNextRowName()] = {
            runtime: benchmark.runtime,
            benchmark: 'challenge request',
            median: getMedian(communities, 'challengeRequestTimeSeconds'),
            average: getAverage(communities, 'challengeRequestTimeSeconds'),
            success: getSuccessRatio(communities, 'challengeRequestTimeSeconds'),
          }
        }
        if (hasTimePropName(communities, 'challengeTimeSeconds')) {
          table[getNextRowName()] = {
            runtime: benchmark.runtime,
            benchmark: 'challenge',
            median: getMedian(communities, 'challengeTimeSeconds'),
            average: getAverage(communities, 'challengeTimeSeconds'),
            success: getSuccessRatio(communities, 'challengeTimeSeconds'),
          }
        }
        if (hasTimePropName(communities, 'challengeAnswerTimeSeconds')) {
          table[getNextRowName()] = {
            runtime: benchmark.runtime,
            benchmark: 'challenge answer',
            median: getMedian(communities, 'challengeAnswerTimeSeconds'),
            average: getAverage(communities, 'challengeAnswerTimeSeconds'),
            success: getSuccessRatio(communities, 'challengeAnswerTimeSeconds'),
          }
        }
        if (hasTimePropName(communities, 'challengeVerificationTimeSeconds')) {
          table[getNextRowName()] = {
            runtime: benchmark.runtime,
            benchmark: 'challenge verification',
            median: getMedian(communities, 'challengeVerificationTimeSeconds'),
            average: getAverage(communities, 'challengeVerificationTimeSeconds'),
            success: getSuccessRatio(communities, 'challengeVerificationTimeSeconds'),
          }
        }
      }
    }
    console.table(table)
  }
}

if (format === 'inline') {
  const pad = 18

  for (const benchmarkType in benchmarkTypes) {
    console.log('')
    console.log(`${formatBenchmarkTypeTitle(benchmarkType)}`)
    for (const benchmark of benchmarkTypes[benchmarkType]!) {
      console.log('')
      console.log(`benchmark: ${benchmark.name} (${benchmark.runtime})`)

      const reportType = benchmarkTypeToReportType(benchmark.type as string)
      if (reportType === 'community') {
        const communities = benchmark.communities ?? {}
        if (hasTimePropName(communities, 'resolvingAddressTimeSeconds')) {
          console.log(
            'resolve address:'.padEnd(pad) +
              `median ${getMedian(communities, 'resolvingAddressTimeSeconds')}s`.padEnd(pad) +
              `| average ${getAverage(communities, 'resolvingAddressTimeSeconds')}s`.padEnd(pad) +
              `| success ${getSuccessRatio(communities, 'resolvingAddressTimeSeconds')}`,
          )
        }
        if (hasTimePropName(communities, 'fetchingIpnsTimeSeconds')) {
          console.log(
            'fetch ipns:'.padEnd(pad) +
              `median ${getMedian(communities, 'fetchingIpnsTimeSeconds')}s`.padEnd(pad) +
              `| average ${getAverage(communities, 'fetchingIpnsTimeSeconds')}s`.padEnd(pad) +
              `| success ${getSuccessRatio(communities, 'fetchingIpnsTimeSeconds')}`,
          )
        }
        if (hasTimePropName(communities, 'fetchCommentIpfsTimeSeconds' as MetricKey)) {
          console.log(
            'fetch ipfs:'.padEnd(pad) +
              `median ${getMedian(communities, 'fetchCommentIpfsTimeSeconds' as MetricKey)}s`.padEnd(pad) +
              `| average ${getAverage(communities, 'fetchCommentIpfsTimeSeconds' as MetricKey)}s`.padEnd(pad) +
              `| success ${getSuccessRatio(communities, 'fetchCommentIpfsTimeSeconds' as MetricKey)}`,
          )
        }
      }
      if (reportType === 'comment') {
        const comments = benchmark.comments ?? {}
        if (hasTimePropName(comments, 'fetchCommentIpfsTimeSeconds')) {
          console.log(
            'comment ipfs:'.padEnd(pad) +
              `median ${getMedian(comments, 'fetchCommentIpfsTimeSeconds')}s`.padEnd(pad) +
              `| average ${getAverage(comments, 'fetchCommentIpfsTimeSeconds')}s`.padEnd(pad) +
              `| success ${getSuccessRatio(comments, 'fetchCommentIpfsTimeSeconds')}`,
          )
        }
        if (hasTimePropName(comments, 'resolvingCommunityAddressTimeSeconds')) {
          console.log(
            'community address:'.padEnd(pad) +
              `median ${getMedian(comments, 'resolvingCommunityAddressTimeSeconds')}s`.padEnd(pad) +
              `| average ${getAverage(comments, 'resolvingCommunityAddressTimeSeconds')}s`.padEnd(pad) +
              `| success ${getSuccessRatio(comments, 'resolvingCommunityAddressTimeSeconds')}`,
          )
        }
        if (hasTimePropName(comments, 'fetchingCommentUpdateTimeSeconds')) {
          console.log(
            'comment update:'.padEnd(pad) +
              `median ${getMedian(comments, 'fetchingCommentUpdateTimeSeconds')}s`.padEnd(pad) +
              `| average ${getAverage(comments, 'fetchingCommentUpdateTimeSeconds')}s`.padEnd(pad) +
              `| success ${getSuccessRatio(comments, 'fetchingCommentUpdateTimeSeconds')}`,
          )
        }
      }
      if (reportType === 'publish') {
        const communities = benchmark.communities ?? {}
        if (hasTimePropName(communities, 'challengeRequestTimeSeconds')) {
          console.log(
            'request:'.padEnd(pad) +
              `median ${getMedian(communities, 'challengeRequestTimeSeconds')}s`.padEnd(pad) +
              `| average ${getAverage(communities, 'challengeRequestTimeSeconds')}s`.padEnd(pad) +
              `| success ${getSuccessRatio(communities, 'challengeRequestTimeSeconds')}`,
          )
        }
        if (hasTimePropName(communities, 'challengeTimeSeconds')) {
          console.log(
            'challenge:'.padEnd(pad) +
              `median ${getMedian(communities, 'challengeTimeSeconds')}s`.padEnd(pad) +
              `| average ${getAverage(communities, 'challengeTimeSeconds')}s`.padEnd(pad) +
              `| success ${getSuccessRatio(communities, 'challengeTimeSeconds')}`,
          )
        }
        if (hasTimePropName(communities, 'challengeAnswerTimeSeconds')) {
          console.log(
            'answer:'.padEnd(pad) +
              `median ${getMedian(communities, 'challengeAnswerTimeSeconds')}s`.padEnd(pad) +
              `| average ${getAverage(communities, 'challengeAnswerTimeSeconds')}s`.padEnd(pad) +
              `| success ${getSuccessRatio(communities, 'challengeAnswerTimeSeconds')}`,
          )
        }
        if (hasTimePropName(communities, 'challengeVerificationTimeSeconds')) {
          console.log(
            'verification:'.padEnd(pad) +
              `median ${getMedian(communities, 'challengeVerificationTimeSeconds')}s`.padEnd(pad) +
              `| average ${getAverage(communities, 'challengeVerificationTimeSeconds')}s`.padEnd(pad) +
              `| success ${getSuccessRatio(communities, 'challengeVerificationTimeSeconds')}`,
          )
        }
      }
    }
  }
}
