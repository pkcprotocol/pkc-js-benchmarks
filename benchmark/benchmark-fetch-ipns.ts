import {test} from 'vitest'
import PKC from '@pkcprotocol/pkc-js'
import {buildPkcOptions} from '../lib/build-pkc-options.ts'
import type {CommunityIdentifier, CommunityListBenchmarkOptions, BenchmarkReport, CommunityMetrics, Runtime} from '../types.ts'

const benchmarkOptionsType = 'fetchIpnsBenchmarkOptions'
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
  const benchmarkOptions: CommunityListBenchmarkOptions | null = await fetch(
    `${benchmarkServerUrl}/benchmark-options?benchmarkOptionsName=${benchmarkOptionsName}&benchmarkOptionsType=${benchmarkOptionsType}`,
  ).then((res) => res.json())
  if (!benchmarkOptions) {
    throw Error('failed fetching benchmarkOptions')
  }

  const pkc = await PKC(buildPkcOptions(benchmarkOptions.pkcOptions))
  pkc.on('error', (pkcErrorEvent: Error) => console.log('pkcErrorEvent:', pkcErrorEvent.message))

  const beforeReportTimestamp = Date.now()
  const reportCommunities: Record<string, CommunityMetrics> = {}

  const fetchCommunity = ({name: communityName, publicKey: communityPublicKey}: CommunityIdentifier): Promise<void> =>
    new Promise(async (resolve) => {
      reportCommunities[communityName] = {
        resolvingAddressTimeSeconds: null,
        fetchingIpnsTimeSeconds: null,
      }
      let beforeTimestamp = 0
      const community = await (pkc as unknown as {
        createCommunity: (a: unknown) => Promise<{
          on: (e: string, h: (arg: any) => void) => void
          update: () => void
          stop: () => Promise<void>
        }>
      }).createCommunity({name: communityName, publicKey: communityPublicKey})
      community.on('error', (communityErrorEvent: Error) =>
        console.log('communityErrorEvent:', communityName, communityErrorEvent.message),
      )
      community.on('updatingstatechange', (updatingState: string) => {
        const metrics = reportCommunities[communityName]!
        if (updatingState === 'resolving-address') {
          beforeTimestamp = Date.now()
        }
        if (updatingState === 'fetching-ipns') {
          if (metrics.resolvingAddressTimeSeconds) return
          metrics.resolvingAddressTimeSeconds = (Date.now() - beforeTimestamp) / 1000
          console.log(`resolved address ${communityName} in ${metrics.resolvingAddressTimeSeconds}s`)
        }
        if (updatingState === 'fetching-ipfs') {
          if (metrics.fetchingIpnsTimeSeconds) return
          metrics.fetchingIpnsTimeSeconds = (Date.now() - beforeTimestamp) / 1000
          console.log(`fetched ipns ${communityName} in ${metrics.fetchingIpnsTimeSeconds}s`)
        }
        if (updatingState === 'succeeded') {
          if (metrics.fetchingIpnsTimeSeconds) {
            metrics.fetchingIpfsTimeSeconds = (Date.now() - beforeTimestamp) / 1000
            console.log(`fetched ipfs ${communityName} in ${metrics.fetchingIpfsTimeSeconds}s`)
          } else {
            metrics.fetchingIpnsTimeSeconds = (Date.now() - beforeTimestamp) / 1000
            console.log(`fetched ipns ${communityName} in ${metrics.fetchingIpnsTimeSeconds}s`)
          }
          resolve()
          community.stop().catch(() => {})
        }
        if (updatingState === 'failed') {
          console.log(`failed fetching ipns ${communityName}`)
          resolve()
          community.stop().catch(() => {})
        }
        if (updatingState === 'waiting-retry') {
          setTimeout(() => {
            console.log(`failed (waiting retry more than 10s)' fetching ipns ${communityName}`)
            resolve()
            community.stop().catch(() => {})
          }, 10000)
        }
      })
      community.update()

      setTimeout(() => {
        console.log(`failed fetching ipns timed out 2min ${communityName}`)
        resolve()
        community.stop().catch(() => {})
      }, 1000 * 60 * 2)
    })

  const fetchCommunities = async () => {
    console.log('fetching communities...')
    const promises = benchmarkOptions.communities.map(fetchCommunity)
    await Promise.all(promises)
    console.log('done fetching communities')
  }

  const writeReport = async () => {
    const report: BenchmarkReport = {
      name: benchmarkOptions.name,
      type: benchmarkOptionsType,
      timestamp: Date.now(),
      timeSeconds: (Date.now() - beforeReportTimestamp) / 1000,
      runtime,
      communities: reportCommunities,
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

  await fetchCommunities()
  await writeReport()
  console.log(reportCommunities)
  console.log(benchmarkOptions.name, 'done')

  try {
    process.exit()
  } catch (e) {
    // browser: no process to exit
  }
})
