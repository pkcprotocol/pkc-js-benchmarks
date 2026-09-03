historical benchmarks for each pkc-js commit are saved to `./reports/<commit-hash>.txt` and can be visualized at https://pkcprotocol.github.io/pkc-js-benchmarks/reports-ui

### getting started
```
git clone https://github.com/pkcprotocol/pkc-js-benchmarks.git
npm install
npm start -- --runtime node --benchmark fetch-ipns
```

### running specific benchmarks

```
npm start -- --runtime node|chrome --benchmark resolve-addresses|fetch-ipns|gateway-fetch-ipns|fetch-comment|publish|reply-propagation|load-communities
```

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

#### remote community cells (opt-in, not run by CI)

```
REPLY_PROPAGATION_REMOTE=1 npm start -- --runtime node --benchmark reply-propagation
```

These are **off by default**: they publish real posts and replies to a community someone else
operates and depend on that machine being up, neither of which belongs in an unattended benchmark
that runs on every release. The default cells already cover the same three reader transports on
hardware the CI owns.

The `remote community, reader: …` cells run the same measurement against a community that lives on
**another machine** and is reached over the public network (a test community whose `question`
challenge answer its owner publishes in the community's own settings, so the benchmark answers the
challenge instead of needing a moderator role). Both clients still run locally — only the community
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

reports are saved to `./report.json`. running `npm start` overwrites the previous report.

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
  - 2. it reads `./benchmark-options.ts` and iterates over all the benchmarks to do
  - 3. for each benchmark to do, it launches vitest in either node or a real browser (chromium via `@vitest/browser-playwright`) to execute it in an isolated environment (i.e. no pkc-js caching)
  - 4. it launches `npm run report` to print the last report (saved to `./report.json`)

> the TypeScript files are run directly by node (native type stripping, node ≥ 22.18) — there is no build step.
