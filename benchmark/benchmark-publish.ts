import {test} from 'vitest'
import PKC from '@pkcprotocol/pkc-js'
import {buildPkcOptions} from '../lib/build-pkc-options.ts'
import type {PublishBenchmarkOptions, BenchmarkReport, CommunityMetrics, Runtime} from '../types.ts'

const benchmarkOptionsType = 'publishBenchmarkOptions'
const benchmarkServerUrl = 'http://127.0.0.1:3000'

declare const window: {benchmarkOptionsName?: string} | undefined

// fix unknown bug with viem in browser, that starts a new websocket connection per request
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

const publishChallengeAnswerDelay = 1000 * 10

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
  const benchmarkOptions: PublishBenchmarkOptions | null = await fetch(
    `${benchmarkServerUrl}/benchmark-options?benchmarkOptionsName=${benchmarkOptionsName}&benchmarkOptionsType=${benchmarkOptionsType}`,
  ).then((res) => res.json())
  if (!benchmarkOptions) {
    throw Error('failed fetching benchmarkOptions')
  }

  const pkc = await PKC(buildPkcOptions(benchmarkOptions.pkcOptions))
  pkc.on('error', (pkcErrorEvent: Error) => console.log('pkcErrorEvent:', pkcErrorEvent.message))

  const beforeReportTimestamp = Date.now()
  const reportPublish: Record<string, CommunityMetrics> = {}

  const publishComment = (communityAddress: string): Promise<void> =>
    new Promise(async (resolve) => {
      reportPublish[communityAddress] = {
        resolvingAddressTimeSeconds: null,
        fetchingIpnsTimeSeconds: null,
        challengeRequestTimeSeconds: null,
        challengeTimeSeconds: null,
        challengeAnswerTimeSeconds: null,
        challengeVerificationTimeSeconds: null,
      }
      let beforeTimestamp = 0

      const getRandomString = () => (Math.random() + 1).toString(36).replace('.', '')
      const signer = await (pkc as unknown as {createSigner: () => Promise<unknown>}).createSigner()
      const comment = await (pkc as unknown as {
        createComment: (a: unknown) => Promise<{
          on: (e: string, h: (arg: any) => void) => void
          once: (e: string, h: (arg: any) => void) => void
          publish: () => void
          publishChallengeAnswers: (a: string[]) => void
          stop: () => Promise<void>
        }>
      }).createComment({
        signer,
        communityAddress,
        title: `I am the pkc-js benchmark ${getRandomString()}`,
        content: `I am the pkc-js benchmark ${getRandomString()}`,
      })
      comment.on('error', (commentErrorEvent: Error) =>
        console.log('commentErrorEvent:', communityAddress, commentErrorEvent.message),
      )
      comment.once('challenge', async () => {
        reportPublish[communityAddress]!.challengeTimeSeconds = (Date.now() - beforeTimestamp) / 1000
        console.log(
          `received challenge ${communityAddress} in ${reportPublish[communityAddress]!.challengeTimeSeconds}s`,
        )

        console.log(`waiting ${publishChallengeAnswerDelay / 1000}s before publishing challenge answer...`)
        await new Promise((r) => setTimeout(r, publishChallengeAnswerDelay))
        beforeTimestamp += publishChallengeAnswerDelay
        comment.publishChallengeAnswers(['pkc-js benchmark wrong answer'])
      })
      comment.once('challengeverification', () => {
        reportPublish[communityAddress]!.challengeVerificationTimeSeconds =
          (Date.now() - beforeTimestamp) / 1000
        console.log(
          `received challenge verification ${communityAddress} in ${reportPublish[communityAddress]!.challengeVerificationTimeSeconds}s`,
        )
        resolve()
        comment.stop().catch(() => {})
      })
      comment.on('publishingstatechange', (publishingState: string) => {
        const metrics = reportPublish[communityAddress]!
        if (publishingState === 'resolving-community-address') {
          beforeTimestamp = Date.now()
        }
        if (publishingState === 'fetching-community-ipns') {
          if (metrics.resolvingAddressTimeSeconds) return
          metrics.resolvingAddressTimeSeconds = (Date.now() - beforeTimestamp) / 1000
          console.log(`resolved address ${communityAddress} in ${metrics.resolvingAddressTimeSeconds}s`)
        }
        if (publishingState === 'fetching-community-ipfs') {
          if (metrics.fetchingIpnsTimeSeconds) return
          metrics.fetchingIpnsTimeSeconds = (Date.now() - beforeTimestamp) / 1000
          console.log(`fetched ipns ${communityAddress} in ${metrics.fetchingIpnsTimeSeconds}s`)
        }
        if (publishingState === 'publishing-challenge-request') {
          if (metrics.fetchingIpnsTimeSeconds) {
            metrics.fetchingIpfsTimeSeconds = (Date.now() - beforeTimestamp) / 1000
            console.log(`fetched ipfs ${communityAddress} in ${metrics.fetchingIpfsTimeSeconds}s`)
          } else {
            metrics.fetchingIpnsTimeSeconds = (Date.now() - beforeTimestamp) / 1000
            console.log(`fetched ipns ${communityAddress} in ${metrics.fetchingIpnsTimeSeconds}s`)
          }
          beforeTimestamp = Date.now()
        }
        if (publishingState === 'waiting-challenge') {
          metrics.challengeRequestTimeSeconds = (Date.now() - beforeTimestamp) / 1000
          console.log(`published challenge request ${communityAddress} in ${metrics.challengeRequestTimeSeconds}s`)
        }
        if (publishingState === 'waiting-challenge-verification') {
          metrics.challengeAnswerTimeSeconds = (Date.now() - beforeTimestamp) / 1000
          console.log(`published challenge answer ${communityAddress} in ${metrics.challengeAnswerTimeSeconds}s`)
        }
        if (publishingState === 'failed') {
          // pkc-js bug, events aren't emitted in correct order so wait 100ms for all of them
          setTimeout(() => {
            console.log(`failed publish ${communityAddress}`)
            resolve()
            comment.stop().catch(() => {})
          }, 100)
        }
        if (publishingState === 'waiting-retry') {
          setTimeout(() => {
            console.log(`failed (waiting retry more than 10s)' publish ${communityAddress}`)
            resolve()
            comment.stop().catch(() => {})
          }, 10000)
        }
      })
      comment.publish()

      setTimeout(() => {
        console.log(`failed publish timed out 2min ${communityAddress}`)
        resolve()
        comment.stop().catch(() => {})
      }, 1000 * 60 * 2)
    })

  const publish = async () => {
    console.log('publishing...')
    await publishComment(benchmarkOptions.communityAddress)
    console.log('done publishing')
  }

  const writeReport = async () => {
    const report: BenchmarkReport = {
      name: benchmarkOptions.name,
      type: benchmarkOptionsType,
      timestamp: Date.now(),
      timeSeconds: (Date.now() - beforeReportTimestamp) / 1000,
      runtime,
      communities: reportPublish,
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

  await publish()
  await writeReport()
  console.log(reportPublish)
  console.log(benchmarkOptions.name, 'done')

  try {
    process.exit()
  } catch (e) {
    // browser: no process to exit
  }
})
