import {spawn} from 'node:child_process'
import net from 'node:net'
import fs from 'fs-extra'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {monitorEventLoopDelay} from 'node:perf_hooks'
import PKC from '@pkcprotocol/pkc-js'
import {startScriptMesh, kuboPkcOptions, withDeadline, cellDeadlineMs} from '../lib/script-mesh.ts'
import {startProcessMetrics} from '../lib/process-metrics.ts'
import {getBenchmarkContext, writeReport} from '../lib/benchmark-client.ts'
import type {BenchmarkReport, RpcCommunityListBenchmarkOptions, RpcCommunityListMetrics} from '../types.ts'

// A pkc-js RPC server owning N started local communities, and a fresh RPC client (its own process,
// lib/rpc-list-client.ts) listing them and then loading each one — what `bitsocial community list`
// does. That command once took ~22s on a production host: the daemon sent ~0.9MB of JSON per owned
// community and blocked its event loop ~1s at a time serializing it. Tracked here as wall time,
// bytes on the wire (counted by a TCP proxy between client and server) and the server's event loop.
//
// A plain node script (node only): the RPC server and its communities are this process.

const benchmarkOptionsType = 'rpcCommunityListBenchmarkOptions'
const rootPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const cellDir = path.join(rootPath, '.pkc-rpc-community-list')
const rpcPort = 39138
const proxyPort = 39139

const {options, reportName} = await getBenchmarkContext<RpcCommunityListBenchmarkOptions>(benchmarkOptionsType)
const beforeReportTimestamp = Date.now()
const deadline = Date.now() + cellDeadlineMs() - 60_000
const remainingMs = () => Math.max(1000, deadline - Date.now())
const rpc: RpcCommunityListMetrics = {listTimeSeconds: null, perCommunityLoadTimeSeconds: null}
const sampler = startProcessMetrics()
process.on('unhandledRejection', (e) => console.log('unhandled rejection:', (e as Error)?.message ?? e))

const runClient = (url: string, expected: number, onListed: () => void): Promise<any> =>
  new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(rootPath, 'lib', 'rpc-list-client.ts'), url, String(expected)], {cwd: rootPath})
    let result: any
    let buffered = ''
    child.stdout.on('data', (data: Buffer) => {
      buffered += data
      let newline
      while ((newline = buffered.indexOf('\n')) >= 0) {
        const line = buffered.slice(0, newline)
        buffered = buffered.slice(newline + 1)
        if (line === 'LISTED') onListed()
        else if (line.startsWith('RESULT=')) result = JSON.parse(line.slice('RESULT='.length))
      }
    })
    child.stderr.on('data', (data: Buffer) => process.stderr.write(data))
    const timer = setTimeout(() => child.kill('SIGKILL'), remainingMs())
    child.on('close', (code) => {
      clearTimeout(timer)
      result ? resolve(result) : reject(Error(`rpc client exited ${code} without a result`))
    })
  })

let mesh: Awaited<ReturnType<typeof startScriptMesh>> | undefined
let rpcServer: any
let proxy: net.Server | undefined
try {
  fs.removeSync(cellDir)
  mesh = await startScriptMesh(path.join(cellDir, 'kubo'))
  const {default: PKCRpc} = (await import('@pkcprotocol/pkc-js/rpc')) as any
  rpcServer = await PKCRpc.PKCWsServer({port: rpcPort, pkcOptions: kuboPkcOptions(mesh.community, path.join(cellDir, 'pkc-rpc-server'))})
  rpcServer.on?.('error', (e: Error) => console.log('rpc server error:', e.message))

  // set up N started communities with a few posts each, through an RPC client of our own
  const setup: any = await PKC({pkcRpcClientsOptions: [`ws://127.0.0.1:${rpcPort}`]} as never)
  setup.on('error', (e: Error) => console.log('setup rpc client error:', e.message))
  const publisher: any = await PKC(kuboPkcOptions(mesh.publisher, path.join(cellDir, 'pkc-publisher')) as never)
  publisher.on('error', (e: Error) => console.log('publisher pkc error:', e.message))
  const communities: any[] = []
  for (let i = 0; i < options.communities; i++) {
    const community = await setup.createCommunity({title: `pkc-js benchmark rpc community ${i + 1}`})
    await community.edit({settings: {challenges: []}})
    await community.start()
    communities.push(community)
  }
  const publishPost = async (community: any, n: number) => {
    const post = await publisher.createComment({
      signer: await publisher.createSigner(),
      communityPublicKey: community.publicKey ?? community.address,
      title: `pkc-js benchmark rpc post ${n}`,
      content: 'x'.repeat(1000),
    })
    const accepted = new Promise<string>((resolve, reject) =>
      post.once('challengeverification', (v: any) => (v.challengeSuccess ? resolve(post.cid ?? v.comment?.cid) : reject(Error(`rejected: ${v.reason}`)))),
    )
    await post.publish()
    const cid = await withDeadline(accepted, 120_000, 'setup post')
    await post.stop().catch(() => {})
    return cid
  }
  for (const community of communities) {
    let last: string | undefined
    for (let n = 0; n < options.postsPerCommunity; n++) last = await publishPost(community, n)
    // wait until the community published a record carrying its posts, so the list has content
    await withDeadline(
      new Promise<void>((resolve) => {
        const check = () => {
          if (community.lastPostCid !== last) return
          community.removeListener('update', check)
          resolve()
        }
        community.on('update', check)
        check()
      }),
      Math.min(remainingMs(), 300_000),
      'a record with the setup posts',
    )
  }
  console.log(`${communities.length} communities with ${options.postsPerCommunity} posts each are up`)
  await publisher.destroy().catch(() => {})
  await setup.destroy().catch(() => {})

  // count what the server sends the measured client
  let received = 0
  proxy = net.createServer((client) => {
    const upstream = net.connect(rpcPort, '127.0.0.1')
    client.pipe(upstream)
    upstream.on('data', (chunk: Buffer) => (received += chunk.length))
    upstream.pipe(client)
    const close = () => {
      client.destroy()
      upstream.destroy()
    }
    client.on('error', close)
    upstream.on('error', close)
    client.on('close', close)
    upstream.on('close', close)
  })
  await new Promise<void>((resolve) => proxy!.listen(proxyPort, '127.0.0.1', resolve))

  const delay = monitorEventLoopDelay({resolution: 10})
  delay.enable()
  let receivedAtListed = 0
  const result = await runClient(`ws://127.0.0.1:${proxyPort}`, options.communities, () => (receivedAtListed = received))
  delay.disable()
  Object.assign(rpc, result)
  rpc.listReceivedBytes = receivedAtListed
  rpc.perCommunityReceivedBytes = received - receivedAtListed
  rpc.receivedPerCommunityBytes = Math.round(received / options.communities)
  rpc.serverEventLoopDelayMaxMs = delay.count ? Number((delay.max / 1e6).toFixed(2)) : null
  rpc.serverEventLoopDelayP99Ms = delay.count ? Number((delay.percentile(99) / 1e6).toFixed(2)) : null
} catch (e) {
  console.log('rpc-community-list cell failed:', (e as Error).message)
  rpc.error = {message: (e as Error).message}
} finally {
  proxy?.close()
  await rpcServer?.destroy?.().catch?.(() => {})
  await mesh?.stop()
}

const report: BenchmarkReport = {
  name: reportName,
  type: benchmarkOptionsType,
  timestamp: Date.now(),
  timeSeconds: (Date.now() - beforeReportTimestamp) / 1000,
  runtime: 'node',
  rpc,
  process: sampler.stop(),
}
await writeReport(report)
console.log(report)
process.exit(0)
