import {test} from 'vitest'
import PKC from '@pkcprotocol/pkc-js'
import {buildPkcOptions} from '../lib/build-pkc-options.ts'
import {discoverCommunities, runPool} from '../lib/discover-communities.ts'
import type {
  CommunityIdentifier,
  LoadCommunitiesBenchmarkOptions,
  BenchmarkReport,
  CommunityMetrics,
  NetSnapshot,
  Runtime,
} from '../types.ts'

// load-communities benchmark — mirrors investigate_why_5chan_p2p_is_slow inside this harness.
// Discovers every production 5chan board live from GitHub (nothing hardcoded), loads them in
// parallel over Helia/libp2p-js, and instruments where the time goes: per-community total +
// per-phase timing, and the peer/transport breakdown (how many connected peers a real browser
// can use: wss/webtransport/webrtc) plus how many provider addrs are undialable from a browser.
//
// Runtime is the orthogonal axis of the matrix: this exact file runs in Node AND in real
// Chromium (via @vitest/browser-playwright). In Chromium the browser itself can't dial
// tcp/quic; in Node the optional connectionGater (countNonBrowserDials) simulates that, so the
// node cell behaves like the reference's BROWSER=1 mode.

const benchmarkOptionsType = 'loadCommunitiesBenchmarkOptions'
const benchmarkServerUrl = 'http://127.0.0.1:3000'

declare const window: {benchmarkOptionsName?: string} | undefined

// ---- transport classification (ported from the reference) ----------------------

const transportOf = (maStr: string): string => {
  if (maStr.includes('/webrtc')) return 'webrtc' // webrtc + webrtc-direct
  if (maStr.includes('/webtransport')) return 'webtransport'
  if (maStr.includes('/wss') || maStr.includes('/tls/ws')) return 'wss'
  if (maStr.includes('/ws')) return 'ws'
  if (maStr.includes('/quic')) return 'quic'
  if (maStr.includes('/tcp')) return 'tcp'
  return 'other'
}

// A browser can only dial secure WebSocket, WebTransport, or WebRTC. Everything else
// (raw tcp, quic-v1 without webtransport, insecure ws) is unreachable from a browser tab.
const browserCanDial = (maStr: string): boolean =>
  maStr.includes('/webrtc') || maStr.includes('/webtransport') || maStr.includes('/wss') || maStr.includes('/tls/ws')

// Snapshot the live libp2p node: peer count, transport breakdown, browser-usable count.
// Guarded by the caller — degrades to nulls if the internal shape differs.
const snapshot = (libp2p: any): NetSnapshot => {
  const conns = libp2p.getConnections()
  const byTransport: Record<string, number> = {}
  let browserUsablePeers = 0
  for (const conn of conns) {
    const t = transportOf(conn.remoteAddr.toString())
    byTransport[t] = (byTransport[t] ?? 0) + 1
    if (t === 'wss' || t === 'webtransport' || t === 'webrtc') browserUsablePeers++
  }
  return {peers: conns.length, browserUsablePeers, byTransport}
}

const emptyNet: NetSnapshot = {peers: 0, browserUsablePeers: 0, byTransport: {}}
const safeSnapshot = (libp2p: any): NetSnapshot => {
  try {
    if (!libp2p?.getConnections) return emptyNet
    return snapshot(libp2p)
  } catch {
    return emptyNet
  }
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
  const benchmarkOptions: LoadCommunitiesBenchmarkOptions | null = await fetch(
    `${benchmarkServerUrl}/benchmark-options?benchmarkOptionsName=${benchmarkOptionsName}&benchmarkOptionsType=${benchmarkOptionsType}`,
  ).then((res) => res.json())
  if (!benchmarkOptions) {
    throw Error('failed fetching benchmarkOptions')
  }

  const concurrency = benchmarkOptions.concurrency ?? 4

  // discover the board list live from GitHub (no hardcoded communities)
  let communities = await discoverCommunities(benchmarkOptions.listsBaseUrl)
  const discoveredCount = communities.length
  if (benchmarkOptions.limit && benchmarkOptions.limit > 0) {
    communities = communities.slice(0, benchmarkOptions.limit)
  }

  // Build the PKC input. In CHROME, countNonBrowserDials attaches a libp2p connectionGater
  // that counts and denies provider addresses a browser cannot dial — the gater is a function
  // so it cannot pass through the JSON options server; it must be attached here, client-side.
  // In NODE we deliberately do NOT gate: node is the all-transports baseline (tcp/quic allowed),
  // so it loads communities over whatever transport works, the way a non-browser peer would.
  const pkcInput = buildPkcOptions(benchmarkOptions.pkcOptions) as {
    libp2pJsClientsOptions?: Array<{key: string; libp2pOptions?: any}>
  }
  const deniedDials = {count: 0, byTransport: {} as Record<string, number>}
  const libp2pKey = pkcInput.libp2pJsClientsOptions?.[0]?.key
  const gateBrowserDials = !!benchmarkOptions.countNonBrowserDials && runtime === 'chrome'
  if (gateBrowserDials && pkcInput.libp2pJsClientsOptions?.[0]) {
    const client = pkcInput.libp2pJsClientsOptions[0]
    client.libp2pOptions = {
      ...(client.libp2pOptions ?? {}),
      connectionGater: {
        denyDialMultiaddr: async (ma: {toString: () => string}) => {
          const s = ma.toString()
          if (browserCanDial(s)) return false // allow
          deniedDials.count++
          const t = transportOf(s)
          deniedDials.byTransport[t] = (deniedDials.byTransport[t] ?? 0) + 1
          return true // deny (browser-transport-only, like a real browser tab)
        },
      },
    }
  }

  const pkc = await PKC(pkcInput as Parameters<typeof PKC>[0])
  pkc.on('error', (pkcErrorEvent: Error) => console.log('pkcErrorEvent:', pkcErrorEvent.message))

  // reach the live libp2p node for peer/transport snapshots (internal path; guarded)
  let libp2p: any
  try {
    libp2p = libp2pKey
      ? (pkc as any).clients?.libp2pJsClients?.[libp2pKey]?._helia?.libp2p
      : undefined
  } catch {
    libp2p = undefined
  }

  const beforeReportTimestamp = Date.now()
  const reportCommunities: Record<string, CommunityMetrics> = {}
  // accumulate per-phase durations across all communities for the aggregate breakdown
  const phaseBreakdown: Record<string, number> = {}

  const loadCommunity = ({name: communityName, publicKey: communityPublicKey}: CommunityIdentifier, index: number): Promise<void> =>
    new Promise(async (resolve) => {
      const metrics: CommunityMetrics = {
        resolvingAddressTimeSeconds: null,
        fetchingIpnsTimeSeconds: null,
        fetchingIpfsTimeSeconds: null,
        totalLoadTimeSeconds: null,
      }
      reportCommunities[communityName] = metrics

      const start = Date.now()
      let beforeTimestamp = start
      const transitions: Array<{state: string; at: number}> = []
      let done = false

      const community = await (pkc as unknown as {
        createCommunity: (a: unknown) => Promise<{
          on: (e: string, h: (arg: any) => void) => void
          update: () => void
          stop: () => Promise<void>
          updatedAt?: number
          updatingState?: string
        }>
      }).createCommunity({name: communityName, publicKey: communityPublicKey})

      const finish = (ok: boolean, note?: string) => {
        if (done) return
        done = true
        const total = (Date.now() - start) / 1000
        metrics.totalLoadTimeSeconds = total
        const net = safeSnapshot(libp2p)
        metrics.peers = net.peers
        metrics.browserUsablePeers = net.browserUsablePeers
        metrics.byTransport = net.byTransport
        if (!ok) metrics.failedAt = Math.round(Date.now() / 1000)

        // attribute per-phase durations from the recorded transitions (naming-robust)
        for (let i = 0; i < transitions.length; i++) {
          const t = transitions[i]!
          const nextAt = i + 1 < transitions.length ? transitions[i + 1]!.at : Date.now() - start
          phaseBreakdown[t.state] = (phaseBreakdown[t.state] ?? 0) + (nextAt - t.at) / 1000
        }

        const tag = `[${index + 1}/${communities.length}]`
        const phaseStr =
          `resolve=${metrics.resolvingAddressTimeSeconds ?? '-'}s ipns=${metrics.fetchingIpnsTimeSeconds ?? '-'}s ipfs=${metrics.fetchingIpfsTimeSeconds ?? '-'}s`
        const netStr = `peers=${net.peers}(browser-usable=${net.browserUsablePeers}) ${JSON.stringify(net.byTransport)}`
        console.log(
          `${tag} ${ok ? 'OK  ' : 'FAIL'} ${communityName.padEnd(28)} ${`${total.toFixed(2)}s`.padStart(8)}  ${phaseStr}  ${netStr}${note ? '  ' + note : ''}`,
        )

        resolve()
        community.stop().catch(() => {})
      }

      community.on('error', (communityErrorEvent: Error) =>
        console.log('communityErrorEvent:', communityName, communityErrorEvent.message),
      )

      community.on('updatingstatechange', (updatingState: string) => {
        transitions.push({state: updatingState, at: Date.now() - start})
        if (updatingState === 'resolving-address') {
          beforeTimestamp = Date.now()
        }
        if (updatingState === 'fetching-ipns') {
          if (metrics.resolvingAddressTimeSeconds) return
          metrics.resolvingAddressTimeSeconds = (Date.now() - beforeTimestamp) / 1000
        }
        if (updatingState === 'fetching-ipfs') {
          if (metrics.fetchingIpnsTimeSeconds) return
          metrics.fetchingIpnsTimeSeconds = (Date.now() - beforeTimestamp) / 1000
        }
        if (updatingState === 'succeeded') {
          if (metrics.fetchingIpnsTimeSeconds) {
            metrics.fetchingIpfsTimeSeconds = (Date.now() - beforeTimestamp) / 1000
          } else {
            metrics.fetchingIpnsTimeSeconds = (Date.now() - beforeTimestamp) / 1000
          }
          finish(true)
        }
        if (updatingState === 'failed') {
          finish(false, 'failed')
        }
        if (updatingState === 'waiting-retry') {
          setTimeout(() => finish(false, 'waiting-retry >10s'), 10000)
        }
      })

      // the "magnet" load resolves the IPNS record directly; resolve as soon as the first
      // real update lands (updatedAt set), like the reference.
      community.on('update', () => {
        if (community.updatedAt) finish(true)
      })

      community.update()

      setTimeout(() => finish(false, 'timed out 2min'), 1000 * 60 * 2)
    })

  console.log(
    `\nloading ${communities.length} communities (runtime=${runtime}, concurrency=${concurrency}, countNonBrowserDials=${!!benchmarkOptions.countNonBrowserDials}) over Helia/libp2p-js...\n`,
  )
  await runPool(communities, concurrency, loadCommunity)
  console.log('done loading communities')

  const finalNet = safeSnapshot(libp2p)
  const loadedCount = Object.values(reportCommunities).filter((m) => !m.failedAt && m.totalLoadTimeSeconds != null).length

  const writeReport = async () => {
    const report: BenchmarkReport = {
      name: benchmarkOptions.name,
      type: benchmarkOptionsType,
      timestamp: Date.now(),
      timeSeconds: (Date.now() - beforeReportTimestamp) / 1000,
      runtime,
      communities: reportCommunities,
      discoveredCount,
      loadedCount,
      phaseBreakdown,
      finalNet,
      deniedDials: benchmarkOptions.countNonBrowserDials ? deniedDials : undefined,
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

  await writeReport()
  console.log(`\nloaded ${loadedCount}/${communities.length} (discovered ${discoveredCount})`)
  console.log(`final peers=${finalNet.peers} browser-usable=${finalNet.browserUsablePeers} ${JSON.stringify(finalNet.byTransport)}`)
  if (benchmarkOptions.countNonBrowserDials) {
    console.log(`denied non-browser dials: ${deniedDials.count} ${JSON.stringify(deniedDials.byTransport)}`)
  }
  console.log(benchmarkOptions.name, 'done')

  try {
    process.exit()
  } catch (e) {
    // browser: no process to exit
  }
})
