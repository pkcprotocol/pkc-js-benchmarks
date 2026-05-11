import {test} from 'vitest'
import PKC from '@pkcprotocol/pkc-js'
import {buildPkcOptions} from '../lib/build-pkc-options.ts'
import type {CommentIdentifier, CommentListBenchmarkOptions, BenchmarkReport, CommentMetrics, Runtime} from '../types.ts'

const benchmarkOptionsType = 'fetchCommentBenchmarkOptions'
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
  const benchmarkOptions: CommentListBenchmarkOptions | null = await fetch(
    `${benchmarkServerUrl}/benchmark-options?benchmarkOptionsName=${benchmarkOptionsName}&benchmarkOptionsType=${benchmarkOptionsType}`,
  ).then((res) => res.json())
  if (!benchmarkOptions) {
    throw Error('failed fetching benchmarkOptions')
  }

  const pkc = await PKC(buildPkcOptions(benchmarkOptions.pkcOptions))
  pkc.on('error', (pkcErrorEvent: Error) => console.log('pkcErrorEvent:', pkcErrorEvent.message))

  const beforeReportTimestamp = Date.now()
  const reportComments: Record<string, CommentMetrics> = {}

  const fetchComment = ({cid: commentCid, communityName, communityPublicKey}: CommentIdentifier): Promise<void> =>
    new Promise(async (resolve) => {
      reportComments[commentCid] = {
        fetchCommentIpfsTimeSeconds: null,
        resolvingCommunityAddressTimeSeconds: null,
        fetchingCommentUpdateTimeSeconds: null,
      }
      let beforeTimestamp = Date.now()
      const comment = await (pkc as unknown as {
        createComment: (a: unknown) => Promise<{
          on: (e: string, h: (arg: any) => void) => void
          update: () => void
          stop: () => Promise<void>
          communityName?: string
          communityPublicKey?: string
          updatedAt?: number
        }>
      }).createComment({cid: commentCid, communityName, communityPublicKey})
      const getCommentUrlPath = () =>
        comment.communityName ? `p/${comment.communityName}/c/${commentCid}` : `c/${commentCid}`

      comment.on('error', (commentErrorEvent: Error) =>
        console.log('commentErrorEvent:', getCommentUrlPath(), commentErrorEvent.message),
      )
      comment.on('updatingstatechange', (updatingState: string) => {
        const metrics = reportComments[commentCid]!
        if (updatingState === 'fetching-ipfs') {
          beforeTimestamp = Date.now()
        }
        if (updatingState === 'resolving-community-address') {
          metrics.fetchCommentIpfsTimeSeconds = (Date.now() - beforeTimestamp) / 1000
          console.log(`fetched comment ipfs ${getCommentUrlPath()} in ${metrics.fetchCommentIpfsTimeSeconds}s`)
        }
        if (updatingState === 'fetching-community-ipns') {
          if (metrics.resolvingCommunityAddressTimeSeconds) return
          metrics.resolvingCommunityAddressTimeSeconds = (Date.now() - beforeTimestamp) / 1000
          console.log(
            `resolved community address ${getCommentUrlPath()} after ${metrics.resolvingCommunityAddressTimeSeconds}s`,
          )
        }
        if (updatingState === 'succeeded') {
          // pkc-js bug, should only be state 'succeeded' after comment.updatedAt is defined
          if (!comment.updatedAt) return
          metrics.fetchingCommentUpdateTimeSeconds = (Date.now() - beforeTimestamp) / 1000
          console.log(`fetched comment update ${getCommentUrlPath()} in ${metrics.fetchingCommentUpdateTimeSeconds}s`)
          resolve()
          comment.stop().catch(() => {})
        }
        if (updatingState === 'failed') {
          console.log(`failed fetching comment ${getCommentUrlPath()}`)
          resolve()
          comment.stop().catch(() => {})
        }
        if (updatingState === 'waiting-retry') {
          setTimeout(() => {
            console.log(`failed (waiting retry more than 10s)' fetching comment ${getCommentUrlPath()}`)
            resolve()
            comment.stop().catch(() => {})
          }, 10000)
        }
      })
      comment.update()

      setTimeout(() => {
        console.log(`failed fetching comment timed out 2min ${getCommentUrlPath()}`)
        resolve()
        comment.stop().catch(() => {})
      }, 1000 * 60 * 2)
    })

  const fetchComments = async () => {
    console.log('fetching comments...')
    const promises = benchmarkOptions.comments.map(fetchComment)
    await Promise.all(promises)
    console.log('done fetching comments')
  }

  const writeReport = async () => {
    const report: BenchmarkReport = {
      name: benchmarkOptions.name,
      type: benchmarkOptionsType,
      timestamp: Date.now(),
      timeSeconds: (Date.now() - beforeReportTimestamp) / 1000,
      runtime,
      comments: reportComments,
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

  await fetchComments()
  await writeReport()
  console.log(reportComments)
  console.log(benchmarkOptions.name, 'done')

  try {
    process.exit()
  } catch (e) {
    // browser: no process to exit
  }
})
