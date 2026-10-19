import fs from 'node:fs'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import inspector from 'node:inspector'
import type {CpuProfileSummary} from '../types.ts'

// CPU profiles for the profiled repetition of a cell (start.ts --profile):
//   - script benchmarks run under `node --cpu-prof`, and start.ts summarizes the file they leave
//   - the benchmark server profiles its own local community in-process with the inspector
// Either way the summary (self time per npm package, top functions) goes into the report entry and
// the full .cpuprofile stays in profiles/, which CI uploads as an artifact — never into reports/.
//
// Attribution: pkc-js ships most of its dependencies bundled into dist/bundled/chunks/*.js, so a
// sampled frame's file name alone says "pkc-js" for code that is really kubo-rpc-client or undici.
// The bundler (rolldown) marks every module it inlines with `//#region <path>` / `//#endregion`, so
// a frame's line number inside a chunk maps back to the module, and the module path to its package.

interface ProfileNode {
  id: number
  callFrame: {functionName: string; url: string; lineNumber: number}
  children?: number[]
}
interface CpuProfile {
  nodes: ProfileNode[]
  startTime: number
  endTime: number
  samples?: number[]
  timeDeltas?: number[]
}

export const rootPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
export const profilesPath = path.join(rootPath, 'profiles')

const packageFromModulePath = (modulePath: string): string | undefined => {
  const match = modulePath.match(/node_modules\/((?:@[^/]+\/)?[^/]+)\/(?!.*node_modules\/)/)
  return match?.[1]
}

// region tables per chunk file: sorted [startLine, endLine, package, module path]
const regionCache = new Map<string, [number, number, string, string][]>()
const regionsOf = (filePath: string, ownPackage: string): [number, number, string, string][] => {
  let regions = regionCache.get(filePath)
  if (regions) return regions
  regions = []
  try {
    const lines = fs.readFileSync(filePath, 'utf-8').split('\n')
    const stack: [number, string, string][] = []
    lines.forEach((line, index) => {
      if (line.startsWith('//#region ')) {
        const modulePath = line.slice('//#region '.length).trim()
        stack.push([index, packageFromModulePath(modulePath) ?? ownPackage, modulePath])
      } else if (line.startsWith('//#endregion') && stack.length) {
        const [start, pkg, modulePath] = stack.pop()!
        regions!.push([start, index, pkg, modulePath])
      }
    })
  } catch (e) {
    // not a readable file (node: internals, eval code)
  }
  regions.sort((a, b) => a[0] - b[0])
  regionCache.set(filePath, regions)
  return regions
}

export const packageOfFrame = (url: string, lineNumber: number): string => frameOrigin(url, lineNumber).pkg

// pkc-js's own source module of a frame (dist/node/... -> runtime/node/community/db-handler), so its
// self time can be broken down further than "pkc-js"
const ownModule = (modulePath: string): string =>
  modulePath
    .replace(/^.*?dist\/(node|browser)\//, '')
    .replace(/\.js$/, '')

export const frameOrigin = (url: string, lineNumber: number): {pkg: string; module?: string} => {
  if (!url) return {pkg: '(native)'}
  if (url.startsWith('node:')) return {pkg: '(node)'}
  let filePath = url
  try {
    if (url.startsWith('file://')) filePath = fileURLToPath(url)
  } catch (e) {
    // keep the url
  }
  const pkg = packageFromModulePath(filePath)
  if (!pkg) return {pkg: filePath.startsWith(rootPath) ? '(benchmark harness)' : '(other)'}
  if (/\/dist\/bundled\//.test(filePath)) {
    // innermost region containing the line wins
    let best: {pkg: string; module?: string} | undefined
    let bestSize = Infinity
    for (const [start, end, regionPackage, modulePath] of regionsOf(filePath, pkg)) {
      if (start > lineNumber) break
      if (end >= lineNumber && end - start < bestSize) {
        best = {pkg: regionPackage, ...(regionPackage === pkg ? {module: ownModule(modulePath)} : {})}
        bestSize = end - start
      }
    }
    return best ?? {pkg}
  }
  const inPackage = filePath.match(/\/dist\/(node|browser)\/.*$/)
  return {pkg, ...(pkg === pkcJsPackage && inPackage ? {module: ownModule(inPackage[0])} : {})}
}

const pkcJsPackage = '@pkcprotocol/pkc-js'

export const summarizeCpuProfile = (profile: CpuProfile, file?: string): CpuProfileSummary => {
  const nodesById = new Map(profile.nodes.map((node) => [node.id, node]))
  const selfMicros = new Map<number, number>()
  const samples = profile.samples ?? []
  const deltas = profile.timeDeltas ?? []
  // timeDeltas[i] is the time since the previous sample, so it belongs to sample i-1
  for (let i = 0; i < samples.length; i++) {
    const delta = deltas[i + 1] ?? 0
    selfMicros.set(samples[i]!, (selfMicros.get(samples[i]!) ?? 0) + Math.max(0, delta))
  }
  const byPackage: Record<string, number> = {}
  const byPkcJsModule: Record<string, number> = {}
  const byFunction = new Map<string, {name: string; package: string; selfMs: number}>()
  let total = 0
  for (const [id, micros] of selfMicros) {
    const node = nodesById.get(id)
    if (!node) continue
    const {functionName, url, lineNumber} = node.callFrame
    // the profiler's own bookkeeping frames
    const origin = ['(idle)', '(program)', '(garbage collector)'].includes(functionName)
      ? {pkg: functionName}
      : frameOrigin(url, lineNumber)
    const pkg = origin.pkg
    const ms = micros / 1000
    total += ms
    byPackage[pkg] = (byPackage[pkg] ?? 0) + ms
    if (pkg === pkcJsPackage) byPkcJsModule[origin.module ?? '(unknown)'] = (byPkcJsModule[origin.module ?? '(unknown)'] ?? 0) + ms
    const key = `${functionName}|${url}|${lineNumber}`
    const fn = byFunction.get(key) ?? {name: `${functionName || '(anonymous)'} ${path.basename(url)}:${lineNumber + 1}`, package: pkg, selfMs: 0}
    fn.selfMs += ms
    byFunction.set(key, fn)
  }
  const rounded = Object.fromEntries(
    Object.entries(byPackage)
      .sort((a, b) => b[1] - a[1])
      .map(([pkg, ms]) => [pkg, Number(ms.toFixed(1))]),
  )
  const topFunctions = [...byFunction.values()]
    .filter((fn) => !fn.package.startsWith('(idle') && fn.package !== '(program)')
    .sort((a, b) => b.selfMs - a.selfMs)
    .slice(0, 15)
    .map((fn) => ({...fn, selfMs: Number(fn.selfMs.toFixed(1))}))
  // file is relative to profiles/; CI uploads profiles/ per version, so the artifact holds it at
  // v<version>-<gitHead>/<file>
  const pkcJsSelfMsByModule = Object.fromEntries(
    Object.entries(byPkcJsModule)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 15)
      .map(([module, ms]) => [module, Number(ms.toFixed(1))]),
  )
  return {
    sampledTimeMs: Number(total.toFixed(1)),
    selfMsByPackage: rounded,
    pkcJsSelfMsByModule,
    topFunctions,
    ...(file ? {file: path.relative(profilesPath, file)} : {}),
  }
}

export const summarizeCpuProfileFile = (file: string): CpuProfileSummary =>
  summarizeCpuProfile(JSON.parse(fs.readFileSync(file, 'utf-8')) as CpuProfile, file)

export const slugify = (string: string): string =>
  string
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80)

// In-process profiling of the benchmark server (it hosts the local community). One at a time.
let session: inspector.Session | undefined

export const startInProcessProfile = async (): Promise<void> => {
  if (session) throw Error('a cpu profile is already running')
  session = new inspector.Session()
  session.connect()
  const post = (method: string, params?: object) =>
    new Promise<void>((resolve, reject) => session!.post(method, params ?? {}, (e) => (e ? reject(e) : resolve())))
  await post('Profiler.enable')
  await post('Profiler.setSamplingInterval', {interval: 1000})
  await post('Profiler.start')
}

export const stopInProcessProfile = async (label: string): Promise<CpuProfileSummary> => {
  if (!session) throw Error('no cpu profile is running')
  const current = session
  session = undefined
  const profile = await new Promise<CpuProfile>((resolve, reject) =>
    current.post('Profiler.stop', (e, result) => (e ? reject(e) : resolve((result as {profile: CpuProfile}).profile))),
  )
  current.disconnect()
  fs.mkdirSync(profilesPath, {recursive: true})
  const file = path.join(profilesPath, `${slugify(label)}-${Date.now()}.cpuprofile`)
  fs.writeFileSync(file, JSON.stringify(profile))
  return summarizeCpuProfile(profile, file)
}
