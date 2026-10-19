import PKC from '@pkcprotocol/pkc-js'

// The RPC client half of the rpc-community-list benchmark, in its own process so the server's event
// loop and the client's are measured apart: connect, wait until pkc.communities lists every
// community, then load each one the way `bitsocial community list` used to (createCommunity per
// address). Prints LISTED when the list is complete (the server samples its byte counter then) and
// RESULT=<json> at the end.
// usage: node lib/rpc-list-client.ts <ws url> <expected community count>

const [url, expectedArg] = process.argv.slice(2)
const expected = Number(expectedArg)
if (!url || !expected) throw Error('usage: rpc-list-client.ts <ws url> <expected community count>')

const before = Date.now()
const pkc: any = await PKC({pkcRpcClientsOptions: [url]} as never)
pkc.on('error', (e: Error) => console.error('rpc client pkc error:', e.message))
await new Promise<void>((resolve) => {
  const check = () => {
    if ((pkc.communities?.length ?? 0) < expected) return
    pkc.removeListener?.('communitieschange', check)
    resolve()
  }
  pkc.on('communitieschange', check)
  check()
})
const listTimeSeconds = (Date.now() - before) / 1000
console.log('LISTED')

const beforeLoad = Date.now()
for (const address of pkc.communities as string[]) {
  const community = await pkc.createCommunity({address})
  // what the CLI printed per community; reading it is enough to have it all over the wire
  void community.started
}
const perCommunityLoadTimeSeconds = (Date.now() - beforeLoad) / 1000
console.log('RESULT=' + JSON.stringify({communitiesCount: pkc.communities.length, listTimeSeconds, perCommunityLoadTimeSeconds}))
await pkc.destroy().catch(() => {})
process.exit(0)
