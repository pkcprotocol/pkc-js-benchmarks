// Merge a run's report.json into reports/<gitHead>.json, replacing exactly the cells it measured.
//
// usage: node scripts/merge-report.ts <gitHead> [report.json]
//
// A cell is (type, name, runtime). Every cell in the new report replaces the version's existing
// entries for that cell; every other existing entry is kept. That is what lets a backfill add a new
// benchmark to old versions (or re-measure one) without wiping their release-time history, which a
// plain overwrite of reports/<gitHead>.json would. Prints how many cells were added/replaced.
import fs from 'node:fs'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import type {BenchmarkReport} from '../types.ts'

const rootPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const [gitHead, newReportPath = path.join(rootPath, 'report.json')] = process.argv.slice(2)
if (!gitHead) throw Error('usage: merge-report.ts <gitHead> [report.json]')

const target = path.join(rootPath, 'reports', `${gitHead}.json`)
const fresh = (JSON.parse(fs.readFileSync(newReportPath, 'utf-8')) as BenchmarkReport[]).map((entry) => ({...entry, pkcJsCommitHash: gitHead}))
const existing: BenchmarkReport[] = fs.existsSync(target) ? JSON.parse(fs.readFileSync(target, 'utf-8')) : []

const cellKey = (entry: BenchmarkReport) => `${entry.type}|${entry.name}|${entry.runtime}`
const freshCells = new Set(fresh.map(cellKey))
const kept = existing.filter((entry) => !freshCells.has(cellKey(entry)))
const replaced = existing.length - kept.length
fs.writeFileSync(target, JSON.stringify([...kept, ...fresh]))
console.log(`${path.relative(rootPath, target)}: kept ${kept.length} entries, replaced ${replaced}, added ${fresh.length - Math.min(replaced, fresh.length)} new (${fresh.length} measured)`)
