import {spawn} from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import type {ImportMetrics} from '../types.ts'

// node half of the import-time benchmark: every sample is a fresh `node` process importing
// @pkcprotocol/pkc-js, so nothing is warm except what the sample says is warm.
//   cold: an empty compile-cache directory (NODE_COMPILE_CACHE), like the first run after install
//   warm: a compile cache primed by an earlier import, like every run after that
// pkc-js enables node's compile cache itself on import (index-with-compile-cache), honoring
// NODE_COMPILE_CACHE, so pointing that at a fresh directory per sample is all "cold" takes.

const rootPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const pkcJsPackageJson = path.join(rootPath, 'node_modules', '@pkcprotocol', 'pkc-js', 'package.json')

const importScript = `const t = performance.now(); await import('@pkcprotocol/pkc-js'); process.stdout.write('IMPORT_MS=' + (performance.now() - t) + '\\n'); process.exit(0)`

// counts every module node loads (ESM and CommonJS) through the synchronous module hooks
const countModulesPreload = `import m from 'node:module'
const urls = new Set()
if (typeof m.registerHooks === 'function') {
  m.registerHooks({load(url, context, next) { urls.add(url); return next(url, context) }})
  process.on('exit', () => process.stdout.write('MODULES=' + urls.size + '\\n'))
}`

const runNode = (args: string[], env: Record<string, string> = {}): Promise<{stdout: string; ms: number}> =>
  new Promise((resolve, reject) => {
    const start = performance.now()
    const child = spawn(process.execPath, args, {cwd: rootPath, env: {...process.env, ...env}})
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (d) => (stdout += d))
    child.stderr.on('data', (d) => (stderr += d))
    child.on('error', reject)
    child.on('close', (code) => {
      const ms = performance.now() - start
      if (code !== 0) reject(Error(`node ${args.join(' ').slice(0, 80)} exited ${code}: ${stderr.slice(-500)}`))
      else resolve({stdout, ms})
    })
  })

const importOnce = async (cacheDir: string): Promise<number> => {
  const {stdout} = await runNode(['--input-type=module', '-e', importScript], {NODE_COMPILE_CACHE: cacheDir})
  const ms = Number(stdout.match(/IMPORT_MS=([\d.]+)/)?.[1])
  if (!Number.isFinite(ms)) throw Error(`no import time in output: ${stdout.slice(0, 200)}`)
  return ms / 1000
}

const round = (n: number, digits = 3) => Number(n.toFixed(digits))

const median = (values: number[]): number | null => {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return round(sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2)
}

const tarballMetrics = async (version: string): Promise<Partial<ImportMetrics>> => {
  try {
    const meta = (await (await fetch(`https://registry.npmjs.org/@pkcprotocol%2fpkc-js/${version}`)).json()) as {
      dist?: {tarball?: string; unpackedSize?: number; fileCount?: number}
    }
    // the registry answers HEAD without a content-length, so download it (a few MB)
    let packedBytes: number | undefined
    if (meta.dist?.tarball) packedBytes = (await (await fetch(meta.dist.tarball)).arrayBuffer()).byteLength
    return {
      packedTarballMB: packedBytes ? round(packedBytes / 1024 / 1024, 2) : null,
      unpackedMB: meta.dist?.unpackedSize ? round(meta.dist.unpackedSize / 1024 / 1024, 2) : null,
      tarballFilesCount: meta.dist?.fileCount ?? null,
    }
  } catch (e) {
    console.log('could not read the tarball size from npm:', (e as Error).message)
    return {}
  }
}

export const measureNodeImport = async (samples: number): Promise<ImportMetrics> => {
  const version = JSON.parse(fs.readFileSync(pkcJsPackageJson, 'utf-8')).version as string
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pkc-import-'))
  try {
    const nodeStartup: number[] = []
    const cold: number[] = []
    const warm: number[] = []
    const warmCache = path.join(tmp, 'warm')
    await importOnce(warmCache) // prime
    for (let i = 0; i < samples; i++) {
      nodeStartup.push((await runNode(['-e', '0'])).ms / 1000)
      cold.push(await importOnce(path.join(tmp, `cold-${i}`)))
      warm.push(await importOnce(warmCache))
      console.log(`import sample ${i + 1}/${samples}: cold ${round(cold[i]!)}s warm ${round(warm[i]!)}s`)
    }
    let loadedModulesCount: number | null = null
    try {
      const {stdout} = await runNode(['--import', `data:text/javascript,${encodeURIComponent(countModulesPreload)}`, '--input-type=module', '-e', importScript], {
        NODE_COMPILE_CACHE: warmCache,
      })
      const count = Number(stdout.match(/MODULES=(\d+)/)?.[1])
      loadedModulesCount = Number.isFinite(count) ? count : null
    } catch (e) {
      console.log('module count failed:', (e as Error).message)
    }
    const toRecord = (values: number[]) => Object.fromEntries(values.map((v, i) => [`sample-${i + 1}`, round(v)]))
    return {
      coldImportTimeSeconds: toRecord(cold),
      warmImportTimeSeconds: toRecord(warm),
      medianColdImportTimeSeconds: median(cold),
      medianWarmImportTimeSeconds: median(warm),
      medianNodeStartupTimeSeconds: median(nodeStartup),
      loadedModulesCount,
      ...(await tarballMetrics(version)),
    }
  } finally {
    fs.rmSync(tmp, {recursive: true, force: true})
  }
}
