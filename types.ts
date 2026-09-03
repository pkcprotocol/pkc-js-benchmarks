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
  kuboRpcClientsOptions?: string[]
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

// reply-propagation benchmark: how long a reply published by one client takes to become
// visible to a *different* client that is already sitting on the post with post.update().
//
// The community is not a production 5chan board (those end the challenge exchange at an
// interactive Spam Blocker iframe, so no headless client can publish to them successfully) —
// the harness runs its own no-challenge community on its own kubo node, and the two clients
// each get their own kubo/helia/gateway transport. See lib/reply-propagation-host.ts.
export interface ReplyPropagationCommunityTarget {
  // IPNS key of an already-running community to publish to (instead of the harness's own)
  publicKey: string
  name?: string
  // answers for the community's challenges, in order (a `question` challenge takes one)
  challengeAnswers?: string[]
}

export interface ReplyPropagationBenchmarkOptions extends BaseBenchmarkOptions {
  // how many post+reply pairs to measure; the report medians over the samples (default 3)
  samples?: number
  // give up on a single sample after this long and record it as failed (default 180)
  sampleTimeoutSeconds?: number
  // Publish to an existing community somewhere on the public network rather than to the local
  // no-challenge community this harness boots. Both clients still run here — only the community
  // is remote, which is the point: it measures what a remote node's reply update actually costs.
  community?: ReplyPropagationCommunityTarget
  // the publishing client's transport when `community` is set (production pubsub + gateways)
  publisherPkcOptions?: PkcOptions
  // boot a kubo node on the public network for the reading client to use, configured the way
  // pkc-js configures a production node; the reader's pkcOptions point at its rpc/gateway ports
  readerKuboNode?: boolean
}

export interface BenchmarkOptionsFile {
  publishBenchmarkOptions: PublishBenchmarkOptions[]
  replyPropagationBenchmarkOptions: ReplyPropagationBenchmarkOptions[]
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

// One post+reply sample, measured on the reading client.
//
// The FIRST sample of a cell reports under the `firstSample*` keys and every later one under the
// plain keys, because it is the only sample whose client has never talked to this community
// before — it also pays whatever that first contact costs (the first provider lookup through the
// http routers, joining the community's IPNS pubsub topic). Usually that costs nothing measurable
// (first and later samples within noise of each other), but one run against a remote community
// measured 58.7s on the first sample against 0.44s on the second, and averaging the two produced
// a median no reader ever experiences. Keeping them apart makes such an outlier visible instead
// of letting it move the headline number.
export interface ReplyPropagationMetrics {
  firstSamplePostInitialLoadTimeSeconds?: number | null
  firstSampleReplyPropagationTimeSeconds?: number | null
  firstSampleReplyTotalTimeSeconds?: number | null
  // reading client: post.update() until the post's first CommentUpdate is in hand
  postInitialLoadTimeSeconds?: number | null
  // publishing client: publish() until challengeverification says the reply was accepted
  replyPublishTimeSeconds?: number | null
  // THE number this benchmark exists for: accepted reply -> reply visible on the reading client
  replyPropagationTimeSeconds?: number | null
  // publish() -> visible on the reading client (publish + propagation)
  replyTotalTimeSeconds?: number | null
  error?: {message: string}
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
  replies?: Record<string, ReplyPropagationMetrics>
  // load-communities aggregates
  discoveredCount?: number
  loadedCount?: number
  phaseBreakdown?: Record<string, number>
  finalNet?: NetSnapshot
  deniedDials?: {count: number; byTransport: Record<string, number>}
}
