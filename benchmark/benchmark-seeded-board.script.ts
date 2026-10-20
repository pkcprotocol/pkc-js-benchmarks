import fs from 'fs-extra'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import PKC from '@pkcprotocol/pkc-js'
import benchmarkOptionsFile from '../benchmark-options.ts'
import {ensureBoardFixture, communityDbSizeBytes} from '../lib/board-fixture.ts'
import {startScriptMesh, kuboPkcOptions, withDeadline, cellDeadlineMs, saveProgress} from '../lib/script-mesh.ts'
import {startProcessMetrics} from '../lib/process-metrics.ts'
import {kuboRepoSizeBytes} from '../lib/kubo-nodes.ts'
import {getBenchmarkContext, median, writeReport} from '../lib/benchmark-client.ts'
import type {BenchmarkReport, SeededBoardBenchmarkOptions, SeededBoardMetrics} from '../types.ts'

// A local community on a pre-built board (lib/board-fixture.ts), driven only through the public API
// so it runs on every version: what does it cost to start on a big board, publish its first full
// record, and then turn one new post into a new record? This is the scenario pkc-js PR #346 measured
// (2k posts / 113k comments: 440s -> 23s per cycle) and issues #360, #361 and #386 track.
//
// A plain node script, not a vitest test: the community is the thing measured, so it runs alone in
// this process (its RSS, heap and CPU are this process's), it can be run under --cpu-prof for the
// profiled repetition, and an old version that crashes or runs out of memory takes only this cell
// down. Node only — a community does not run in a browser.

const benchmarkOptionsType = 'seededBoardBenchmarkOptions'
const rootPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const cellDir = path.join(rootPath, '.pkc-seeded-board')
const MB = 1024 * 1024
const round = (n: number, digits = 3) => Number(n.toFixed(digits))

const {options, reportName} = await getBenchmarkContext<SeededBoardBenchmarkOptions>(benchmarkOptionsType)
const spec = benchmarkOptionsFile.boardFixtures[options.fixture]
if (!spec) throw Error(`no board fixture named '${options.fixture}'`)

const beforeReportTimestamp = Date.now()
const deadline = Date.now() + cellDeadlineMs() - 60_000
const remainingMs = () => Math.max(1000, deadline - Date.now())
const board: SeededBoardMetrics = {
  createCommunityTimeSeconds: null,
  startTimeSeconds: null,
  startToFirstUpdateTimeSeconds: null,
  medianPostToRecordTimeSeconds: null,
  dbSizeMB: null,
  ipfsRepoGrowthMB: null,
}

let reported = false
const sampler = startProcessMetrics()
const report = async (error?: Error) => {
  if (reported) return
  reported = true
  if (error) board.error = {message: error.message}
  const entry: BenchmarkReport = {
    name: reportName,
    type: benchmarkOptionsType,
    timestamp: Date.now(),
    timeSeconds: (Date.now() - beforeReportTimestamp) / 1000,
    runtime: 'node',
    board,
    process: sampler.stop(),
  }
  await writeReport(entry)
  console.log(entry)
}

// whatever happens, report what was measured before it happened
process.on('unhandledRejection', (e) => console.log('unhandled rejection:', (e as Error)?.message ?? e))
const deadlineTimer = setTimeout(async () => {
  await report(Error(`cell wall-time cap reached`)).catch(() => {})
  process.exit(0)
}, remainingMs())
deadlineTimer.unref()

let mesh: Awaited<ReturnType<typeof startScriptMesh>> | undefined
try {
  const fixture = ensureBoardFixture(options.fixture, spec)
  board.fixturePostsCount = fixture.posts
  board.fixtureCommentsCount = fixture.comments
  console.log(`board fixture '${options.fixture}': ${fixture.posts} posts, ${fixture.comments} comments, built with pkc-js ${fixture.builtWith}`)

  fs.removeSync(cellDir)
  const dataPath = path.join(cellDir, 'pkc-data')
  fs.copySync(fixture.dataPath, dataPath)
  mesh = await startScriptMesh(path.join(cellDir, 'kubo'))

  const beforeCreate = Date.now()
  const pkc: any = await PKC(kuboPkcOptions(mesh.community, dataPath) as never)
  pkc.on('error', (e: Error) => console.log('community pkc error:', e.message))
  const community = await pkc.createCommunity({address: fixture.address})
  community.on('error', (e: Error) => console.log('community error:', e.message))
  board.createCommunityTimeSeconds = (Date.now() - beforeCreate) / 1000
  saveProgress({board})

  if (options.pages) {
    const beforeEdit = Date.now()
    // edit() replaces settings wholesale, so the pages go in next to the board's existing settings
    await withDeadline(community.edit({settings: {...community.settings, pages: options.pages}}), remainingMs(), 'edit settings.pages')
    board.settingsEditTimeSeconds = (Date.now() - beforeEdit) / 1000
    saveProgress({board})
  }

  const repoBefore = await kuboRepoSizeBytes(mesh.community)
  const beforeStart = Date.now()
  const firstUpdate = new Promise<void>((resolve) => community.once('update', () => resolve()))
  await withDeadline(community.start(), remainingMs(), 'community.start()')
  board.startTimeSeconds = (Date.now() - beforeStart) / 1000
  saveProgress({board})
  console.log(`start() resolved in ${board.startTimeSeconds}s, waiting for the first record...`)
  await withDeadline(firstUpdate, remainingMs(), 'the first published record')
  board.startToFirstUpdateTimeSeconds = (Date.now() - beforeStart) / 1000
  saveProgress({board})
  console.log(`first record after ${board.startToFirstUpdateTimeSeconds}s`)

  // steady state: one new post -> the first record whose lastPostCid is that post
  const publisherPkc: any = await PKC(kuboPkcOptions(mesh.publisher, path.join(cellDir, 'pkc-publisher')) as never)
  publisherPkc.on('error', (e: Error) => console.log('publisher pkc error:', e.message))
  board.steadyCycles = {}
  const cycles: number[] = []
  for (let i = 0; i < (options.steadySamples ?? 3); i++) {
    const key = `sample-${i + 1}`
    try {
      const post = await publisherPkc.createComment({
        signer: await publisherPkc.createSigner(),
        communityPublicKey: fixture.address,
        title: `pkc-js benchmark seeded-board post ${Date.now()}`,
        content: `pkc-js benchmark seeded-board post ${Date.now()}`,
      })
      const accepted = new Promise<string>((resolve, reject) => {
        post.once('challengeverification', (v: any) =>
          v.challengeSuccess ? resolve(post.cid ?? v.comment?.cid) : reject(Error(`rejected: ${v.reason ?? JSON.stringify(v.challengeErrors)}`)),
        )
      })
      await post.publish()
      const cid = await withDeadline(accepted, Math.min(remainingMs(), 300_000), 'the post to be accepted')
      const acceptedAt = Date.now()
      await withDeadline(
        new Promise<void>((resolve) => {
          const check = () => {
            if (community.lastPostCid !== cid) return
            community.removeListener('update', check)
            resolve()
          }
          community.on('update', check)
          check()
        }),
        remainingMs(),
        'a record with the new post',
      )
      const seconds = (Date.now() - acceptedAt) / 1000
      cycles.push(seconds)
      board.steadyCycles[key] = {postToRecordTimeSeconds: seconds}
      saveProgress({board})
      console.log(`steady cycle ${i + 1}: new post in a published record after ${seconds}s`)
      await post.stop().catch(() => {})
    } catch (e) {
      board.steadyCycles[key] = {postToRecordTimeSeconds: null, error: {message: (e as Error).message}}
      saveProgress({board})
      console.log(`steady cycle ${i + 1} failed: ${(e as Error).message}`)
      if (remainingMs() <= 1000) break
    }
  }
  board.medianPostToRecordTimeSeconds = median(cycles)

  const repoAfter = await kuboRepoSizeBytes(mesh.community)
  if (repoBefore !== null && repoAfter !== null) board.ipfsRepoGrowthMB = round((repoAfter - repoBefore) / MB, 2)
  board.dbSizeMB = round(communityDbSizeBytes(dataPath, fixture.address) / MB, 2)

  await community.stop().catch(() => {})
  await publisherPkc.destroy().catch(() => {})
  await pkc.destroy().catch(() => {})
  await report()
} catch (e) {
  console.log('seeded-board cell failed:', (e as Error).stack)
  await report(e as Error)
} finally {
  await mesh?.stop()
}
process.exit(0)
