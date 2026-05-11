import fiveChanDirectories from './multisubs/5chan-directories.json' with {type: 'json'}
import type {
  CommentIdentifier,
  CommentListBenchmarkOptions,
  CommunityIdentifier,
  CommunityListBenchmarkOptions,
  PublishBenchmarkOptions,
  BenchmarkOptionsFile,
} from './types.ts'

const dataPath = '.pkc-benchmark'

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

// TODO, post, reply, 10 posts/replies from different subs, 10 posts/replies from the same sub
// CIDs below are stale (from previous .eth communities) and need to be regenerated for the
// .bso communities they're paired with — kept as placeholders so the wiring/types remain valid.
const oneSubCommunity = communities.find((c) => c.name === 'business-and-finance.bso')!
const withCommunity = (cid: string, community: CommunityIdentifier): CommentIdentifier => ({
  cid,
  communityName: community.name,
  communityPublicKey: community.publicKey,
})
const post: CommentIdentifier = withCommunity('QmQ5iZNEiiitJmefk1zRqYxa7fAuQo4vy3XAUy3UpUMhwG', oneSubCommunity)
const reply: CommentIdentifier = withCommunity('QmWtN7Uue8Pw3Gg1V7csVjnsswpdJQbW3aHNk2gRfjPjig', oneSubCommunity)
const oneSub5Posts5Replies: CommentIdentifier[] = [
  // posts
  'QmWuSQNZszHSPtwLmr41mS1drMnzCKfp7GLQUmdVg5aoZ1',
  'QmXdSw2ydiKLnMjxyEHQye7ZUa5cHQKmKiSMF9yRfMLkrs',
  'QmQ5iZNEiiitJmefk1zRqYxa7fAuQo4vy3XAUy3UpUMhwG',
  'Qmaq3DgXQEdfGhusKtJCTZU3HyXrPg8TKGuQLcQrgvCgps',
  'QmagGzGvUQDy7K1Kgc3d1H8YU8n9dYViaExZHWfFy6Krma',
  // replies
  'QmVwcGCHrviS44YBakEuBuNn8xCvgv1Z3TQswqRraq3APg',
  'QmcPc94WwdtF2xzFojDvanQp7V3S4FChNrG1vXwbxamcp3',
  'QmfRNP1TC9B1R1AgoW4ts86ZsWuPNrhShedxJ3axzHQ3h9',
  'QmbAwAApoVfmRmxmSdHuMA9uDVL8pd13LGM1TTU4hSXDUX',
  'QmZPfobp6UcroLtPiiAFgsAQX8RQh3WwfiCbzyHi22rBRR',
].map((cid) => withCommunity(cid, oneSubCommunity))
const tenSubs5Posts5Replies: CommentIdentifier[] = [
  // posts
  'QmYZiS4uDR6S2vC65fmpktjH3mBn27gk3c4HkFEpf3SN61',
  'QmcYV2yoSkXazG9puqHPbApfVg6FfmrHp3tSCyNz9CBLci',
  'QmQ5iZNEiiitJmefk1zRqYxa7fAuQo4vy3XAUy3UpUMhwG',
  'QmcGmhdCV9DnXWFnD4y6wgzhXUfexJLzgz8boG97HNL4tH',
  'QmTLcPYzXiPZV6jwTF6CVUvUyLjMG4y15HRW3dA7z5rc7e',
  // replies
  'QmbmhVWWw2fWZ1EgeUK7Q4bMGa7ngpSGdgJmCWfSLJsthC',
  'QmNoNxFkEgM65ATGsL38cufuuNJx5UdNawmMAudkdwjhf1',
  'QmaaGTw5WzTFz4SMc4C4CdK7FDtaAT9yFUYekHErELXdgi',
  'QmPfjpbDqo9kEWe5gBpL9BeYUPU5GBVp17W763zyuz8JMi',
  'QmUTCSKiiTunWECvLRiJfxotUmNfanJyjRR8Tjq5pr1YLK',
].map((cid, i) => withCommunity(cid, communities[i % communities.length]!))
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
    comments: [post]
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
    comments: [reply]
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
    comments: oneSub5Posts5Replies
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
    comments: tenSubs5Posts5Replies
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
    comments: [post]
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
    comments: [reply]
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
    comments: oneSub5Posts5Replies
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
    comments: tenSubs5Posts5Replies
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
//     comments: [reply]
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
  {
    name: 'https://plebpubsub.xyz',
    pkcOptions: {
      pubsubKuboRpcClients: ['https://plebpubsub.xyz'],
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

const benchmarkOptions: BenchmarkOptionsFile = {
  resolveAddressesBenchmarkOptions,
  fetchIpnsBenchmarkOptions,
  gatewayFetchIpnsBenchmarkOptions,
  fetchCommentBenchmarkOptions,
  publishBenchmarkOptions,
}
export default benchmarkOptions
