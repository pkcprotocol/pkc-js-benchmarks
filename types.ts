export type Runtime = 'node' | 'chrome'

// PkcOptions is the legacy-shape options used in benchmark-options.ts.
// It is data-only (no class instances) so the benchmark server can return it
// as JSON. lib/build-pkc-options.ts converts it into the runtime shape that
// pkc-js 0.0.30 expects — turning `chainProviders` URLs into BsoResolver
// instances passed via `nameResolvers`.
export interface ChainProviderConfig {
  urls: string[]
  chainId?: number
}

export interface PkcOptions {
  chainProviders?: Partial<Record<string, ChainProviderConfig>>
  resolveAuthorAddresses?: boolean
  ipfsGatewayUrls?: string[]
  pubsubKuboRpcClients?: string[]
  pubsubKuboRpcClientsOptions?: string[]
  libp2pJsClientsOptions?: Array<{key: string; libp2pOptions?: unknown; heliaOptions?: unknown}>
  httpRoutersOptions?: string[]
  dataPath?: string
  validatePages?: boolean
}

export interface BaseBenchmarkOptions {
  name: string
  pkcOptions: PkcOptions
}

export interface CommunityIdentifier {
  name: string
  publicKey: string
}

export interface CommentIdentifier {
  cid: string
  communityName: string
  communityPublicKey: string
}

export interface CommunityListBenchmarkOptions extends BaseBenchmarkOptions {
  communities: CommunityIdentifier[]
}

// load-communities benchmark: like CommunityListBenchmarkOptions but the community
// list is NOT hardcoded — it is discovered live from GitHub at runtime (see
// lib/discover-communities.ts), so there is no `communities` field. The config axis
// of the benchmark matrix lives here; the node/chrome runtime axis is applied by
// start.ts.
export interface LoadCommunitiesBenchmarkOptions extends BaseBenchmarkOptions {
  // how many communities to load at once (1 = clean per-phase timing, >1 = parallel)
  concurrency?: number
  // cap how many discovered communities to load (default: all)
  limit?: number
  // attach a libp2p connectionGater that counts (and in node, denies) provider
  // addresses a browser cannot dial (anything but wss/webtransport/webrtc)
  countNonBrowserDials?: boolean
  // override the GitHub base url for the 5chan directory lists (default in discover-communities.ts)
  listsBaseUrl?: string
}

export interface CommentListBenchmarkOptions extends BaseBenchmarkOptions {
  comments: CommentIdentifier[]
}

export interface PublishBenchmarkOptions extends BaseBenchmarkOptions {
  communityName: string
  communityPublicKey: string
}

export interface BenchmarkOptionsFile {
  publishBenchmarkOptions: PublishBenchmarkOptions[]
  fetchIpnsBenchmarkOptions: CommunityListBenchmarkOptions[]
  fetchCommentBenchmarkOptions: CommentListBenchmarkOptions[]
  resolveAddressesBenchmarkOptions: CommunityListBenchmarkOptions[]
  gatewayFetchIpnsBenchmarkOptions: CommunityListBenchmarkOptions[]
  loadCommunitiesBenchmarkOptions: LoadCommunitiesBenchmarkOptions[]
}

export type BenchmarkOptionsType = keyof BenchmarkOptionsFile

export interface CommunityMetrics {
  resolvingAddressTimeSeconds?: number | null
  fetchingIpnsTimeSeconds?: number | null
  fetchingIpfsTimeSeconds?: number | null
  // total wall-clock to load the community (resolve + ipns + ipfs), set by load-communities
  totalLoadTimeSeconds?: number | null
  // peer/transport snapshot taken when the community finished loading (load-communities)
  peers?: number | null
  browserUsablePeers?: number | null
  byTransport?: Record<string, number>
  challengeRequestTimeSeconds?: number | null
  challengeTimeSeconds?: number | null
  challengeAnswerTimeSeconds?: number | null
  challengeVerificationTimeSeconds?: number | null
  failedAt?: number
  error?: {message: string}
}

// libp2p peer/transport snapshot, used by the load-communities benchmark
export interface NetSnapshot {
  peers: number
  browserUsablePeers: number
  byTransport: Record<string, number>
}

export interface CommentMetrics {
  fetchCommentIpfsTimeSeconds?: number | null
  resolvingCommunityAddressTimeSeconds?: number | null
  fetchingCommentUpdateTimeSeconds?: number | null
}

export interface BenchmarkReport {
  name: string
  type: BenchmarkOptionsType | string
  timestamp: number
  timeSeconds: number
  runtime: Runtime
  communities?: Record<string, CommunityMetrics>
  comments?: Record<string, CommentMetrics>
  // load-communities aggregates
  discoveredCount?: number
  loadedCount?: number
  phaseBreakdown?: Record<string, number>
  finalNet?: NetSnapshot
  deniedDials?: {count: number; byTransport: Record<string, number>}
}
