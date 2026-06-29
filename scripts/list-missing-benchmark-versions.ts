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
import fs from 'node:fs'
import path from 'node:path'
import {fileURLToPath} from 'node:url'

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

// A .failed marker means a prior run could not benchmark this commit; skip it so we
// don't retry forever. Delete the marker (or force the version) to retry.
const alreadyHandled = (gitHead: string): boolean =>
  fs.existsSync(path.join(reportsDir, `${gitHead}.json`)) || fs.existsSync(path.join(reportsDir, `${gitHead}.failed`))

const rows: {version: string; gitHead: string; t: string}[] = []
for (const [version, meta] of Object.entries(versions)) {
  const gitHead = meta?.gitHead
  if (!gitHead) continue // unpublished gitHead -> cannot key a report, skip
  const forced = (forceLatest && version === latest) || version === includeVersion
  if (!forced && alreadyHandled(gitHead)) continue
  rows.push({version, gitHead, t: time[version] || ''})
}

rows.sort((a, b) => a.t.localeCompare(b.t)) // oldest first
for (const r of rows) console.log(`${r.version} ${r.gitHead}`)
