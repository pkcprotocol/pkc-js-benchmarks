import {test} from 'vitest'
import PKC from '@pkcprotocol/pkc-js'
import {buildPkcOptions} from '../lib/build-pkc-options.ts'
import type {ReplyPropagationBenchmarkOptions, BenchmarkReport, ReplyPropagationMetrics, Runtime} from '../types.ts'

// The READING client. The community and the publishing client run in the benchmark server (see
// lib/reply-propagation-host.ts), so the publisher really is a separate process with its own PKC
// and its own kubo node — this file only ever reads.
//
// One sample: ask the server for a fresh post -> update() it here until its first CommentUpdate
// lands -> ask the server to publish a reply -> measure from "the community accepted the reply"
// to "the reply is visible here".

const benchmarkOptionsType = 'replyPropagationBenchmarkOptions'
const benchmarkServerUrl = 'http://127.0.0.1:3000'

declare const window: {benchmarkOptionsName?: string} | undefined

try {
  const w = (globalThis as unknown as {window?: {WebSocket: typeof WebSocket}}).window
  if (w) {
    const OriginalWebSocket = w.WebSocket
    w.WebSocket = function (url: string | URL, protocols?: string | string[]) {
      return new OriginalWebSocket(url, protocols)
    } as unknown as typeof WebSocket
  }
} catch (e) {
  // not in a browser
}

interface HostPost {
  postCid: string
  communityAddress: string
  communityPublicKey: string
  communitySwarmMultiaddr: string
}
interface HostReply {
  replyCid: string
  publishedAtMs: number
  replyPublishTimeSeconds: number
}

const postToServer = async <T>(path: string, body?: unknown): Promise<T> => {
  const res = await fetch(`${benchmarkServerUrl}${path}`, {
    method: 'POST',
    body: JSON.stringify(body ?? {}),
    headers: {'Content-Type': 'application/json'},
  })
  const json = (await res.json()) as T & {error?: {message: string}}
  if (!res.ok || json?.error) throw Error(`${path} failed: ${json?.error?.message ?? res.status}`)
  return json
}

test('benchmark', async () => {
  let benchmarkOptionsName: string | undefined
  let runtime: Runtime
  if (typeof window !== 'undefined' && window?.benchmarkOptionsName) {
    benchmarkOptionsName = window.benchmarkOptionsName
    runtime = 'chrome'
  } else {
    benchmarkOptionsName =
      process.env.BENCHMARK_OPTIONS_NAME ||
      (process.argv.includes('--benchmarkOptionsName')
        ? process.argv[process.argv.indexOf('--benchmarkOptionsName') + 1]
        : undefined)
    runtime = 'node'
  }
  if (!benchmarkOptionsName) {
    throw Error('missing benchmarkOptionsName')
  }
  const benchmarkOptions: ReplyPropagationBenchmarkOptions | null = await fetch(
    `${benchmarkServerUrl}/benchmark-options?benchmarkOptionsName=${benchmarkOptionsName}&benchmarkOptionsType=${benchmarkOptionsType}`,
  ).then((res) => res.json())
  if (!benchmarkOptions) {
    throw Error('failed fetching benchmarkOptions')
  }
  const samples = benchmarkOptions.samples ?? 3
  const sampleTimeoutMs = (benchmarkOptions.sampleTimeoutSeconds ?? 180) * 1000

  const pkc = await PKC(buildPkcOptions(benchmarkOptions.pkcOptions))
  pkc.on('error', (pkcErrorEvent: Error) => console.log('pkcErrorEvent:', pkcErrorEvent.message))

  const beforeReportTimestamp = Date.now()
  const reportReplies: Record<string, ReplyPropagationMetrics> = {}

  // Has the reply reached this client? The CommentUpdate carries replyCount plus either a
  // preloaded replies page or page cids; a page cid still has to be fetched before a UI could
  // show the reply, so fetching it is part of the propagation time we're measuring.
  const findReplyInPages = async (post: any, replyCid: string): Promise<boolean> => {
    if ((post.replyCount ?? 0) < 1) return false
    const containsReply = (comments: any[] = []): boolean =>
      comments.some(
        (comment) =>
          comment?.cid === replyCid ||
          Object.values(comment?.replies?.pages ?? {}).some((page: any) => containsReply(page?.comments)),
      )
    for (const page of Object.values(post.replies?.pages ?? {}) as any[]) {
      if (containsReply(page?.comments)) return true
    }
    for (const pageCid of Object.values(post.replies?.pageCids ?? {}) as string[]) {
      try {
        const page = await post.replies.getPage({cid: pageCid})
        if (containsReply(page?.comments)) return true
      } catch (e) {
        // page not fetchable yet
      }
    }
    return false
  }

  const waitFor = (post: any, predicate: () => Promise<boolean>, timeoutMs: number, label: string): Promise<void> =>
    new Promise<void>((resolve, reject) => {
      let checking = false
      const timer = setTimeout(() => {
        post.removeListener?.('update', check)
        reject(Error(`timed out after ${timeoutMs / 1000}s waiting for ${label}`))
      }, timeoutMs)
      const done = () => {
        clearTimeout(timer)
        post.removeListener?.('update', check)
        resolve()
      }
      async function check() {
        if (checking) return
        checking = true
        try {
          if (await predicate()) done()
        } catch (e) {
          console.log(`error while waiting for ${label}:`, (e as Error).message)
        } finally {
          checking = false
        }
      }
      post.on('update', check)
      check()
    })

  const measureSample = async (sampleIndex: number): Promise<void> => {
    const metrics: ReplyPropagationMetrics = {
      postInitialLoadTimeSeconds: null,
      replyPublishTimeSeconds: null,
      replyPropagationTimeSeconds: null,
      replyTotalTimeSeconds: null,
    }
    // keyed by post cid once we have one, so a sample that never got that far is still reported
    let metricsKey = `sample-${sampleIndex + 1}`
    reportReplies[metricsKey] = metrics
    let post: any
    try {
      const hostPost = await postToServer<HostPost>('/reply-propagation/post', {benchmarkOptionsName})
      console.log(`sample ${sampleIndex + 1}/${samples}: post ${hostPost.postCid} on community ${hostPost.communityAddress}`)
      delete reportReplies[metricsKey]
      metricsKey = hostPost.postCid
      reportReplies[metricsKey] = metrics

      post = await (pkc as unknown as {createComment: (a: unknown) => Promise<any>}).createComment({
        cid: hostPost.postCid,
        communityPublicKey: hostPost.communityPublicKey,
      })
      post.on('error', (commentErrorEvent: Error) => console.log('commentErrorEvent:', (commentErrorEvent as Error).message))
      post.on('updatingstatechange', (updatingState: string) => console.log(`  updatingstate: ${updatingState}`))

      // 1. this client sits on the post, exactly like a user with the thread open
      const beforeLoadTimestamp = Date.now()
      await post.update()
      await waitFor(post, async () => typeof post.updatedAt === 'number', sampleTimeoutMs, 'the post to load')
      metrics.postInitialLoadTimeSeconds = (Date.now() - beforeLoadTimestamp) / 1000
      console.log(`  loaded post in ${metrics.postInitialLoadTimeSeconds}s (replyCount=${post.replyCount ?? 0})`)

      // 2. the other client publishes a reply, and it succeeds
      const hostReply = await postToServer<HostReply>('/reply-propagation/reply', {
        benchmarkOptionsName,
        postCid: hostPost.postCid,
      })
      metrics.replyPublishTimeSeconds = hostReply.replyPublishTimeSeconds
      console.log(`  other client published reply ${hostReply.replyCid} in ${hostReply.replyPublishTimeSeconds}s`)

      // 3. how long until this client can see it
      await waitFor(post, () => findReplyInPages(post, hostReply.replyCid), sampleTimeoutMs, 'the reply to show up')
      metrics.replyPropagationTimeSeconds = (Date.now() - hostReply.publishedAtMs) / 1000
      metrics.replyTotalTimeSeconds = metrics.replyPropagationTimeSeconds + hostReply.replyPublishTimeSeconds
      console.log(`  reply visible ${metrics.replyPropagationTimeSeconds}s after it was accepted`)
    } catch (e) {
      metrics.error = {message: (e as Error).message}
      console.log(`  sample failed: ${(e as Error).message}`)
    } finally {
      await post?.stop().catch(() => {})
    }
  }

  const writeReport = async () => {
    const report: BenchmarkReport = {
      name: benchmarkOptions.name,
      type: benchmarkOptionsType,
      timestamp: Date.now(),
      timeSeconds: (Date.now() - beforeReportTimestamp) / 1000,
      runtime,
      replies: reportReplies,
    }
    const res = await fetch(`${benchmarkServerUrl}/report`, {
      method: 'POST',
      body: JSON.stringify(report),
      headers: {'Content-Type': 'application/json'},
    })
    if (res.status !== 200) {
      throw Error('failed writing report')
    }
  }

  for (let sampleIndex = 0; sampleIndex < samples; sampleIndex++) {
    await measureSample(sampleIndex)
  }
  await writeReport()
  console.log(reportReplies)
  console.log(benchmarkOptions.name, 'done')

  try {
    process.exit()
  } catch (e) {
    // browser: no process to exit
  }
})
