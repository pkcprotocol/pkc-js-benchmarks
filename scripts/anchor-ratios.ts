// Stamp a version's freshly backfilled entries with their ratio to an anchor version measured in the
// same CI job.
//
// usage: node scripts/anchor-ratios.ts <anchor report.json> <anchor version> <reports/<gitHead>.json> <measuredAt>
//
// Backfilled numbers are measured long after their release, on whatever runner GitHub hands out, and
// hosted runners differ enough (CPU model, noisy neighbours) to fake a regression on their own. The
// backfill workflow therefore benchmarks a fixed anchor version in the same job, every few versions,
// and stores each entry's median / the anchor's median per metric key alongside the absolute
// numbers: a ratio from one job is comparable across jobs where the absolute number is not.
// Only entries whose measuredAt matches (the ones this job just measured) are touched.
import fs from 'node:fs'
import type {BenchmarkReport} from '../types.ts'

const [anchorPath, anchorVersion, targetPath, measuredAt] = process.argv.slice(2)
if (!anchorPath || !anchorVersion || !targetPath || !measuredAt) {
  throw Error('usage: anchor-ratios.ts <anchor report.json> <anchor version> <reports/<gitHead>.json> <measuredAt>')
}

const metadataKeys = new Set(['timestamp', 'environment', 'anchor', 'topFunctions', 'measuredAt'])
const isMetric = (key: string) => /(TimeSeconds|PerSecond|MB|Ms|Bytes|Percent)$/.test(key)

// every numeric metric in an entry, by key (all samples of a key together)
const metricValues = (entry: BenchmarkReport): Map<string, number[]> => {
  const values = new Map<string, number[]>()
  const walk = (obj: unknown, prefix: string) => {
    if (!obj || typeof obj !== 'object') return
    for (const [key, val] of Object.entries(obj as Record<string, unknown>)) {
      if (metadataKeys.has(key)) continue
      if (typeof val === 'number' && isMetric(key)) {
        const name = prefix ? `${prefix}.${key}` : key
        values.set(name, [...(values.get(name) ?? []), val])
      } else if (val && typeof val === 'object') {
        walk(val, ['process', 'communityProcess', 'aggregate', 'cpuProfile', 'communityCpuProfile'].includes(key) ? key : prefix)
      }
    }
  }
  walk(entry, '')
  return values
}

const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2
}

const cellKey = (entry: BenchmarkReport) => `${entry.type}|${entry.name}|${entry.runtime}`
const anchors = new Map((JSON.parse(fs.readFileSync(anchorPath, 'utf-8')) as BenchmarkReport[]).map((e) => [cellKey(e), e]))
const entries = JSON.parse(fs.readFileSync(targetPath, 'utf-8')) as BenchmarkReport[]
let stamped = 0
for (const entry of entries) {
  if (entry.measuredAt !== measuredAt) continue
  const anchor = anchors.get(cellKey(entry))
  if (!anchor) continue
  const anchorValues = metricValues(anchor)
  const ratios: Record<string, number> = {}
  for (const [key, values] of metricValues(entry)) {
    const base = anchorValues.get(key)
    if (!base?.length) continue
    const denominator = median(base)
    if (denominator > 0) ratios[key] = Number((median(values) / denominator).toFixed(3))
  }
  entry.anchor = {version: anchorVersion, ratios}
  stamped++
}
fs.writeFileSync(targetPath, JSON.stringify(entries))
console.log(`${targetPath}: stamped ${stamped} entries with ratios to anchor v${anchorVersion}`)
