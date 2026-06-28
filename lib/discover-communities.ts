import type {CommunityIdentifier} from '../types.ts'

// Discover the real production 5chan boards live from GitHub. NOTHING is hardcoded —
// the board list is fetched at runtime so the benchmark always loads the current set.
//
// This module is BROWSER-SAFE on purpose (only `fetch`, no node: imports): the
// load-communities benchmark also runs inside real Chromium via @vitest/browser-playwright.
//
// Endpoints (verified live):
//   <base>/5chan-directories-defaults.json -> { directories: { <code>: {...} } }  (object keyed by code)
//   <base>/5chan-<code>-directory.json     -> { boards: [{ address, publicKey, ... }] }

export const DEFAULT_LISTS_BASE_URL = 'https://raw.githubusercontent.com/bitsocialnet/lists/master/5chan-directories'

const defaultsUrl = (base: string) => `${base}/5chan-directories-defaults.json`
const perCodeUrl = (base: string, code: string) => `${base}/5chan-${code}-directory.json`

// Run async tasks with a fixed concurrency cap, preserving input order in the output.
export const runPool = async <T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> => {
  const results = new Array<R>(items.length)
  let next = 0
  const runners = Array.from({length: Math.max(1, Math.min(concurrency, items.length))}, async () => {
    while (true) {
      const i = next++
      if (i >= items.length) return
      results[i] = await worker(items[i]!, i)
    }
  })
  await Promise.all(runners)
  return results
}

const fetchJson = async (url: string, timeoutMs = 15_000): Promise<any> => {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(url, {signal: controller.signal})
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`)
    return await res.json()
  } finally {
    clearTimeout(timer)
  }
}

interface DirectoryBoard {
  address?: string
  publicKey?: string
}

// Fetch the directory defaults to learn every directory code, fetch each per-code
// board list (with a small concurrency pool), flatten, and dedupe by publicKey so a
// board listed under multiple directories is only loaded once.
export const discoverCommunities = async (listsBaseUrl: string = DEFAULT_LISTS_BASE_URL): Promise<CommunityIdentifier[]> => {
  const base = listsBaseUrl || DEFAULT_LISTS_BASE_URL
  console.log(`discovering communities from ${base}`)
  const defaults = await fetchJson(defaultsUrl(base))
  const codes = Object.keys(defaults?.directories ?? {})
  console.log(`found ${codes.length} directory codes, fetching per-code board lists...`)

  const perCode = await runPool(codes, 8, async (code) => {
    try {
      const dir = await fetchJson(perCodeUrl(base, code))
      return (dir?.boards ?? []) as DirectoryBoard[]
    } catch (e) {
      console.log(`  [${code}] skipped: ${(e as Error).message}`)
      return [] as DirectoryBoard[]
    }
  })

  const seen = new Set<string>()
  const communities: CommunityIdentifier[] = []
  for (const board of perCode.flat()) {
    if (!board?.address || !board?.publicKey) continue
    if (seen.has(board.publicKey)) continue
    seen.add(board.publicKey)
    // pass both name (the domain) and publicKey (the IPNS key) — the "magnet" load:
    // pkc-js resolves the record straight from the IPNS key, never blocking on a name resolver.
    communities.push({name: board.address, publicKey: board.publicKey})
  }
  console.log(`discovered ${communities.length} unique production communities`)
  return communities
}
