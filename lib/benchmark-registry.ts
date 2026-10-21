import type {BenchmarkOptionsType, Runtime} from '../types.ts'

// Every benchmark is one row. A cell is one options entry x one runtime; each cell runs in a fresh
// process and posts its own report entry to the server. start.ts makes sure every cell leaves an
// entry behind: a cell that crashed, hung past its cap, or needs a newer pkc-js gets an entry with
// `error` (and `unsupported`) instead of silently missing — so a partial backfill can tell "not
// measured" from "failed" — and one broken cell never costs the rest of the run.
export interface BenchmarkDefinition {
  // the --benchmark name
  name: string
  file: string
  optionsType: BenchmarkOptionsType
  // vitest: a vitest test file, run in node and/or chromium. script: a plain node script (node only)
  runner: 'vitest' | 'script'
  runtimes: Runtime[]
  // wall-time cap per cell; an options entry's cellTimeoutMinutes wins
  cellTimeoutMinutes: number
  // cap for the profiled repetition, when the profiler's overhead needs more than cellTimeoutMinutes
  profiledCellTimeoutMinutes?: number
  // the cell's community lives in this server (lib/local-community-host.ts)
  usesLocalCommunityHost?: boolean
  // its cells can be profiled (cells opt in with `profile: true` on their options)
  profile?: boolean
  // only runs when named with --benchmark
  optIn?: boolean
  // every cell measures production infrastructure (see BaseBenchmarkOptions.environmentDependent)
  environmentDependent?: boolean
}

export const benchmarks: BenchmarkDefinition[] = [
  {name: 'publish', file: 'benchmark-publish.ts', optionsType: 'publishBenchmarkOptions', runner: 'vitest', runtimes: ['node', 'chrome'], cellTimeoutMinutes: 22, environmentDependent: true},
  {
    name: 'reply-propagation',
    file: 'benchmark-reply-propagation.ts',
    optionsType: 'replyPropagationBenchmarkOptions',
    runner: 'vitest',
    runtimes: ['node', 'chrome'],
    cellTimeoutMinutes: 22,
    usesLocalCommunityHost: true,
  },
  {
    name: 'comment-update-propagation',
    file: 'benchmark-comment-update-propagation.ts',
    optionsType: 'commentUpdatePropagationBenchmarkOptions',
    runner: 'vitest',
    runtimes: ['node', 'chrome'],
    cellTimeoutMinutes: 15,
    usesLocalCommunityHost: true,
  },
  {
    name: 'local-publish',
    file: 'benchmark-local-publish.ts',
    optionsType: 'localPublishBenchmarkOptions',
    runner: 'vitest',
    runtimes: ['node', 'chrome'],
    cellTimeoutMinutes: 10,
    usesLocalCommunityHost: true,
    profile: true,
  },
  {name: 'fetch-ipns', file: 'benchmark-fetch-ipns.ts', optionsType: 'fetchIpnsBenchmarkOptions', runner: 'vitest', runtimes: ['node', 'chrome'], cellTimeoutMinutes: 22, environmentDependent: true},
  {name: 'fetch-comment', file: 'benchmark-fetch-comment.ts', optionsType: 'fetchCommentBenchmarkOptions', runner: 'vitest', runtimes: ['node', 'chrome'], cellTimeoutMinutes: 22, environmentDependent: true},
  {
    name: 'resolve-addresses',
    file: 'benchmark-resolve-addresses.ts',
    optionsType: 'resolveAddressesBenchmarkOptions',
    runner: 'vitest',
    runtimes: ['node', 'chrome'],
    cellTimeoutMinutes: 22,
    environmentDependent: true,
  },
  {
    name: 'load-communities',
    file: 'benchmark-load-communities.ts',
    optionsType: 'loadCommunitiesBenchmarkOptions',
    runner: 'vitest',
    runtimes: ['node', 'chrome'],
    cellTimeoutMinutes: 22,
    environmentDependent: true,
  },
  {
    name: 'gateway-fetch-ipns',
    file: 'benchmark-gateway-fetch-ipns.ts',
    optionsType: 'gatewayFetchIpnsBenchmarkOptions',
    runner: 'vitest',
    runtimes: ['node', 'chrome'],
    cellTimeoutMinutes: 22,
    environmentDependent: true,
  },
  {name: 'import-time', file: 'benchmark-import-time.ts', optionsType: 'importTimeBenchmarkOptions', runner: 'vitest', runtimes: ['node', 'chrome'], cellTimeoutMinutes: 10},
  {
    name: 'seeded-board',
    file: 'benchmark-seeded-board.script.ts',
    optionsType: 'seededBoardBenchmarkOptions',
    runner: 'script',
    runtimes: ['node'],
    // pre-v0.0.108 versions take ~17 minutes to the first record on a GitHub runner
    cellTimeoutMinutes: 35,
    // a profiled pre-v0.0.108 run is slower still, and a cell killed at its cap writes no profile
    profiledCellTimeoutMinutes: 50,
    profile: true,
  },
  {
    name: 'rpc-community-list',
    file: 'benchmark-rpc-community-list.script.ts',
    optionsType: 'rpcCommunityListBenchmarkOptions',
    runner: 'script',
    runtimes: ['node'],
    cellTimeoutMinutes: 15,
    profile: true,
  },
  {name: 'soak', file: 'benchmark-soak.script.ts', optionsType: 'soakBenchmarkOptions', runner: 'script', runtimes: ['node'], cellTimeoutMinutes: 90, optIn: true, profile: true},
]

export const benchmarkByName = (name: string): BenchmarkDefinition | undefined => benchmarks.find((b) => b.name === name)
