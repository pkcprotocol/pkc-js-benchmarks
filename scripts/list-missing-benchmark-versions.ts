// Lists published @pkcprotocol/pkc-js versions that still need a benchmark report.
//
// Output: one "<version> <gitHead>" line per version, oldest first (by publish time).
// Used by .github/workflows/benchmark-releases.yml to drive the backfill loop.
//
// A version needs benchmarking when neither reports/<gitHead>.json nor
// reports/<gitHead>.failed exists. Overrides via env:
//   FORCE_LATEST=1         also include dist-tags.latest even if already benchmarked
//                          (used on harness changes, to re-benchmark current latest)
//   INCLUDE_VERSION=x.y.z  also include this specific version even if already benchmarked
//   MISSING_BENCHMARKS="a b" backfill mode: instead of versions with no report, list the LAST
//                          (default 20) most recently published versions whose report has no entry
//                          of these benchmarks (start.ts --benchmark names, see
//                          lib/benchmark-registry.ts). Used by benchmark-backfill.yml.
//   LAST=20                how many recent versions backfill mode considers
//   MIN_VERSION=x.y.z      ignore versions older than this (default below). We do NOT
//                          backfill pre-history: old releases are incompatible with the
//                          current harness and each hanging test burns vitest's 10-min
//                          timeout, so a single dead version can eat hours. We start at
//                          the latest version and only go forward from there.
import fs from 'node:fs'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {compareSemver} from '../lib/semver.ts'
import {benchmarkByName} from '../lib/benchmark-registry.ts'

// Floor for benchmarking. Bump this if you ever want to re-include older releases.
const DEFAULT_MIN_VERSION = '0.0.60'

const rootPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const reportsDir = path.join(rootPath, 'reports')

const res = await fetch('https://registry.npmjs.org/@pkcprotocol%2fpkc-js')
const data = (await res.json()) as {
  versions?: Record<string, {gitHead?: string}>
  time?: Record<string, string>
  'dist-tags'?: {latest?: string}
}
const versions = data.versions || {}
const time = data.time || {}
const latest = data['dist-tags']?.latest

const forceLatest = process.env.FORCE_LATEST === '1'
const includeVersion = process.env.INCLUDE_VERSION || ''
const minVersion = process.env.MIN_VERSION || DEFAULT_MIN_VERSION

// A .failed marker means a prior run could not benchmark this commit; skip it so we
// don't retry forever. Delete the marker (or force the version) to retry.
const alreadyHandled = (gitHead: string): boolean =>
  fs.existsSync(path.join(reportsDir, `${gitHead}.json`)) || fs.existsSync(path.join(reportsDir, `${gitHead}.failed`))

const rows: {version: string; gitHead: string; t: string}[] = []
for (const [version, meta] of Object.entries(versions)) {
  const gitHead = meta?.gitHead
  if (!gitHead) continue // unpublished gitHead -> cannot key a report, skip
  const forced = (forceLatest && version === latest) || version === includeVersion
  if (!forced && compareSemver(version, minVersion) < 0) continue // below floor: skip pre-history
  if (!forced && alreadyHandled(gitHead)) continue
  rows.push({version, gitHead, t: time[version] || ''})
}

rows.sort((a, b) => a.t.localeCompare(b.t)) // oldest first

const missingBenchmarks = (process.env.MISSING_BENCHMARKS || '').split(/[\s,]+/).filter(Boolean)
if (missingBenchmarks.length) {
  const types = missingBenchmarks.map((name) => {
    const benchmark = benchmarkByName(name)
    if (!benchmark) throw Error(`unknown benchmark '${name}'`)
    return benchmark.optionsType
  })
  const last = Number(process.env.LAST || 20)
  const recent = Object.entries(versions)
    .filter(([version, meta]) => meta?.gitHead && compareSemver(version, minVersion) >= 0)
    .map(([version, meta]) => ({version, gitHead: meta.gitHead!, t: time[version] || ''}))
    .sort((a, b) => a.t.localeCompare(b.t))
    .slice(-last)
  for (const r of recent) {
    const reportFile = path.join(reportsDir, `${r.gitHead}.json`)
    // a version with no report at all gets a full run from benchmark-releases.yml, not a partial one
    if (!fs.existsSync(reportFile)) continue
    const entries = JSON.parse(fs.readFileSync(reportFile, 'utf-8')) as {type?: string}[]
    const forced = r.version === includeVersion
    if (forced || types.some((type) => !entries.some((entry) => entry.type === type))) console.log(`${r.version} ${r.gitHead}`)
  }
} else {
  for (const r of rows) console.log(`${r.version} ${r.gitHead}`)
}
