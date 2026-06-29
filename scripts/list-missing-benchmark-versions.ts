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
//   MIN_VERSION=x.y.z      ignore versions older than this (default below). We do NOT
//                          backfill pre-history: old releases are incompatible with the
//                          current harness and each hanging test burns vitest's 10-min
//                          timeout, so a single dead version can eat hours. We start at
//                          the latest version and only go forward from there.
import fs from 'node:fs'
import path from 'node:path'
import {fileURLToPath} from 'node:url'

// Floor for benchmarking. Bump this if you ever want to re-include older releases.
const DEFAULT_MIN_VERSION = '0.0.60'

// Compare dotted numeric versions (e.g. 0.0.60 vs 0.0.9). Pre-release/build suffixes
// are ignored — only the x.y.z core is compared. Returns -1 / 0 / 1.
const compareSemver = (a: string, b: string): number => {
  const core = (v: string) => v.split('+')[0].split('-')[0].split('.').map((n) => parseInt(n, 10) || 0)
  const pa = core(a)
  const pb = core(b)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0)
    if (d !== 0) return d < 0 ? -1 : 1
  }
  return 0
}

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
for (const r of rows) console.log(`${r.version} ${r.gitHead}`)
