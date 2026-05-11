// debug libp2p
console.log('make sure to run with DEBUG=libp2p*,helia*,delegated*')

import http from 'node:http'
import PKC from '@pkcprotocol/pkc-js'
import {buildPkcOptions} from '../lib/build-pkc-options.ts'
import type {CommunityListBenchmarkOptions, CommunityMetrics} from '../types.ts'

const benchmarkOptions: CommunityListBenchmarkOptions = {
  name: 'libp2pJsClientsOptions',
  pkcOptions: {
    libp2pJsClientsOptions: [
      {
        key: 'libp2pJsClient',
        libp2pOptions: {
          connectionGater: {
            denyDialMultiaddr: (multiaddress: unknown) => String(multiaddress).includes('webrtc-direct'),
          },
        },
        heliaOptions: {},
      },
    ],
    httpRoutersOptions: [
      'https://routing.lol',
      'https://peers.pleb.bot',
      'https://peers.plebpubsub.xyz',
      'https://peers.forumindex.com',
    ],
    chainProviders: {eth: {urls: ['wss://ethrpc.xyz'], chainId: 1}},
    resolveAuthorAddresses: false,
    validatePages: false,
    dataPath: '.pkc-benchmark',
  },
  communityAddresses: ['censorship-watch.eth', 'fatpeoplehate.eth'],
}

const server = http.createServer(async (_req, res) => {
  const json = JSON.stringify({
    Providers: [
      {
        Schema: 'peer',
        Addrs: [
          '/dns4/194-11-226-35.k51qzi5uqu5dhlxz4gos5ph4wivip9rgsg6tywpypccb403b0st1nvzhw8as9q.libp2p.direct/tcp/4001/tls/ws/p2p/12D3KooWDfnXqdZfsoqKbcYEDKRttt3adumB5m6tw8YghPwMAz8V',
        ],
        ID: '12D3KooWDfnXqdZfsoqKbcYEDKRttt3adumB5m6tw8YghPwMAz8V',
        Protocols: ['transport-bitswap'],
      },
    ],
  })
  res.writeHead(200, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(json),
    'Access-Control-Allow-Origin': '*',
  })
  res.end(json)
})
server.listen(9999, () => {
  console.log(`http router listening on port ${9999}`)
})

const pkc = await PKC(buildPkcOptions(benchmarkOptions.pkcOptions))
pkc.on('error', (pkcErrorEvent: Error) => console.log('pkcErrorEvent:', pkcErrorEvent.message))
const libp2p = (pkc as unknown as {clients: {libp2pJsClients: {libp2pJsClient: {_helia: {libp2p: unknown}}}}}).clients
  .libp2pJsClients.libp2pJsClient._helia.libp2p

if (process.env.DEBUG) {
  let seconds = 1
  setInterval(() => {
    let connected = 'connected:'
    ;(libp2p as {getConnections: () => {remoteAddr: {toString: () => string}}[]})
      .getConnections()
      .forEach((connection) => {
        connected += `\n${connection.remoteAddr.toString()}`
      })
    console.log(`\n--------\n${seconds++ / 2} seconds, ${connected}\n--------\n`)
  }, 500).unref?.()
}

const reportCommunities: Record<string, CommunityMetrics> = {}

const fetchCommunity = (communityAddress: string): Promise<void> =>
  new Promise(async (resolve) => {
    reportCommunities[communityAddress] = {}
    let beforeResolvingAddressTimestamp = Date.now()
    const community = await (pkc as unknown as {
      createCommunity: (a: unknown) => Promise<{
        on: (e: string, h: (arg: any) => void) => void
        update: () => void
      }>
    }).createCommunity({address: communityAddress})
    community.on('error', (communityErrorEvent: Error) =>
      console.log('communityErrorEvent:', communityAddress, communityErrorEvent.message),
    )
    community.on('updatingstatechange', (updatingState: string) => {
      const metrics = reportCommunities[communityAddress]!
      if (updatingState === 'resolving-address') {
        beforeResolvingAddressTimestamp = Date.now()
      }
      if (updatingState === 'fetching-ipns') {
        if (metrics.resolvingAddressTimeSeconds) return
        metrics.resolvingAddressTimeSeconds = (Date.now() - beforeResolvingAddressTimestamp) / 1000
        console.log(`resolved address ${communityAddress} in ${metrics.resolvingAddressTimeSeconds}s`)
      }
      if (updatingState === 'succeeded') {
        metrics.fetchingIpnsTimeSeconds = (Date.now() - beforeResolvingAddressTimestamp) / 1000
        console.log(`fetched ipns ${communityAddress} in ${metrics.fetchingIpnsTimeSeconds}s`)
        resolve()
      }
      if (updatingState === 'failed') {
        resolve()
      }
      if (updatingState === 'waiting-retry') {
        setTimeout(() => resolve(), 10000)
      }
    })
    community.update()
  })

const fetchCommunities = async () => {
  console.log('fetching communities...')
  const promises = benchmarkOptions.communityAddresses.map(fetchCommunity)
  await Promise.all(promises)
  console.log('done fetching communities')
}

await fetchCommunities()
console.log(reportCommunities)
console.log(benchmarkOptions.name, 'done')
console.log('http routers', (benchmarkOptions.pkcOptions as {httpRoutersOptions?: string[]}).httpRoutersOptions)

try {
  process.exit()
} catch (e) {
  // ignore
}
