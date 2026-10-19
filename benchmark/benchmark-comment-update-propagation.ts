import {test} from 'vitest'
import PKC from '@pkcprotocol/pkc-js'
import {buildPkcOptions} from '../lib/build-pkc-options.ts'
import {startRuntimeMetrics} from '../lib/runtime-metrics.ts'
import {exitProcess, getBenchmarkContext, median, postToServer, writeReport} from '../lib/benchmark-client.ts'
import type {
  BenchmarkReport,
  CommentUpdatePropagationBenchmarkOptions,
  CommentUpdatePropagationMetrics,
} from '../types.ts'

// The READING client, sitting on a post of the harness's no-challenge community while the
// publishing client in the benchmark server (lib/local-community-host.ts) changes it:
//   1. an upvote from another author -> how long until this client sees upvoteCount go up
//   2. an edit by the post's author  -> how long until this client sees the edited content
// Both only become visible through a new CommentUpdate, so this times the community's publish loop
// reacting to a vote or an edit (it wakes on them since pkc-js v0.0.98) plus the reader's transport.

const benchmarkOptionsType = 'commentUpdatePropagationBenchmarkOptions'

interface HostPost {
  postCid: string
  communityPublicKey: string
}
interface HostUpdate {
  publishedAtMs: number
  publishTimeSeconds: number
}

test('benchmark', async () => {
  const {options, runtime, reportName} = await getBenchmarkContext<CommentUpdatePropagationBenchmarkOptions>(benchmarkOptionsType)
  const runtimeMetrics = await startRuntimeMetrics()
  const samples = options.samples ?? 3
  const sampleTimeoutMs = (options.sampleTimeoutSeconds ?? 180) * 1000

  const pkc: any = await PKC(buildPkcOptions(options.pkcOptions))
  pkc.on('error', (e: Error) => console.log('pkcErrorEvent:', e.message))

  const beforeReportTimestamp = Date.now()
  const updates: Record<string, CommentUpdatePropagationMetrics> = {}

  const waitFor = (post: any, predicate: () => boolean, timeoutMs: number, label: string): Promise<void> =>
    new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        post.removeListener?.('update', check)
        reject(Error(`timed out after ${timeoutMs / 1000}s waiting for ${label}`))
      }, timeoutMs)
      function check() {
        if (!predicate()) return
        clearTimeout(timer)
        post.removeListener?.('update', check)
        resolve()
      }
      post.on('update', check)
      check()
    })

  for (let sampleIndex = 0; sampleIndex < samples; sampleIndex++) {
    const metrics: CommentUpdatePropagationMetrics = {
      postInitialLoadTimeSeconds: null,
      votePublishTimeSeconds: null,
      votePropagationTimeSeconds: null,
      editPublishTimeSeconds: null,
      editPropagationTimeSeconds: null,
    }
    let key = `sample-${sampleIndex + 1}`
    updates[key] = metrics
    let post: any
    try {
      const hostPost = await postToServer<HostPost>('/local-community/post')
      delete updates[key]
      key = hostPost.postCid
      updates[key] = metrics
      post = await pkc.createComment({cid: hostPost.postCid, communityPublicKey: hostPost.communityPublicKey})
      post.on('error', (e: Error) => console.log('commentErrorEvent:', e.message))

      const beforeLoad = Date.now()
      await post.update()
      await waitFor(post, () => typeof post.updatedAt === 'number', sampleTimeoutMs, 'the post to load')
      metrics.postInitialLoadTimeSeconds = (Date.now() - beforeLoad) / 1000

      const upvotesBefore = post.upvoteCount ?? 0
      const vote = await postToServer<HostUpdate>('/local-community/vote', {postCid: hostPost.postCid})
      metrics.votePublishTimeSeconds = vote.publishTimeSeconds
      await waitFor(post, () => (post.upvoteCount ?? 0) > upvotesBefore, sampleTimeoutMs, 'the vote to show up')
      metrics.votePropagationTimeSeconds = (Date.now() - vote.publishedAtMs) / 1000
      console.log(`sample ${sampleIndex + 1}/${samples}: vote visible after ${metrics.votePropagationTimeSeconds}s`)

      const content = `pkc-js benchmark edited ${Date.now()}`
      const edit = await postToServer<HostUpdate>('/local-community/edit', {postCid: hostPost.postCid, content})
      metrics.editPublishTimeSeconds = edit.publishTimeSeconds
      await waitFor(post, () => post.content === content || post.edit?.content === content, sampleTimeoutMs, 'the edit to show up')
      metrics.editPropagationTimeSeconds = (Date.now() - edit.publishedAtMs) / 1000
      console.log(`sample ${sampleIndex + 1}/${samples}: edit visible after ${metrics.editPropagationTimeSeconds}s`)
    } catch (e) {
      metrics.error = {message: (e as Error).message}
      console.log(`  sample failed: ${(e as Error).message}`)
    } finally {
      await post?.stop().catch(() => {})
    }
  }

  const values = (k: keyof CommentUpdatePropagationMetrics) =>
    Object.values(updates)
      .map((m) => m[k])
      .filter((v): v is number => typeof v === 'number')
  const report: BenchmarkReport = {
    name: reportName,
    type: benchmarkOptionsType,
    timestamp: Date.now(),
    timeSeconds: (Date.now() - beforeReportTimestamp) / 1000,
    runtime,
    updates,
    aggregate: {
      medianVotePropagationTimeSeconds: median(values('votePropagationTimeSeconds')),
      medianEditPropagationTimeSeconds: median(values('editPropagationTimeSeconds')),
    },
    process: runtimeMetrics.stop(),
  }
  await writeReport(report)
  console.log(updates)
  console.log(options.name, 'done')
  await pkc.destroy().catch(() => {})
  exitProcess()
})
