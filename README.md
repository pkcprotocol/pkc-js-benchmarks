historical benchmarks for each pkc-js commit are saved to `./reports/<commit-hash>.txt` and can be visualized at https://pkcprotocol.github.io/pkc-js-benchmarks/reports-ui

### getting started
```
git clone https://github.com/pkcprotocol/pkc-js-benchmarks.git
npm install
npm start -- --runtime node --benchmark fetch-ipns
```

### running specific benchmarks

```
npm start -- --runtime node|chrome --benchmark resolve-addresses|fetch-ipns|gateway-fetch-ipns|fetch-comment|publish|reply-propagation|load-communities|comment-update-propagation|local-publish|import-time|seeded-board|rpc-community-list|soak
```

- `--benchmark` can be repeated; without it every benchmark runs except the opt-in `soak`
- `--only <text>` runs only the cells whose name contains `<text>` (within the benchmarks that have such a cell)
- `--profile` runs the cells marked `profile: true` once more under the CPU profiler (node only), reported as `<name> (cpu profiled)`
- `BENCHMARK_SERVER_PORT=3100` moves the benchmark server off port 3000; `PLAYWRIGHT_CHROMIUM_PATH` points at a system chromium

Every benchmark is one row of `lib/benchmark-registry.ts`. Each cell (one options entry × one runtime)
runs in a fresh process with a wall-time cap; a cell that crashes, hangs past its cap, or needs a
newer pkc-js than the one installed (`minPkcJsVersion` on its options) still leaves a report entry,
with an `error` (and `unsupported: true`), so "not measured" can always be told from "failed".

### local-community benchmarks

These run against communities the harness hosts itself on a private kubo mesh (no public network),
so unlike the production cells they don't decay as boards, CIDs and providers change — which is
also what makes their history worth backfilling over old releases.

| benchmark | what it measures | runtimes |
|---|---|---|
| `local-publish` | publish() → challengeverification on the harness's community, per publication, in bursts of 1/10/50 (kubo or libp2p-js publisher, no challenge or a `question` challenge, one cell with a single author); throughput and the community's CPU per publication | node, chrome |
| `comment-update-propagation` | a vote → `upvoteCount` visible on another client, an author edit → edited content visible (kubo, libp2p-js and gateway readers) | node, chrome |
| `seeded-board` | a community started on a pre-built board (300 posts / ~16k comments; 2k / ~113k weekly): createCommunity, start() (incl. the DB migration), first published record, then one new post → the next record; DB size, IPFS repo growth; page-sort variants via `settings.pages` (v0.0.108+) | node |
| `rpc-community-list` | a pkc-js RPC server with 10 started communities and a fresh RPC client listing them and loading each: wall time, bytes on the wire, the server's event-loop stall | node |
| `import-time` | `import('@pkcprotocol/pkc-js')` in fresh node processes (cold and warm compile cache), modules loaded, tarball size; first dynamic import in chromium | node, chrome |
| `soak` (opt-in, weekly) | 30 minutes of steady publications: heap growth per publication after GC, `repo gc` stall, `delete()` time | node |

The seeded boards are built once by the **oldest** pkc-js of the backfill window
(`FIXTURE_PKC_JS_VERSION`, default `0.0.95`) with real signatures and CIDs (`lib/build-board-fixture.ts`,
ported from pkc-js's `large-board-seeder.ts`), cached in `.fixtures/`, and copied fresh for every cell,
so every newer version also pays — and reports — its migration from that schema.

### process metrics and cpu profiles

Every entry carries `process` (the benchmark process: peak RSS, heap after a forced GC, CPU,
event-loop utilization and delay, GC pauses, open fds — in chromium: JS heap and long tasks), and the
local-community cells also `communityProcess` (the server process hosting the community, plus its
kubo daemon's RSS). With `--profile`, profiled entries carry `cpuProfile`/`communityCpuProfile`: CPU
self time per npm package (attributed through the bundler's `//#region` markers, since pkc-js ships
its dependencies bundled) and the top functions. The full `.cpuprofile` files are committed next to
the reports, one folder per version: `cpu-profiles/v<version>/v<version>--<benchmark>--<cell>.cpuprofile`
(`--community` for the community host's profile), and each entry's `cpuProfile.file` is that path.
Open one in Chrome DevTools (Performance > Load profile) or https://www.speedscope.app.

Every entry is also stamped with `pkcJsVersion`, `harnessCommit`, `measuredAt` and `environment`
(CPU model, cores, memory, kernel, node, runner).

### environment-dependent cells

Cells that measure infrastructure the harness does not control — the remote-community
reply-propagation cells (someone else's node and its traffic) and every benchmark against production
5chan boards, gateways, routers and pubsub providers (`publish`, `fetch-ipns`, `fetch-comment`,
`resolve-addresses`, `load-communities`, `gateway-fetch-ipns`) — are labelled
`environmentDependent: true` (an "environment-dependent" badge in the reports UI). They still run on
every release, as monitoring of what a real client sees, but their numbers move with that
infrastructure's load and health, so they are not a version-to-version comparison and are never
backfilled. For that, use the local-community cells.

### CI: releases, backfill, soak

- `benchmark-releases.yml` polls npm every 6h and benchmarks every release without a report (full matrix + profiled repetitions). All three workflows push through `scripts/commit-reports.sh`, which rebases onto concurrent pushes and rebuilds `reports/all.json`; backfill and soak have their own concurrency groups (a pending run in a shared group would be cancelled by the next release cron).
- `benchmark-backfill.yml` (manual) runs only the named benchmarks on the last N releases that don't have them yet, and **merges** them into each version's report (`scripts/merge-report.ts` replaces exactly the cells it re-measured). It never writes `.failed`. It also benchmarks a fixed anchor version every few versions in the same job and stamps each backfilled entry with `anchor.ratios` (its median ÷ the anchor's, per metric), since hosted runners differ enough to fake a regression in absolute numbers.
- `benchmark-soak.yml` (weekly) runs `soak` and the M seeded board on the latest release.

The remote-community reply-propagation cells need the remote community's current challenge answer
in the `REMOTE_COMMUNITY_CHALLENGE_ANSWER` repository secret (its owner rotates it).

### reply-propagation benchmark

`reply-propagation` answers: **one client is sitting on a post with `post.update()`; a completely
separate client publishes a reply to that post and succeeds — how long until the reply shows up on
the first client?**

- the two clients are separate **processes**: the reading client is the benchmark itself (node or
  a real browser), the publishing client lives in the benchmark server (`lib/reply-propagation-host.ts`)
- each side gets its **own kubo node**, and the reading client's transport is the config axis:
  `kubo rpc`, `libp2p js client` (helia) and `ipfs gateway` learn about a new reply in completely
  different ways
- the timer starts when the community *accepts* the reply (`challengeverification`, success) and
  stops when the reply is actually reachable on the reading client (in the post's replies pages)

The community is **not** a production 5chan board on purpose: those answer a challenge request with
an interactive `url/iframe` Spam Blocker challenge, so no headless client can ever publish to one
successfully — and "the publish succeeded" is half of this measurement. Instead the harness boots
its own community with `challenges: []` on its own kubo node (`lib/kubo-nodes.ts`). The three nodes
have no public bootstrap peers and are wired only to each other, so what is measured is the pkc-js
pipeline — community accepts the reply, community publishes a new record, client notices and
fetches it — and not today's weather on the public DHT.

```
npm start -- --benchmark reply-propagation                  # full matrix (node + chrome)
npm start -- --runtime node --benchmark reply-propagation
REPLY_PROPAGATION_SAMPLES=1 npm start -- --benchmark reply-propagation   # quick smoke run
```

Each sample is a fresh post and a fresh reply; the report medians over `samples` (3 by default).

The **first sample of every cell is reported on its own rows** (`… (first sample)`): it is the only
one whose reading client had never talked to that community before, so it also pays whatever that
first contact costs. Usually that is nothing measurable — first and later samples land within noise
of each other — but one run against a remote community measured **58.7s on the first sample against
0.44s on the second**, which dragged the cell's median to a number no reader ever experiences.
Keeping the two apart makes an outlier like that visible instead of letting it move the headline.
The plain rows are the steady state: what a user with the thread already open sees.

#### remote community cells

The `remote community, reader: …` cells run the same measurement against a community that lives on
**another machine** and is reached over the public network (a test community whose `question`
challenge answer only its owner can read, in `community.settings`; the benchmark reads it from the
`REMOTE_COMMUNITY_CHALLENGE_ANSWER` env var, and the cells fail with `Wrong answer.` when the owner
has rotated it). Both clients still run locally — only the community
is remote, which is the point: it measures what a reply update actually costs a client when the
community is a remote node, with production gateways/routers/pubsub providers in between.

For the kubo reader the harness boots a kubo node on the public network and writes the same
`Routing` config pkc-js writes for a production node (routers for `find-providers`/`provide`,
`get-ipns` to the not-supported sentinel, so IPNS resolves over ipns-over-pubsub) **before**
starting it — otherwise pkc-js notices the config change on init, rewrites it and POSTs `/shutdown`
to the node mid-benchmark.

The first sample of these cells is also the one where a freshly booted kubo node has to bootstrap
into the network and join the community's IPNS pubsub topic before anything can arrive; it is
reported on its own `(first sample)` rows for that reason (see above).

### load-communities benchmark

`load-communities` loads **every** production 5chan board over Helia/libp2p-js in pure-P2P
browser mode and measures where the time goes (modeled on `investigate_why_5chan_p2p_is_slow`):

- the board list is **discovered live from GitHub at runtime** (nothing hardcoded) — see
  `lib/discover-communities.ts`
- boards are loaded in parallel (configurable concurrency) and it prints **per-community load
  time** plus a per-phase breakdown
- it snapshots **peers & transports** — how many connected peers a real browser can use
  (`wss`/`webtransport`/`webrtc`) and how many provider addresses are undialable from a browser

Runtime (`node` vs `chrome`) is one axis of the matrix; the config variants in
`benchmark-options.ts` (e.g. `concurrency`) are the other. Run with no `--runtime` to execute
every cell. **`node` is the all-transports baseline** (tcp/quic allowed — it loads over whatever
transport works, like a non-browser peer). **`chrome` is the real browser** and can only use
browser transports; there a connectionGater (`countNonBrowserDials`) counts how many provider
addresses were undialable from the browser. So node-vs-chrome shows what a real browser loses.

```
npm start -- --benchmark load-communities                 # full matrix (node + chrome)
npm start -- --runtime chrome --benchmark load-communities
```

### editing benchmark options (the pkc options used, the community addresses, etc)

edit the file `./benchmark-options.ts`. this is needed to do manual debugging with specific pkc options.

### print reports

reports are saved to `./report.json`. running `npm start` overwrites the previous report. `node lib/print-report.ts reports/<gitHead>.json` prints a saved one.

```
npm run report
npm run report:inline
```

### typecheck

```
npm run check
```

### how it all works

- 1. `npm start` launches `node ./start.ts` (with optional arguments `--runtime <runtime> --benchmark <benchmark>`)
- 2. `node ./start.ts` launches:
  - 1. `./lib/server.ts` which is needed to communicate with the browser benchmarks
  - 2. it reads `./lib/benchmark-registry.ts` and `./benchmark-options.ts` and iterates over all the cells to do
  - 3. for each cell, it launches vitest in either node or a real browser (chromium via `@vitest/browser-playwright`), or for the script benchmarks (`benchmark/*.script.ts`) a plain node process, to execute it in an isolated environment (i.e. no pkc-js caching)
  - 4. it launches `npm run report` to print the last report (saved to `./report.json`)

> the TypeScript files are run directly by node (native type stripping, node ≥ 22.18) — there is no build step.
