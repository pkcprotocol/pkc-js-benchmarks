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
  // the cell needs a pkc-js feature that first shipped in this version; start.ts records older
  // versions as `unsupported` instead of running the cell into a hang (see lib/semver.ts)
  minPkcJsVersion?: string
  // restrict the cell to some runtimes (default: every runtime its benchmark supports)
  runtimes?: Runtime[]
  // the cell measures infrastructure the harness does not control (someone else's community node,
  // production boards, gateways, pubsub providers): its numbers move with that infrastructure's
  // load and health, not only with pkc-js, so it is monitoring, not a version comparison
  environmentDependent?: boolean
  // run this cell once more under the CPU profiler with start.ts --profile (one cell per scenario
  // is enough: profiling every cell doubles a version's run for little extra information)
  profile?: boolean
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

// fetch-comment: which comments to fetch. Never hardcoded CIDs (they go stale as boards purge old
// threads): the benchmark server picks live ones from the boards' current pages at run time, so
// every cell of one run fetches the same comments (see /comments-sample in lib/server.ts).
export interface CommentSampleSpec {
  // how many boards to spread the sample over (the first ones in directory order that load)
  communities: number
  // total posts and replies, taken round-robin from those boards
  posts: number
  replies: number
}

export interface CommentListBenchmarkOptions extends BaseBenchmarkOptions {
  sample: CommentSampleSpec
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
// each get their own kubo/helia/gateway transport. See lib/local-community-host.ts.
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
  localPublishBenchmarkOptions: LocalPublishBenchmarkOptions[]
  commentUpdatePropagationBenchmarkOptions: CommentUpdatePropagationBenchmarkOptions[]
  seededBoardBenchmarkOptions: SeededBoardBenchmarkOptions[]
  importTimeBenchmarkOptions: ImportTimeBenchmarkOptions[]
  rpcCommunityListBenchmarkOptions: RpcCommunityListBenchmarkOptions[]
  soakBenchmarkOptions: SoakBenchmarkOptions[]
  // not a cell list: the seeded-board fixture shapes, by name
  boardFixtures: Record<string, BoardFixtureSpec>
  publishBenchmarkOptions: PublishBenchmarkOptions[]
  replyPropagationBenchmarkOptions: ReplyPropagationBenchmarkOptions[]
  fetchIpnsBenchmarkOptions: CommunityListBenchmarkOptions[]
  fetchCommentBenchmarkOptions: CommentListBenchmarkOptions[]
  resolveAddressesBenchmarkOptions: CommunityListBenchmarkOptions[]
  gatewayFetchIpnsBenchmarkOptions: CommunityListBenchmarkOptions[]
  loadCommunitiesBenchmarkOptions: LoadCommunitiesBenchmarkOptions[]
}

export type BenchmarkOptionsType = Exclude<keyof BenchmarkOptionsFile, 'boardFixtures'>

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
  // newer benchmarks (see their *Metrics interfaces above)
  publications?: Record<string, LocalPublishMetrics>
  updates?: Record<string, CommentUpdatePropagationMetrics>
  board?: SeededBoardMetrics
  imports?: ImportMetrics
  rpc?: RpcCommunityListMetrics
  soak?: SoakMetrics
  // cell-level summary numbers that don't belong to any one sample
  aggregate?: Record<string, number | null>
  process?: ProcessMetrics
  communityProcess?: ProcessMetrics
  cpuProfile?: CpuProfileSummary
  communityCpuProfile?: CpuProfileSummary
  // an extra repetition run under the CPU profiler: its timings carry the profiler's overhead
  profiled?: boolean
  // the cell did not produce a measurement (crash, timeout, unsupported); written by start.ts
  error?: {message: string}
  unsupported?: boolean
  // see BaseBenchmarkOptions.environmentDependent; stamped by start.ts
  environmentDependent?: boolean
  // stamped on every entry by start.ts
  pkcJsVersion?: string
  harnessCommit?: string
  measuredAt?: string
  environment?: RunEnvironment
  // stamped by scripts/anchor-ratios.ts on backfilled entries
  anchor?: AnchorComparison
  pkcJsCommitHash?: string
}

// Health of whichever process ran a measurement: the benchmark process itself (node or chrome)
// under `process`, the benchmark server's local community under `communityProcess`. Sampled by
// lib/process-metrics.ts (node) and lib/runtime-metrics.ts (chrome). Every key ends in a unit
// suffix (MB, Ms, Percent, Count) so reports-ui charts it next to the TimeSeconds metrics.
export interface ProcessMetrics {
  peakRssMB?: number | null
  peakHeapUsedMB?: number | null
  // heap still in use after a forced full GC at the end of the cell: what the cell actually retains
  heapUsedAfterGcMB?: number | null
  cpuUserMs?: number | null
  cpuSystemMs?: number | null
  eventLoopUtilizationPercent?: number | null
  eventLoopDelayP99Ms?: number | null
  eventLoopDelayMaxMs?: number | null
  gcPauseTotalMs?: number | null
  gcPauseMaxMs?: number | null
  gcCount?: number | null
  peakOpenFdsCount?: number | null
  // chrome only: main-thread tasks over 50ms (PerformanceObserver 'longtask')
  longTaskTotalMs?: number | null
  longTaskCount?: number | null
  // kubo daemons the measured process drives, by node name (read from /proc/<pid>/status)
  kuboPeakRssMBByNode?: Record<string, number | null>
}

// CPU self time from a .cpuprofile, attributed to the npm package each sampled function came from.
// pkc-js ships its dependencies bundled into dist/bundled/chunks, so a frame inside a chunk is
// attributed through the bundler's `//#region <module path>` markers rather than its file name
// (see lib/cpu-profile.ts). The full profile is uploaded as a CI artifact, never into reports/.
export interface CpuProfileSummary {
  sampledTimeMs: number
  selfMsByPackage: Record<string, number>
  // pkc-js's own self time by source module (top 15), e.g. runtime/node/community/db-handler
  pkcJsSelfMsByModule: Record<string, number>
  topFunctions: {name: string; package: string; selfMs: number}[]
  // the full profile: cpu-profiles/v<version>/... once collected (scripts/collect-profiles.ts),
  // relative to profiles/ before that
  file?: string
}

// local-publish: how fast the harness's own community takes publications in, measured from the
// publishing client (this process, node or chrome) — publish() until challengeverification — and
// on the community side (CPU per publication in the benchmark server). This is the path every
// production publication goes through: challenge exchange, signature verification, storage.
export type LocalChallengeKind = 'none' | 'question'

export interface LocalPublishBenchmarkOptions extends BaseBenchmarkOptions {
  challenge: LocalChallengeKind
  // publications fired at once in each round
  burst: number
  rounds: number
  // every publication of a round signed by one author (exercises the per-author alias lock, v0.0.111)
  sameAuthor?: boolean
}

export interface LocalPublishMetrics {
  publishToVerificationTimeSeconds?: number | null
  // question challenge only: publish() until the challenge arrives
  publishToChallengeTimeSeconds?: number | null
  error?: {message: string}
}

// comment-update-propagation: like reply-propagation, but for the two other things that change a
// CommentUpdate — a vote and an author edit. Since v0.0.98 the community's publish loop wakes up on
// votes and edits instead of waiting for its next interval, which is exactly what this tracks.
export interface CommentUpdatePropagationBenchmarkOptions extends BaseBenchmarkOptions {
  samples?: number
  sampleTimeoutSeconds?: number
}

export interface CommentUpdatePropagationMetrics {
  postInitialLoadTimeSeconds?: number | null
  votePublishTimeSeconds?: number | null
  // accepted vote -> upvoteCount visible on the reading client
  votePropagationTimeSeconds?: number | null
  editPublishTimeSeconds?: number | null
  // accepted author edit -> edited content visible on the reading client
  editPropagationTimeSeconds?: number | null
  error?: {message: string}
}

// seeded-board: a local community on a pre-built board (lib/board-fixture.ts), driven only through
// the public API so it runs on every version. The board is seeded once, by the OLDEST pkc-js in the
// backfill window, and every version under test starts on a copy of it, so newer versions also pay
// (and report) their database migration.
export interface BoardFixtureSpec {
  posts: number
  minReplies: number
  maxReplies: number
  postsPerAuthor: number
}

export interface PageSortSetting {
  name?: string
  path?: string
  options?: Record<string, string>
  preloaded?: boolean
}

export interface SeededBoardBenchmarkOptions extends BaseBenchmarkOptions {
  // key in boardFixtures (benchmark-options.ts)
  fixture: string
  // settings.pages (pkc-js v0.0.108+); unset = the version's default sorts
  pages?: {posts?: PageSortSetting[]; replies?: PageSortSetting[]}
  // how many "one new post -> next published record" cycles to time once the board is up
  steadySamples?: number
  // give up on the whole cell after this long (old versions can take very long on big boards)
  cellTimeoutMinutes?: number
}

export interface SeededBoardMetrics {
  fixturePostsCount?: number
  fixtureCommentsCount?: number
  // PKC() + createCommunity() on the copied data path
  createCommunityTimeSeconds?: number | null
  // edit({settings: {pages}}), page-sort cells only
  settingsEditTimeSeconds?: number | null
  // community.start() until it resolves (database migration, repin walk, purges)
  startTimeSeconds?: number | null
  // community.start() until the first record is published: the first full cycle on this board
  startToFirstUpdateTimeSeconds?: number | null
  // per steady sample: new post accepted -> a published record whose lastPostCid is that post
  steadyCycles?: Record<string, {postToRecordTimeSeconds?: number | null; error?: {message: string}}>
  medianPostToRecordTimeSeconds?: number | null
  dbSizeMB?: number | null
  // bytes the community's kubo repo grew by over the whole cell
  ipfsRepoGrowthMB?: number | null
  error?: {message: string}
}

// import-time: what `import('@pkcprotocol/pkc-js')` costs a fresh process (node), or the page (chrome)
export interface ImportTimeBenchmarkOptions extends BaseBenchmarkOptions {
  samples: number
}

export interface ImportMetrics {
  // node: fresh process, empty compile cache / primed compile cache
  coldImportTimeSeconds?: Record<string, number>
  warmImportTimeSeconds?: Record<string, number>
  medianColdImportTimeSeconds?: number | null
  medianWarmImportTimeSeconds?: number | null
  // `node -e 0`, so a slower runner can be told apart from a slower pkc-js
  medianNodeStartupTimeSeconds?: number | null
  loadedModulesCount?: number | null
  packedTarballMB?: number | null
  unpackedMB?: number | null
  tarballFilesCount?: number | null
  // chrome: dynamic import() of the browser build in the page
  browserImportTimeSeconds?: Record<string, number>
  error?: {message: string}
}

// rpc-community-list: a pkc-js RPC server owning N started local communities, and a fresh RPC
// client in its own process listing them the way `bitsocial community list` does
export interface RpcCommunityListBenchmarkOptions extends BaseBenchmarkOptions {
  communities: number
  postsPerCommunity: number
}

export interface RpcCommunityListMetrics {
  communitiesCount?: number
  // client connect -> pkc.communities lists every community
  listTimeSeconds?: number | null
  listReceivedBytes?: number | null
  // then createCommunity() + first update on every listed community (the per-community path)
  perCommunityLoadTimeSeconds?: number | null
  perCommunityReceivedBytes?: number | null
  receivedPerCommunityBytes?: number | null
  // the RPC server's event loop while it served the client
  serverEventLoopDelayMaxMs?: number | null
  serverEventLoopDelayP99Ms?: number | null
  error?: {message: string}
}

// soak: one local community taking a steady trickle of publications for many minutes. Scheduled,
// not run on every release (see .github/workflows/benchmark-soak.yml).
export interface SoakBenchmarkOptions extends BaseBenchmarkOptions {
  minutes: number
  publicationsPerMinute: number
}

export interface SoakMetrics {
  publicationsCount?: number
  failedPublicationsCount?: number
  heapAfterGcStartMB?: number | null
  heapAfterGcEndMB?: number | null
  // least-squares slope of heap-after-GC over publications: what each publication leaves behind
  heapGrowthPerPublicationBytes?: number | null
  rssStartMB?: number | null
  rssEndMB?: number | null
  medianPostToRecordTimeSeconds?: number | null
  // kubo `repo gc` on the community's node, and the first publish cycle that has to run after it
  repoGcTimeSeconds?: number | null
  postToRecordAfterRepoGcTimeSeconds?: number | null
  deleteTimeSeconds?: number | null
  error?: {message: string}
}

// Where and with what a report entry was measured, stamped on every entry by start.ts. Backfilled
// entries are measured long after their release, on whatever runner GitHub hands out, so this is
// what tells a real regression from a different machine (see scripts/anchor-ratios.ts).
export interface RunEnvironment {
  cpuModel?: string
  cpus?: number
  memoryGB?: number
  kernel?: string
  node?: string
  runnerName?: string
}

export interface AnchorComparison {
  // pkc-js version that was benchmarked in the same CI job as this entry
  version: string
  // this entry's median / the anchor entry's median, per metric key (same type, name, runtime)
  ratios: Record<string, number>
}
