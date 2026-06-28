historical benchmarks for each pkc-js commit are saved to `./reports/<commit-hash>.txt` and can be visualized at https://pkcprotocol.github.io/pkc-js-benchmarks/reports-ui

### getting started
```
git clone https://github.com/pkcprotocol/pkc-js-benchmarks.git
npm install
npm start -- --runtime node --benchmark fetch-ipns
```

### running specific benchmarks

```
npm start -- --runtime node|chrome --benchmark resolve-addresses|fetch-ipns|gateway-fetch-ipns|fetch-comment|publish|load-communities
```

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
