import {test} from 'vitest'
import {fromString as uint8ArrayFromString} from 'uint8arrays/from-string'
import {toString as uint8ArrayToString} from 'uint8arrays/to-string'
import {create as createMultihash} from 'multiformats/hashes/digest'
import type {CommunityListBenchmarkOptions, BenchmarkReport, CommunityMetrics, Runtime} from '../types.ts'

const benchmarkOptionsType = 'gatewayFetchIpnsBenchmarkOptions'
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

const protobufPublicKeyPrefix = new Uint8Array([8, 1, 18, 32])
const multihashIdentityCode = 0
export const getPkcAddressFromPublicKey = (publicKeyBase64: string): string => {
  const publicKeyBuffer = uint8ArrayFromString(publicKeyBase64, 'base64')
  const publicKeyBufferWithPrefix = new Uint8Array(protobufPublicKeyPrefix.length + publicKeyBuffer.length)
  publicKeyBufferWithPrefix.set(protobufPublicKeyPrefix, 0)
  publicKeyBufferWithPrefix.set(publicKeyBuffer, protobufPublicKeyPrefix.length)
  const multihash = createMultihash(multihashIdentityCode, publicKeyBufferWithPrefix).bytes
  return uint8ArrayToString(multihash, 'base58btc')
}

async function fetchWithTimeout(url: string, options: RequestInit = {}): Promise<Response> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 1000 * 120)
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
      cache: 'no-cache',
    })
    clearTimeout(timeout)
    return response
  } catch (error) {
    clearTimeout(timeout)
    throw error
  }
}

interface CommunityRecord {
  signature: {publicKey: string}
  error?: {message: string}
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

  const pkcOptions = benchmarkOptions.pkcOptions as {ipfsGatewayUrls?: string[]}
  const gatewayUrl = pkcOptions.ipfsGatewayUrls?.[0]
  if (!gatewayUrl) {
    throw Error(`no pkcOptions.ipfsGatewayUrls`)
  }

  const beforeReportTimestamp = Date.now()
  const reportCommunities: Record<string, CommunityMetrics> = {}

  const fetchCommunity = async (communityAddress: string): Promise<void> => {
    reportCommunities[communityAddress] = {fetchingIpnsTimeSeconds: null}
    let community: CommunityRecord | undefined
    let error: Error | undefined
    try {
      community = await fetch(`${benchmarkServerUrl}/community?communityAddress=${communityAddress}`).then((res) =>
        res.json(),
      )
    } catch (e) {
      error = e as Error
    }
    if (!community || community.error) {
      console.log(
        `failed fetching ${communityAddress} from benchmark server with error: ${error?.message || community?.error?.message}`,
      )
      return
    }

    const ipnsName = getPkcAddressFromPublicKey(community.signature.publicKey)
    const beforeTimestamp = Date.now()
    try {
      const communityUpdate = await fetchWithTimeout(`${gatewayUrl}/ipns/${ipnsName}`).then((res) => res.json())
      if (communityUpdate.signature) {
        reportCommunities[communityAddress]!.fetchingIpnsTimeSeconds = (Date.now() - beforeTimestamp) / 1000
        console.log(
          `gateway fetched ipns ${communityAddress} in ${reportCommunities[communityAddress]!.fetchingIpnsTimeSeconds}s`,
        )
      }
    } catch (e) {
      console.log(`failed gateway fetched ipns ${communityAddress}: ${(e as Error).message}`)
    }
  }

  const fetchCommunities = async () => {
    console.log('fetching communities...')
    const promises = benchmarkOptions.communityAddresses.map(fetchCommunity)
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
