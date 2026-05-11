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

export interface CommunityListBenchmarkOptions extends BaseBenchmarkOptions {
  communityAddresses: string[]
}

export interface CommentListBenchmarkOptions extends BaseBenchmarkOptions {
  commentCids: string[]
}

export interface PublishBenchmarkOptions extends BaseBenchmarkOptions {
  communityAddress: string
}

export interface BenchmarkOptionsFile {
  publishBenchmarkOptions: PublishBenchmarkOptions[]
  fetchIpnsBenchmarkOptions: CommunityListBenchmarkOptions[]
  fetchCommentBenchmarkOptions: CommentListBenchmarkOptions[]
  resolveAddressesBenchmarkOptions: CommunityListBenchmarkOptions[]
  gatewayFetchIpnsBenchmarkOptions: CommunityListBenchmarkOptions[]
}

export type BenchmarkOptionsType = keyof BenchmarkOptionsFile

export interface CommunityMetrics {
  resolvingAddressTimeSeconds?: number | null
  fetchingIpnsTimeSeconds?: number | null
  fetchingIpfsTimeSeconds?: number | null
  challengeRequestTimeSeconds?: number | null
  challengeTimeSeconds?: number | null
  challengeAnswerTimeSeconds?: number | null
  challengeVerificationTimeSeconds?: number | null
  failedAt?: number
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
}
