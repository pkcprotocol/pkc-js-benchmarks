import fs from 'fs-extra'
import path from 'node:path'
import v8 from 'node:v8'
import vm from 'node:vm'
import {fileURLToPath} from 'node:url'
import PKC from '@pkcprotocol/pkc-js'
import {startScriptMesh, kuboPkcOptions, withDeadline, cellDeadlineMs} from '../lib/script-mesh.ts'
import {startProcessMetrics} from '../lib/process-metrics.ts'
import {kuboRepoGc} from '../lib/kubo-nodes.ts'
import {getBenchmarkContext, median, writeReport} from '../lib/benchmark-client.ts'
import type {BenchmarkReport, SoakBenchmarkOptions, SoakMetrics} from '../types.ts'

// One local community taking a steady trickle of publications (posts and replies) for many minutes,
// which is what a real community does all day and what no short cell sees:
//   - heap after a forced GC, sampled as publications accumulate: its slope is what each
//     publication leaves behind (a leak shows up as a slope that never flattens)
//   - kubo `repo gc` on the community's node, and the first publish cycle that has to run after it
//     (an hourly gc stalled a 1M-comment board's cycle for 144s, pkc-js issue #386)
//   - community.delete() at the end
// Scheduled weekly (.github/workflows/benchmark-soak.yml), never on the release path.

const benchmarkOptionsType = 'soakBenchmarkOptions'
const rootPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const cellDir = path.join(rootPath, '.pkc-soak')
const MB = 1024 * 1024
const round = (n: number, digits = 2) => Number(n.toFixed(digits))

v8.setFlagsFromString('--expose_gc')
const gc = vm.runInNewContext('gc') as () => void
const heapAfterGc = () => {
  gc()
  return process.memoryUsage().heapUsed
}

// least-squares slope of y over x
const slope = (points: [number, number][]): number | null => {
  if (points.length < 2) return null
  const n = points.length
  const mx = points.reduce((s, [x]) => s + x, 0) / n
  const my = points.reduce((s, [, y]) => s + y, 0) / n
  const sxx = points.reduce((s, [x]) => s + (x - mx) ** 2, 0)
  return sxx ? points.reduce((s, [x, y]) => s + (x - mx) * (y - my), 0) / sxx : null
}

const {options, reportName} = await getBenchmarkContext<SoakBenchmarkOptions>(benchmarkOptionsType)
const beforeReportTimestamp = Date.now()
const deadline = Date.now() + cellDeadlineMs() - 60_000
const remainingMs = () => Math.max(1000, deadline - Date.now())
const soak: SoakMetrics = {publicationsCount: 0, failedPublicationsCount: 0}
const sampler = startProcessMetrics()
process.on('unhandledRejection', (e) => console.log('unhandled rejection:', (e as Error)?.message ?? e))

const waitForRecordWith = (community: any, postCid: string, timeoutMs: number) =>
  withDeadline(
    new Promise<void>((resolve) => {
      const check = () => {
        if (community.lastPostCid !== postCid) return
        community.removeListener('update', check)
        resolve()
      }
      community.on('update', check)
      check()
    }),
    timeoutMs,
    'a record with the new post',
  )

let mesh: Awaited<ReturnType<typeof startScriptMesh>> | undefined
try {
  fs.removeSync(cellDir)
  mesh = await startScriptMesh(path.join(cellDir, 'kubo'))
  const pkc: any = await PKC(kuboPkcOptions(mesh.community, path.join(cellDir, 'pkc-community')) as never)
  pkc.on('error', (e: Error) => console.log('community pkc error:', e.message))
  const community = await pkc.createCommunity({signer: await pkc.createSigner()})
  await community.edit({settings: {challenges: []}})
  await community.start()
  await new Promise((resolve) => community.once('update', resolve))
  const publisher: any = await PKC(kuboPkcOptions(mesh.publisher, path.join(cellDir, 'pkc-publisher')) as never)
  publisher.on('error', (e: Error) => console.log('publisher pkc error:', e.message))

  const publish = async (fields: Record<string, unknown>): Promise<string> => {
    const publication = await publisher.createComment({
      signer: await publisher.createSigner(),
      communityPublicKey: community.publicKey ?? community.address,
      content: `pkc-js benchmark soak ${Date.now()}`,
      ...fields,
    })
    const accepted = new Promise<string>((resolve, reject) =>
      publication.once('challengeverification', (v: any) =>
        v.challengeSuccess ? resolve(publication.cid ?? v.comment?.cid) : reject(Error(`rejected: ${v.reason}`)),
      ),
    )
    await publication.publish()
    const cid = await withDeadline(accepted, 120_000, 'publication')
    await publication.stop().catch(() => {})
    return cid
  }

  const heapPoints: [number, number][] = []
  const rssStart = process.memoryUsage().rss
  heapPoints.push([0, heapAfterGc()])
  soak.heapAfterGcStartMB = round(heapPoints[0]![1] / MB)
  soak.rssStartMB = round(rssStart / MB)

  const posts: string[] = []
  const postToRecord: number[] = []
  const intervalMs = 60_000 / options.publicationsPerMinute
  const soakEnd = Math.min(Date.now() + options.minutes * 60_000, deadline - 10 * 60_000)
  while (Date.now() < soakEnd) {
    const tickStart = Date.now()
    try {
      // every fourth publication is a post, the rest reply to a recent post
      if (posts.length === 0 || soak.publicationsCount! % 4 === 0) {
        const cid = await publish({title: `pkc-js benchmark soak post ${posts.length + 1}`})
        posts.push(cid)
        const acceptedAt = Date.now()
        await waitForRecordWith(community, cid, 300_000)
        postToRecord.push((Date.now() - acceptedAt) / 1000)
      } else {
        const postCid = posts[Math.max(0, posts.length - 1 - (soak.publicationsCount! % 5))]!
        await publish({parentCid: postCid, postCid})
      }
      soak.publicationsCount!++
    } catch (e) {
      soak.failedPublicationsCount!++
      console.log('soak publication failed:', (e as Error).message)
    }
    if (soak.publicationsCount! % 20 === 0) {
      heapPoints.push([soak.publicationsCount!, heapAfterGc()])
      console.log(`soak: ${soak.publicationsCount} publications, heap after gc ${round(heapPoints.at(-1)![1] / MB)}MB`)
    }
    await new Promise((r) => setTimeout(r, Math.max(0, intervalMs - (Date.now() - tickStart))))
  }
  heapPoints.push([soak.publicationsCount!, heapAfterGc()])
  soak.heapAfterGcEndMB = round(heapPoints.at(-1)![1] / MB)
  soak.rssEndMB = round(process.memoryUsage().rss / MB)
  const heapSlope = slope(heapPoints)
  soak.heapGrowthPerPublicationBytes = heapSlope === null ? null : Math.round(heapSlope)
  soak.medianPostToRecordTimeSeconds = median(postToRecord)

  const beforeGc = Date.now()
  await kuboRepoGc(mesh.community, remainingMs())
  soak.repoGcTimeSeconds = (Date.now() - beforeGc) / 1000
  const afterGcPost = await publish({title: 'pkc-js benchmark soak post after repo gc'})
  const acceptedAt = Date.now()
  await waitForRecordWith(community, afterGcPost, remainingMs())
  soak.postToRecordAfterRepoGcTimeSeconds = (Date.now() - acceptedAt) / 1000

  await publisher.destroy().catch(() => {})
  const beforeDelete = Date.now()
  await withDeadline(community.delete(), remainingMs(), 'community.delete()')
  soak.deleteTimeSeconds = (Date.now() - beforeDelete) / 1000
  await pkc.destroy().catch(() => {})
} catch (e) {
  console.log('soak cell failed:', (e as Error).message)
  soak.error = {message: (e as Error).message}
} finally {
  await mesh?.stop()
}

const report: BenchmarkReport = {
  name: reportName,
  type: benchmarkOptionsType,
  timestamp: Date.now(),
  timeSeconds: (Date.now() - beforeReportTimestamp) / 1000,
  runtime: 'node',
  soak,
  process: sampler.stop(),
}
await writeReport(report)
console.log(report)
process.exit(0)
