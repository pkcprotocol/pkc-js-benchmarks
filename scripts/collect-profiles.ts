// Move a run's CPU profiles into the repo, one folder per pkc-js version, and point the report at them.
//
// usage: node scripts/collect-profiles.ts <version> <gitHead> [profiles dir]
//
// Every entry of reports/<gitHead>.json whose cpuProfile / communityCpuProfile `file` is in the
// profiles dir (default: profiles/, where start.ts writes them; `file` is relative to it) gets its
// profile copied to
//
//   cpu-profiles/v<version>/v<version>--<benchmark>--<cell>[--community].cpuprofile
//
// and its `file` rewritten to that repo path. The name has no timestamp, so re-measuring a cell
// replaces its profile, just as merge-report.ts replaces its entry. Entries whose profile is not
// in the dir (already collected, or from another run) are left alone. A profile over GitHub's
// 50MB warning size is stored gzipped (.cpuprofile.gz). Open one in Chrome DevTools > Performance,
// or https://www.speedscope.app.
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import {fileURLToPath} from 'node:url'
import {benchmarks} from '../lib/benchmark-registry.ts'
import {slugify} from '../lib/cpu-profile.ts'
import type {BenchmarkReport, CpuProfileSummary} from '../types.ts'

const rootPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const [version, gitHead, sourceArg] = process.argv.slice(2)
if (!version || !gitHead) throw Error('usage: collect-profiles.ts <version> <gitHead> [profiles dir]')
const sourceDir = path.resolve(sourceArg ?? path.join(rootPath, 'profiles'))
const reportPath = path.join(rootPath, 'reports', `${gitHead}.json`)
const versionDir = path.join('cpu-profiles', `v${version}`)
const gzipAboveBytes = 50 * 1024 * 1024

const benchmarkByType = new Map<string, string>(benchmarks.map((benchmark) => [benchmark.optionsType, benchmark.name]))
const report: BenchmarkReport[] = JSON.parse(fs.readFileSync(reportPath, 'utf-8'))

let collected = 0
const collect = (entry: BenchmarkReport, summary: CpuProfileSummary | undefined, suffix: string) => {
  if (!summary?.file) return
  const source = path.join(sourceDir, summary.file)
  if (!fs.existsSync(source)) return
  const benchmark = benchmarkByType.get(entry.type) ?? entry.type
  const name = `v${version}--${slugify(benchmark)}--${slugify(entry.name)}${suffix}.cpuprofile`
  fs.mkdirSync(path.join(rootPath, versionDir), {recursive: true})
  const data = fs.readFileSync(source)
  const target = data.length > gzipAboveBytes ? `${name}.gz` : name
  fs.writeFileSync(path.join(rootPath, versionDir, target), target === name ? data : zlib.gzipSync(data, {level: 9}))
  summary.file = `${versionDir}/${target}`
  collected++
}
for (const entry of report) {
  collect(entry, entry.cpuProfile, '')
  collect(entry, entry.communityCpuProfile, '--community')
}
fs.writeFileSync(reportPath, JSON.stringify(report))
console.log(`${versionDir}: collected ${collected} profiles from ${path.relative(rootPath, sourceDir) || sourceDir}`)
