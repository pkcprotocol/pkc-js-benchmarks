import fiveChanDirectories from './multisubs/5chan-directories.json' with {type: 'json'}
import {localKuboNodes, kuboGatewayUrl, kuboHttpRouterUrl, kuboRpcUrl} from './lib/local-kubo-config.ts'
import type {
  CommentSampleSpec,
  CommentListBenchmarkOptions,
  CommunityIdentifier,
  CommunityListBenchmarkOptions,
  LoadCommunitiesBenchmarkOptions,
  PublishBenchmarkOptions,
  ReplyPropagationBenchmarkOptions,
  BenchmarkOptionsFile,
  BoardFixtureSpec,
  CommentUpdatePropagationBenchmarkOptions,
  ImportTimeBenchmarkOptions,
  LocalPublishBenchmarkOptions,
  RpcCommunityListBenchmarkOptions,
  SeededBoardBenchmarkOptions,
  SoakBenchmarkOptions,
} from './types.ts'

const dataPath = '.pkc-benchmark'
// separate from `dataPath` so start.ts wipes the reading client's cache between reply-propagation
// cells without touching the other benchmarks' caches
const replyPropagationDataPath = '.pkc-benchmark-reply-propagation'

const communities: CommunityIdentifier[] = fiveChanDirectories.directories.map((d) => ({
  name: d.name,
  publicKey: d.publicKey,
}))

let resolveAddressesBenchmarkOptions: CommunityListBenchmarkOptions[] = [
  {
    name: 'https://ethrpc.xyz (possibly not cached)',
    pkcOptions: {
      chainProviders: {eth: {urls: ['https://ethrpc.xyz'], chainId: 1}},
      resolveAuthorAddresses: false,
      validatePages: false,
      dataPath
    },
    communities
  },
  {
    name: 'https://ethrpc.xyz',
    pkcOptions: {
      chainProviders: {eth: {urls: ['https://ethrpc.xyz'], chainId: 1}},
      resolveAuthorAddresses: false,
      validatePages: false,
      dataPath
    },
    communities
  },
  {
    name: 'wss://ethrpc.xyz (possibly not cached)',
    pkcOptions: {
      chainProviders: {eth: {urls: ['wss://ethrpc.xyz'], chainId: 1}},
      resolveAuthorAddresses: false,
      validatePages: false,
      dataPath
    },
    communities
  },
  {
    name: 'wss://ethrpc.xyz',
    pkcOptions: {
      chainProviders: {eth: {urls: ['wss://ethrpc.xyz'], chainId: 1}},
      resolveAuthorAddresses: false,
      validatePages: false,
      dataPath
    },
    communities
  },
  {
    name: 'https://ethrpc.xyz, viem, ethers.js',
    pkcOptions: {
      chainProviders: {eth: {urls: ['https://ethrpc.xyz', 'viem', 'ethers.js'], chainId: 1}},
      resolveAuthorAddresses: false,
      validatePages: false,
      dataPath
    },
    communities
  },
  {
    name: 'viem',
    pkcOptions: {
      chainProviders: {eth: {urls: ['viem'], chainId: 1}},
      resolveAuthorAddresses: false,
      validatePages: false,
      dataPath
    },
    communities
  },
  {
    name: 'ethers.js',
    pkcOptions: {
      chainProviders: {eth: {urls: ['ethers.js'], chainId: 1}},
      resolveAuthorAddresses: false,
      validatePages: false,
      dataPath
    },
    communities
  },
  {
    name: 'https://solrpc.xyz',
    pkcOptions: {
      chainProviders: {sol: {urls: ['https://solrpc.xyz'], chainId: 1}},
      resolveAuthorAddresses: false,
      validatePages: false,
      dataPath
    },
    communities
  },
  {
    // wss not yet implemented for sol rpc, low priority, did not improve speed in eth rpc
    name: 'wss://solrpc.xyz (wss not implemented)',
    pkcOptions: {
      chainProviders: {sol: {urls: ['wss://solrpc.xyz'], chainId: 1}},
      resolveAuthorAddresses: false,
      validatePages: false,
      dataPath
    },
    communities
  },
  {
    name: 'web3.js',
    pkcOptions: {
      chainProviders: {sol: {urls: ['web3.js'], chainId: 1}},
      resolveAuthorAddresses: false,
      validatePages: false,
      dataPath
    },
    communities
  },
  {
    name: 'https://solrpc.xyz, web3.js',
    pkcOptions: {
      chainProviders: {sol: {urls: ['https://solrpc.xyz', 'web3.js'], chainId: 1}},
      resolveAuthorAddresses: false,
      validatePages: false,
      dataPath
    },
    communities
  }
]

let fetchIpnsBenchmarkOptions: CommunityListBenchmarkOptions[] = [
  {
    name: 'https://ipfsgateway.xyz (possibly not cached)',
    pkcOptions: {
      ipfsGatewayUrls: ['https://ipfsgateway.xyz'],
      chainProviders: {
        eth: {urls: ['https://ethrpc.xyz'], chainId: 1},
        sol: {urls: ['https://solrpc.xyz'], chainId: 1}
      },
      resolveAuthorAddresses: false,
      validatePages: false,
      dataPath
    },
    communities
  },
  {
    name: 'https://ipfsgateway.xyz',
    pkcOptions: {
      ipfsGatewayUrls: ['https://ipfsgateway.xyz'],
      chainProviders: {
        eth: {urls: ['https://ethrpc.xyz'], chainId: 1},
        sol: {urls: ['https://solrpc.xyz'], chainId: 1}
      },
      resolveAuthorAddresses: false,
      validatePages: false,
      dataPath
    },
    communities
  },
  {
    name: 'https://gateway.plebpubsub.xyz',
    pkcOptions: {
      ipfsGatewayUrls: ['https://gateway.plebpubsub.xyz'],
      chainProviders: {
        eth: {urls: ['https://ethrpc.xyz'], chainId: 1},
        sol: {urls: ['https://solrpc.xyz'], chainId: 1}
      },
      resolveAuthorAddresses: false,
      validatePages: false,
      dataPath
    },
    communities
  },
  {
    name: 'https://gateway.forumindex.com',
    pkcOptions: {
      ipfsGatewayUrls: ['https://gateway.forumindex.com'],
      chainProviders: {
        eth: {urls: ['https://ethrpc.xyz'], chainId: 1},
        sol: {urls: ['https://solrpc.xyz'], chainId: 1}
      },
      resolveAuthorAddresses: false,
      validatePages: false,
      dataPath
    },
    communities
  },
  {
    name: 'https://ipfsgateway.xyz, https://gateway.plebpubsub.xyz, https://gateway.forumindex.com',
    pkcOptions: {
      ipfsGatewayUrls: ['https://ipfsgateway.xyz', 'https://gateway.plebpubsub.xyz', 'https://gateway.forumindex.com'],
      chainProviders: {
        eth: {urls: ['https://ethrpc.xyz'], chainId: 1},
        sol: {urls: ['https://solrpc.xyz'], chainId: 1}
      },
      resolveAuthorAddresses: false,
      validatePages: false,
      dataPath
    },
    communities
  },
  {
    name: 'libp2p js client',
    pkcOptions: {
      libp2pJsClientsOptions: [{key: 'libp2pjs'}],
      httpRoutersOptions: [
        'https://routing.lol',
        'https://peers.pleb.bot',
        'https://peers.plebpubsub.xyz',
        'https://peers.forumindex.com'
      ],
      chainProviders: {
        eth: {urls: ['https://ethrpc.xyz'], chainId: 1},
        sol: {urls: ['https://solrpc.xyz'], chainId: 1}
      },
      resolveAuthorAddresses: false,
      validatePages: false,
      dataPath
    },
    communities
  }
]

// fetchIpnsBenchmarkOptions = [
//   {
//     name: 'libp2p js client',
//     pkcOptions: {
//       libp2pJsClientsOptions: [{key: 'libp2pjs'}],
//       httpRoutersOptions: [
//         'https://routing.lol',
//         'https://peers.pleb.bot',
//         'https://peers.plebpubsub.xyz',
//         'https://peers.forumindex.com'
//       ],
//       chainProviders: {
//         eth: {urls: ['https://ethrpc.xyz'], chainId: 1},
//         sol: {urls: ['https://solrpc.xyz'], chainId: 1}
//       },
//       resolveAuthorAddresses: false,
//       validatePages: false,
//       dataPath
//     },
//     communities
//   }
// ]

// only fetches the first gateway
let gatewayFetchIpnsBenchmarkOptions: CommunityListBenchmarkOptions[] = [
  {
    name: 'https://ipfsgateway.xyz (gateway fetch only)',
    pkcOptions: {ipfsGatewayUrls: ['https://ipfsgateway.xyz']},
    communities
  },
  {
    name: 'https://gateway.plebpubsub.xyz (gateway fetch only)',
    pkcOptions: {ipfsGatewayUrls: ['https://gateway.plebpubsub.xyz']},
    communities
  },
  {
    name: 'https://gateway.forumindex.com (gateway fetch only)',
    pkcOptions: {ipfsGatewayUrls: ['https://gateway.forumindex.com']},
    communities
  }
]

// Which comments each cell fetches. Never hardcoded CIDs — boards purge old threads, so a fixed
// list goes stale (it did: every cell fetched nothing for months). The benchmark server samples
// live posts and replies from the boards' current pages at run time, once per run, so every cell
// of a run fetches the same comments (see /comments-sample in lib/server.ts).
const post: CommentSampleSpec = {communities: 1, posts: 1, replies: 0}
const reply: CommentSampleSpec = {communities: 1, posts: 0, replies: 1}
const oneSub5Posts5Replies: CommentSampleSpec = {communities: 1, posts: 5, replies: 5}
const tenSubs5Posts5Replies: CommentSampleSpec = {communities: 10, posts: 5, replies: 5}
let fetchCommentBenchmarkOptions: CommentListBenchmarkOptions[] = [
  {
    name: 'ipfsgateway.xyz (1 post)',
    pkcOptions: {
      ipfsGatewayUrls: ['https://ipfsgateway.xyz'],
      chainProviders: {
        eth: {urls: ['https://ethrpc.xyz'], chainId: 1},
        sol: {urls: ['https://solrpc.xyz'], chainId: 1}
      },
      resolveAuthorAddresses: false,
      validatePages: false,
      dataPath
    },
    sample: post
  },
  {
    name: 'ipfsgateway.xyz (1 reply)',
    pkcOptions: {
      ipfsGatewayUrls: ['https://ipfsgateway.xyz'],
      chainProviders: {
        eth: {urls: ['https://ethrpc.xyz'], chainId: 1},
        sol: {urls: ['https://solrpc.xyz'], chainId: 1}
      },
      resolveAuthorAddresses: false,
      validatePages: false,
      dataPath
    },
    sample: reply
  },
  {
    name: 'ipfsgateway.xyz (1 sub, 5 posts, 5 replies)',
    pkcOptions: {
      ipfsGatewayUrls: ['https://ipfsgateway.xyz'],
      chainProviders: {
        eth: {urls: ['https://ethrpc.xyz'], chainId: 1},
        sol: {urls: ['https://solrpc.xyz'], chainId: 1}
      },
      resolveAuthorAddresses: false,
      validatePages: false,
      dataPath
    },
    sample: oneSub5Posts5Replies
  },
  {
    name: 'ipfsgateway.xyz (10 subs, 5 posts, 5 replies)',
    pkcOptions: {
      ipfsGatewayUrls: ['https://ipfsgateway.xyz'],
      chainProviders: {
        eth: {urls: ['https://ethrpc.xyz'], chainId: 1},
        sol: {urls: ['https://solrpc.xyz'], chainId: 1}
      },
      resolveAuthorAddresses: false,
      validatePages: false,
      dataPath
    },
    sample: tenSubs5Posts5Replies
  },
  {
    name: 'libp2p js client (1 post)',
    pkcOptions: {
      libp2pJsClientsOptions: [{key: 'libp2pjs'}],
      httpRoutersOptions: [
        'https://routing.lol',
        'https://peers.pleb.bot',
        'https://peers.plebpubsub.xyz',
        'https://peers.forumindex.com'
      ],
      chainProviders: {
        eth: {urls: ['https://ethrpc.xyz'], chainId: 1},
        sol: {urls: ['https://solrpc.xyz'], chainId: 1}
      },
      resolveAuthorAddresses: false,
      validatePages: false,
      dataPath
    },
    sample: post
  },
  {
    name: 'libp2p js client (1 reply)',
    pkcOptions: {
      libp2pJsClientsOptions: [{key: 'libp2pjs'}],
      httpRoutersOptions: [
        'https://routing.lol',
        'https://peers.pleb.bot',
        'https://peers.plebpubsub.xyz',
        'https://peers.forumindex.com'
      ],
      chainProviders: {
        eth: {urls: ['https://ethrpc.xyz'], chainId: 1},
        sol: {urls: ['https://solrpc.xyz'], chainId: 1}
      },
      resolveAuthorAddresses: false,
      validatePages: false,
      dataPath
    },
    sample: reply
  },
  {
    name: 'libp2p js client (1 sub, 5 posts, 5 replies)',
    pkcOptions: {
      libp2pJsClientsOptions: [{key: 'libp2pjs'}],
      httpRoutersOptions: [
        'https://routing.lol',
        'https://peers.pleb.bot',
        'https://peers.plebpubsub.xyz',
        'https://peers.forumindex.com'
      ],
      chainProviders: {
        eth: {urls: ['https://ethrpc.xyz'], chainId: 1},
        sol: {urls: ['https://solrpc.xyz'], chainId: 1}
      },
      resolveAuthorAddresses: false,
      validatePages: false,
      dataPath
    },
    sample: oneSub5Posts5Replies
  },
  {
    name: 'libp2p js client (10 subs, 5 posts, 5 replies)',
    pkcOptions: {
      libp2pJsClientsOptions: [{key: 'libp2pjs'}],
      httpRoutersOptions: [
        'https://routing.lol',
        'https://peers.pleb.bot',
        'https://peers.plebpubsub.xyz',
        'https://peers.forumindex.com'
      ],
      chainProviders: {
        eth: {urls: ['https://ethrpc.xyz'], chainId: 1},
        sol: {urls: ['https://solrpc.xyz'], chainId: 1}
      },
      resolveAuthorAddresses: false,
      validatePages: false,
      dataPath
    },
    sample: tenSubs5Posts5Replies
  }
]

// fetchCommentBenchmarkOptions = [
//   {
//     name: 'libp2p js client (1 reply)',
//     pkcOptions: {
//       libp2pJsClientsOptions: [{key: 'libp2pjs'}],
//       httpRoutersOptions: [
//         'https://routing.lol',
//         'https://peers.pleb.bot',
//         'https://peers.plebpubsub.xyz',
//         'https://peers.forumindex.com'
//       ],
//       chainProviders: {
//         eth: {urls: ['https://ethrpc.xyz'], chainId: 1},
//         sol: {urls: ['https://solrpc.xyz'], chainId: 1}
//       },
//       resolveAuthorAddresses: false,
//       validatePages: false,
//       dataPath
//     },
//     sample: reply
//   }
// ]

const publishCommunity = communities.find((c) => c.name === 'business-and-finance.bso')!

let publishBenchmarkOptions: PublishBenchmarkOptions[] = [
  {
    name: 'https://pubsubprovider.xyz',
    pkcOptions: {
      pubsubKuboRpcClients: ['https://pubsubprovider.xyz'],
      chainProviders: {
        eth: {urls: ['https://ethrpc.xyz'], chainId: 1},
        sol: {urls: ['https://solrpc.xyz'], chainId: 1}
      },
      resolveAuthorAddresses: false,
      validatePages: false,
      dataPath
    },
    communityName: publishCommunity.name,
    communityPublicKey: publishCommunity.publicKey
  },
  // 'https://plebpubsub.xyz' was here: the provider stopped answering (connections time out, every
  // cell NaN since v0.0.100). Re-add it if it comes back.
  {
    name: 'libp2p js client',
    pkcOptions: {
      libp2pJsClientsOptions: [{key: 'libp2pjs'}],
      httpRoutersOptions: [
        'https://routing.lol',
        'https://peers.pleb.bot',
        'https://peers.plebpubsub.xyz',
        'https://peers.forumindex.com'
      ],
      chainProviders: {
        eth: {urls: ['https://ethrpc.xyz'], chainId: 1},
        sol: {urls: ['https://solrpc.xyz'], chainId: 1}
      },
      resolveAuthorAddresses: false,
      validatePages: false,
      dataPath
    },
    communityName: publishCommunity.name,
    communityPublicKey: publishCommunity.publicKey
  }
]

// reply-propagation: one client sits on a post with post.update() while a *different* client
// (its own process, its own PKC, its own kubo node) publishes a reply to it — how long until the
// reply shows up on the first client?
//
// The community can't be a production 5chan board: those end the challenge exchange at an
// interactive Spam Blocker iframe, so a headless publish never succeeds. The harness runs its own
// no-challenge community on its own kubo node instead (lib/local-community-host.ts), which also
// means the reader-side transport is the only thing that varies here — and it is the whole point
// of the matrix: kubo, helia (libp2p-js) and ipfs-gateway clients learn about a new reply in
// completely different ways. The node/chrome runtime axis is applied on top by start.ts.
// Local cells take 10 samples: the loopback mesh is cheap (the slowest reader, ipfs-gateway, is
// ~11s a sample) and three samples made a median that moved with every outlier. The remote cells
// stay at 3: each sample there publishes to someone else's community over production infra.
const replyPropagationSamples = process.env.REPLY_PROPAGATION_SAMPLES
  ? Number(process.env.REPLY_PROPAGATION_SAMPLES)
  : 10
const remoteReplyPropagationSamples = process.env.REPLY_PROPAGATION_SAMPLES
  ? Number(process.env.REPLY_PROPAGATION_SAMPLES)
  : 3
const replyPropagationBasePkcOptions = {
  resolveAuthorAddresses: false,
  validatePages: false,
  // httpRoutersOptions: [] wherever the reader talks to kubo — pkc-js otherwise defaults it to
  // the production routers, rewrites Routing.Routers on the node and POSTs /shutdown to it.
  httpRoutersOptions: [] as string[],
  ipfsGatewayUrls: [] as string[],
}
const replyPropagationBenchmarkOptions: ReplyPropagationBenchmarkOptions[] = [
  {
    name: 'reader: kubo rpc',
    pkcOptions: {
      ...replyPropagationBasePkcOptions,
      kuboRpcClientsOptions: [kuboRpcUrl(localKuboNodes.reader)],
      pubsubKuboRpcClientsOptions: [kuboRpcUrl(localKuboNodes.reader)],
      dataPath: replyPropagationDataPath,
    },
    samples: replyPropagationSamples,
  },
  {
    name: 'reader: libp2p js client',
    pkcOptions: {
      ...replyPropagationBasePkcOptions,
      libp2pJsClientsOptions: [{key: 'libp2pjs'}],
      // the community's own kubo node serves /routing/v1 — the local stand-in for routing.lol
      httpRoutersOptions: [kuboHttpRouterUrl(localKuboNodes.community)],
      dataPath: replyPropagationDataPath,
    },
    samples: replyPropagationSamples,
  },
  {
    name: 'reader: ipfs gateway',
    pkcOptions: {
      ...replyPropagationBasePkcOptions,
      ipfsGatewayUrls: [kuboGatewayUrl(localKuboNodes.reader)],
      dataPath: replyPropagationDataPath,
    },
    samples: replyPropagationSamples,
  },
]

// The same measurement against a community that actually lives on another machine, reached over
// the public network. Both clients still run here — only the community is remote, which is the
// point: this is what a reply update costs a real client when the community is a remote node, with
// production gateways/routers/pubsub providers in between. The local cells above isolate the
// pkc-js pipeline; these are the ones that track what the real network does to it, so they run on
// every release like everything else.
//
// They publish real posts and replies to the target community on each run, and a sample whose
// community is unreachable records its error and moves on rather than failing the run.
//
// The community's `question` challenge answer is only in its owner's community.settings, and the
// owner rotates it, so it is not in this file: CI passes it in REMOTE_COMMUNITY_CHALLENGE_ANSWER (a
// repository secret, read by lib/local-community-host.ts). Without it these cells fail "Wrong answer."
//
// These cells depend on a machine and a network the harness does not control (its load, the
// community's traffic, production gateways and pubsub providers), so they are release-time
// monitoring of what a real client sees, not a version-to-version comparison — they are never
// backfilled; use the local cells above for that.
const remoteCommunity = {
  publicKey: '12D3KooWG3XbzoVyAE6Y9vHZKF64Yuuu4TjdgQKedk14iYmTEPWu',
}
const productionHttpRouters = [
  'https://routing.lol',
  'https://peers.pleb.bot',
  'https://peers.plebpubsub.xyz',
  'https://peers.forumindex.com',
]
const productionGateways = [
  'https://ipfsgateway.xyz',
  'https://gateway.plebpubsub.xyz',
  'https://gateway.forumindex.com',
]
// the publishing client is an ordinary production client: a pubsub provider to publish through,
// gateways to read the community record
const remotePublisherPkcOptions = {
  // plebpubsub.xyz dropped: it stopped answering (see publishBenchmarkOptions)
  pubsubKuboRpcClients: ['https://pubsubprovider.xyz'],
  ipfsGatewayUrls: productionGateways,
  httpRoutersOptions: [] as string[],
  resolveAuthorAddresses: false,
  validatePages: false,
  dataPath: '.pkc-benchmark-reply-propagation-publisher',
}
replyPropagationBenchmarkOptions.push(
  {
    name: 'remote community, reader: kubo rpc',
    pkcOptions: {
      kuboRpcClientsOptions: [kuboRpcUrl(localKuboNodes.publicReader)],
      pubsubKuboRpcClientsOptions: [kuboRpcUrl(localKuboNodes.publicReader)],
      ipfsGatewayUrls: [],
      // the harness writes exactly this router set into the node's Routing config before starting
      // it, so pkc-js finds it already configured and does not rewrite it and restart the node
      httpRoutersOptions: productionHttpRouters,
      resolveAuthorAddresses: false,
      validatePages: false,
      dataPath: replyPropagationDataPath,
    },
    community: remoteCommunity,
    publisherPkcOptions: remotePublisherPkcOptions,
    environmentDependent: true,
    // a remote community over production infra needs more room than the loopback network:
    // gateways cache IPNS records, and a fresh kubo node has to find the pubsub topic first
    sampleTimeoutSeconds: 300,
    readerKuboNode: true,
    samples: remoteReplyPropagationSamples,
  },
  {
    name: 'remote community, reader: libp2p js client',
    pkcOptions: {
      libp2pJsClientsOptions: [{key: 'libp2pjs'}],
      httpRoutersOptions: productionHttpRouters,
      ipfsGatewayUrls: [],
      resolveAuthorAddresses: false,
      validatePages: false,
      dataPath: replyPropagationDataPath,
    },
    community: remoteCommunity,
    publisherPkcOptions: remotePublisherPkcOptions,
    environmentDependent: true,
    // a remote community over production infra needs more room than the loopback network:
    // gateways cache IPNS records, and a fresh kubo node has to find the pubsub topic first
    sampleTimeoutSeconds: 300,
    samples: remoteReplyPropagationSamples,
  },
  {
    name: 'remote community, reader: ipfs gateway',
    pkcOptions: {
      ipfsGatewayUrls: productionGateways,
      httpRoutersOptions: [],
      resolveAuthorAddresses: false,
      validatePages: false,
      dataPath: replyPropagationDataPath,
    },
    community: remoteCommunity,
    publisherPkcOptions: remotePublisherPkcOptions,
    environmentDependent: true,
    // a remote community over production infra needs more room than the loopback network:
    // gateways cache IPNS records, and a fresh kubo node has to find the pubsub topic first
    sampleTimeoutSeconds: 300,
    samples: remoteReplyPropagationSamples,
  },
)

// load-communities: load EVERY production 5chan board (discovered live from GitHub at
// runtime — see lib/discover-communities.ts, nothing hardcoded) over Helia/libp2p-js in
// pure-P2P browser mode, measuring per-community load time + peer/transport reachability.
//
// The config axis is generated as a cartesian product so the matrix is easy to widen; the
// node/chrome runtime axis is applied orthogonally by start.ts (run with no --runtime to
// execute every cell). Base pkcOptions copied from the 'libp2p js client' fetchIpns entry:
// libp2p-js client + production http routers, no dataPath (fresh in-memory each run).
const loadCommunitiesHttpRouters = [
  'https://routing.lol',
  'https://peers.pleb.bot',
  'https://peers.plebpubsub.xyz',
  'https://peers.forumindex.com'
]
const loadCommunitiesBasePkcOptions = {
  libp2pJsClientsOptions: [{key: 'libp2pjs'}],
  httpRoutersOptions: loadCommunitiesHttpRouters,
  resolveAuthorAddresses: false,
  validatePages: false
}

// config-matrix dimensions (widen by adding values here)
const loadCommunitiesDimensions = {
  concurrency: [1, 4], // 1 = clean per-phase timing; 4 = parallel load (concurrency can starve the small browser mesh)
}
const loadCommunitiesSmokeLimit = process.env.LOAD_COMMUNITIES_LIMIT ? Number(process.env.LOAD_COMMUNITIES_LIMIT) : undefined
const loadCommunitiesBenchmarkOptions: LoadCommunitiesBenchmarkOptions[] = loadCommunitiesDimensions.concurrency.map(
  (concurrency) => ({
    name: `libp2pjs concurrency=${concurrency}`,
    pkcOptions: {...loadCommunitiesBasePkcOptions},
    concurrency,
    countNonBrowserDials: true,
    ...(loadCommunitiesSmokeLimit ? {limit: loadCommunitiesSmokeLimit} : {}),
  })
)

// ---------------------------------------------------------------------------------------------
// Local-community benchmarks. Everything below runs against communities the harness itself hosts
// on a private kubo mesh (lib/local-community-host.ts in the benchmark server, or a script
// benchmark's own mesh), so unlike the production cells above none of it decays as boards, CIDs and
// providers change — which is also what makes it the part whose history can be backfilled honestly.
// ---------------------------------------------------------------------------------------------

// The reader transports of the local reply-propagation cells, reused by comment-update-propagation
const localReaderTransports: {name: string; pkcOptions: Record<string, unknown>}[] = [
  {
    name: 'reader: kubo rpc',
    pkcOptions: {
      kuboRpcClientsOptions: [kuboRpcUrl(localKuboNodes.reader)],
      pubsubKuboRpcClientsOptions: [kuboRpcUrl(localKuboNodes.reader)],
    },
  },
  {
    name: 'reader: libp2p js client',
    pkcOptions: {libp2pJsClientsOptions: [{key: 'libp2pjs'}], httpRoutersOptions: [kuboHttpRouterUrl(localKuboNodes.community)]},
  },
  {name: 'reader: ipfs gateway', pkcOptions: {ipfsGatewayUrls: [kuboGatewayUrl(localKuboNodes.reader)]}},
]

// comment-update-propagation: vote -> upvoteCount visible, author edit -> edited content visible
const commentUpdatePropagationBenchmarkOptions: CommentUpdatePropagationBenchmarkOptions[] = localReaderTransports.map((transport) => {
  // the gateway reader only sees a change on its next poll (60s by default), twice per sample, and
  // that polling is the same in a browser — so 2 samples, node only
  const isGateway = transport.name === 'reader: ipfs gateway'
  return {
    name: transport.name,
    pkcOptions: {
      ...replyPropagationBasePkcOptions,
      ...transport.pkcOptions,
      dataPath: '.pkc-benchmark-comment-update-propagation',
    } as CommentUpdatePropagationBenchmarkOptions['pkcOptions'],
    samples: process.env.COMMENT_UPDATE_SAMPLES ? Number(process.env.COMMENT_UPDATE_SAMPLES) : isGateway ? 2 : 3,
    ...(isGateway ? {runtimes: ['node' as const]} : {}),
  }
})

// local-publish: the community side of publishing. Matrix: publisher transport x challenge x burst
// size; plus one cell where a whole burst comes from a single author (pkc-js v0.0.111 serializes an
// author's concurrent publications so they share one pseudonymity alias).
const localPublishTransports: {name: string; pkcOptions: Record<string, unknown>}[] = [
  {
    name: 'kubo rpc',
    pkcOptions: {
      kuboRpcClientsOptions: [kuboRpcUrl(localKuboNodes.publisher)],
      pubsubKuboRpcClientsOptions: [kuboRpcUrl(localKuboNodes.publisher)],
    },
  },
  {
    name: 'libp2p js client',
    pkcOptions: {libp2pJsClientsOptions: [{key: 'libp2pjs'}], httpRoutersOptions: [kuboHttpRouterUrl(localKuboNodes.community)]},
  },
]
const localPublishDimensions = {
  challenge: ['none', 'question'] as const,
  // [publications per round, rounds]
  burst: [
    [1, 10],
    [10, 3],
    [50, 2],
  ] as const,
}
const localPublishBenchmarkOptions: LocalPublishBenchmarkOptions[] = []
for (const transport of localPublishTransports) {
  for (const challenge of localPublishDimensions.challenge) {
    for (const [burst, rounds] of localPublishDimensions.burst) {
      localPublishBenchmarkOptions.push({
        name: `publisher: ${transport.name}, challenge: ${challenge}, burst: ${burst}`,
        pkcOptions: {...replyPropagationBasePkcOptions, ...transport.pkcOptions, dataPath: '.pkc-benchmark-local-publish'},
        challenge,
        burst,
        rounds,
        // a kubo-rpc publication holds a streaming pubsub subscription open over HTTP/1.1, and
        // chromium allows 6 connections per host: a burst deadlocks on the browser's connection
        // pool (every publication times out), which says nothing about pkc-js
        ...(transport.name === 'kubo rpc' && burst > 1 ? {runtimes: ['node' as const]} : {}),
        // profiled: a single publication through each transport, and the community under a burst
        ...(challenge === 'question' && (burst === 1 || (burst === 10 && transport.name === 'libp2p js client')) ? {profile: true} : {}),
      })
    }
  }
}
localPublishBenchmarkOptions.push({
  name: 'publisher: kubo rpc, challenge: none, burst: 50, same author',
  pkcOptions: {...replyPropagationBasePkcOptions, ...localPublishTransports[0]!.pkcOptions, dataPath: '.pkc-benchmark-local-publish'},
  challenge: 'none',
  burst: 50,
  rounds: 2,
  sameAuthor: true,
  runtimes: ['node'], // see the kubo rpc bursts above
})

// seeded-board fixtures (lib/board-fixture.ts): built once by the oldest pkc-js in the backfill
// window and migrated forward by every version under test. S and M are the shapes pkc-js PR #346
// measured (300 posts / ~16k comments, 2k posts / ~113k comments; 25 posts per author).
const boardFixtures: Record<string, BoardFixtureSpec> = {
  S: {posts: 300, minReplies: 40, maxReplies: 66, postsPerAuthor: 25},
  M: {posts: 2000, minReplies: 40, maxReplies: 66, postsPerAuthor: 25},
}
// settings.pages (configurable page sorts) shipped in pkc-js v0.0.108 (PR #346)
const pageSortsMinVersion = '0.0.108'
const seededBoardBenchmarkOptions: SeededBoardBenchmarkOptions[] = [
  {name: 'board S, default sorts', pkcOptions: {}, fixture: 'S', steadySamples: 3, cellTimeoutMinutes: 20, profile: true},
  {
    name: 'board S, posts: active only',
    pkcOptions: {},
    fixture: 'S',
    pages: {posts: [{name: 'active', preloaded: true}]},
    steadySamples: 3,
    cellTimeoutMinutes: 20,
    minPkcJsVersion: pageSortsMinVersion,
  },
  {
    name: 'board S, posts: hot only, replies: best only',
    pkcOptions: {},
    fixture: 'S',
    pages: {posts: [{name: 'hot', preloaded: true}], replies: [{name: 'best', preloaded: true}]},
    steadySamples: 3,
    cellTimeoutMinutes: 20,
    minPkcJsVersion: pageSortsMinVersion,
  },
]
// The M board takes 8-12 minutes a version, and versions before v0.0.108 are expected to time out
// or crash on it — a weekly/opt-in job, not the release path (see benchmark-soak.yml).
if (process.env.BENCHMARK_LARGE_BOARDS === '1') {
  seededBoardBenchmarkOptions.push({name: 'board M, default sorts', pkcOptions: {}, fixture: 'M', steadySamples: 3, cellTimeoutMinutes: 45})
}

const importTimeBenchmarkOptions: ImportTimeBenchmarkOptions[] = [
  {name: '@pkcprotocol/pkc-js', pkcOptions: {}, samples: 10},
]

const rpcCommunityListBenchmarkOptions: RpcCommunityListBenchmarkOptions[] = [
  {name: '10 communities, 20 posts each', pkcOptions: {}, communities: 10, postsPerCommunity: 20, profile: true},
]

// only run when asked for by name (start.ts --benchmark soak), see benchmark-soak.yml
const soakBenchmarkOptions: SoakBenchmarkOptions[] = [
  {
    name: `${process.env.SOAK_MINUTES ?? 30} minutes, 30 publications/minute`,
    pkcOptions: {},
    minutes: Number(process.env.SOAK_MINUTES ?? 30),
    publicationsPerMinute: 30,
    profile: true,
  },
]

const benchmarkOptions: BenchmarkOptionsFile = {
  localPublishBenchmarkOptions,
  commentUpdatePropagationBenchmarkOptions,
  seededBoardBenchmarkOptions,
  importTimeBenchmarkOptions,
  rpcCommunityListBenchmarkOptions,
  soakBenchmarkOptions,
  boardFixtures,
  resolveAddressesBenchmarkOptions,
  replyPropagationBenchmarkOptions,
  fetchIpnsBenchmarkOptions,
  gatewayFetchIpnsBenchmarkOptions,
  fetchCommentBenchmarkOptions,
  publishBenchmarkOptions,
  loadCommunitiesBenchmarkOptions,
}
export default benchmarkOptions
