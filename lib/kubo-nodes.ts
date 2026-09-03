import {execFileSync, spawn, type ChildProcess} from 'node:child_process'
import fs from 'fs-extra'
import path from 'node:path'
import {path as getKuboPath} from 'kubo'
import type {KuboNodeConfig} from './local-kubo-config.ts'
import {kuboGatewayUrl, kuboRpcUrl} from './local-kubo-config.ts'

// Boots throwaway kubo daemons for the reply-propagation benchmark. Modeled on pkc-js's own
// test server (test/server/test-server.js): every node is cut off from the public network
// (`bootstrap rm --all`, no mDNS) and the nodes are wired to each other explicitly, so the
// benchmark measures the pkc-js pipeline rather than whatever the public DHT is doing today.

const kuboBinary = getKuboPath()

export interface KuboNode {
  config: KuboNodeConfig
  peerId: string
  rpcUrl: string
  gatewayUrl: string
  // dialable by the other nodes AND by a libp2p-js/helia client (kubo listens on /ws)
  swarmMultiaddr: string
  stop: () => Promise<void>
  // synchronous, for process-exit handlers where there is no time to await anything
  kill: () => void
}

// Every kubo RPC endpoint is POST-only.
const kuboRpc = async (rpcUrl: string, endpoint: string, timeoutMs = 30_000): Promise<any> => {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(`${rpcUrl}/${endpoint}`, {method: 'POST', signal: controller.signal})
    const text = await res.text()
    if (!res.ok) throw Error(`kubo rpc ${endpoint} failed: HTTP ${res.status} ${text}`)
    return text ? JSON.parse(text) : undefined
  } finally {
    clearTimeout(timer)
  }
}

const waitForApi = async (rpcUrl: string, timeoutMs = 120_000): Promise<any> => {
  const deadline = Date.now() + timeoutMs
  let lastError: Error | undefined
  while (Date.now() < deadline) {
    try {
      return await kuboRpc(rpcUrl, 'id', 5_000)
    } catch (e) {
      lastError = e as Error
      await new Promise((r) => setTimeout(r, 500))
    }
  }
  throw Error(`kubo api ${rpcUrl} never came up: ${lastError?.message}`)
}

// A crashed benchmark run leaves its daemons orphaned, still holding these ports. Without this,
// the next run inits a fresh repo, spawns a daemon that fails to bind, and then happily talks to
// the *stale* daemon whose repo we just deleted — which hangs in confusing ways much later.
const shutdownStaleNode = async (config: KuboNodeConfig): Promise<void> => {
  const rpcUrl = kuboRpcUrl(config)
  try {
    await kuboRpc(rpcUrl, 'id', 2_000)
  } catch (e) {
    return // nothing listening, which is the normal case
  }
  console.log(`kubo api port ${config.apiPort} is already in use by a leftover daemon, shutting it down`)
  try {
    await kuboRpc(rpcUrl, 'shutdown', 10_000)
  } catch (e) {
    // kubo closes the connection as it exits, so a failed response here is expected
  }
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 500))
    try {
      await kuboRpc(rpcUrl, 'id', 2_000)
    } catch (e) {
      return
    }
  }
  throw Error(`kubo api port ${config.apiPort} is still in use; kill the process holding it and retry`)
}

export interface StartKuboNodeOptions {
  config: KuboNodeConfig
  dir: string
  // serve /routing/v1 on the gateway port so a helia client can use this node as its http router
  exposeRoutingApi?: boolean
}

export const startKuboNode = async ({config, dir, exposeRoutingApi}: StartKuboNodeOptions): Promise<KuboNode> => {
  await shutdownStaleNode(config)
  fs.removeSync(dir)
  fs.ensureDirSync(dir)
  const env = {...process.env, IPFS_PATH: dir}

  execFileSync(kuboBinary, ['init'], {stdio: 'ignore', env})
  // no public bootstrap peers and no mDNS: the mesh is exactly the nodes we connect below
  execFileSync(kuboBinary, ['bootstrap', 'rm', '--all'], {stdio: 'ignore', env})
  execFileSync(kuboBinary, ['config', '--json', 'Discovery.MDNS.Enabled', 'false'], {stdio: 'ignore', env})

  const configPath = path.join(dir, 'config')
  const kuboConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'))
  kuboConfig.Addresses.API = `/ip4/127.0.0.1/tcp/${config.apiPort}`
  kuboConfig.Addresses.Gateway = `/ip4/127.0.0.1/tcp/${config.gatewayPort}`
  // /ws so browser + libp2p-js clients can dial these nodes, same as pkc-js's test server
  kuboConfig.Addresses.Swarm = [`/ip4/127.0.0.1/tcp/${config.swarmPort}/ws`]
  kuboConfig.API.HTTPHeaders['Access-Control-Allow-Origin'] = ['*']
  kuboConfig.API.HTTPHeaders['Access-Control-Allow-Methods'] = ['POST', 'GET']
  kuboConfig.Gateway.HTTPHeaders['Access-Control-Allow-Origin'] = ['*']
  kuboConfig.Gateway.HTTPHeaders['Access-Control-Allow-Headers'] = ['*']
  kuboConfig.Gateway.HTTPHeaders['Access-Control-Expose-Headers'] = ['*']
  kuboConfig.Gateway.HTTPHeaders['Access-Control-Allow-Methods'] = ['*']
  if (exposeRoutingApi) kuboConfig.Gateway.ExposeRoutingAPI = true
  // A gateway that caches IPNS records for the record's full TTL would report a propagation time
  // that is really "how long the gateway held a stale record". 10s matches pkc-js's test server.
  kuboConfig.Ipns.MaxCacheTTL = '10s'
  // pubsub + ipns-over-pubsub: how a community pushes a new record to clients without the DHT
  // (the --enable-pubsub-experiment / --enable-namesys-pubsub daemon flags are deprecated in kubo 0.43)
  kuboConfig.Pubsub = {...kuboConfig.Pubsub, Enabled: true}
  kuboConfig.Ipns.UsePubsub = true
  fs.writeFileSync(configPath, JSON.stringify(kuboConfig), 'utf-8')

  const stdoutLog = fs.createWriteStream(path.join(dir, 'kubo-stdout.log'), {flags: 'a'})
  const stderrLog = fs.createWriteStream(path.join(dir, 'kubo-stderr.log'), {flags: 'a'})
  const daemon: ChildProcess = spawn(
    kuboBinary,
    ['daemon', '--migrate'],
    {env},
  )
  daemon.stdout?.pipe(stdoutLog)
  daemon.stderr?.pipe(stderrLog)

  const rpcUrl = kuboRpcUrl(config)
  const id = await waitForApi(rpcUrl)
  const peerId: string = id.ID
  console.log(`kubo node '${config.name}' up: peerId=${peerId} api=${config.apiPort} gateway=${config.gatewayPort} swarm=${config.swarmPort}`)

  const stop = async () => {
    if (daemon.exitCode !== null || daemon.signalCode !== null) return
    await new Promise<void>((resolve) => {
      daemon.once('exit', () => resolve())
      daemon.kill('SIGTERM')
      setTimeout(() => {
        daemon.kill('SIGKILL')
        resolve()
      }, 10_000)
    })
  }

  return {
    config,
    peerId,
    rpcUrl,
    gatewayUrl: kuboGatewayUrl(config),
    swarmMultiaddr: `/ip4/127.0.0.1/tcp/${config.swarmPort}/ws/p2p/${peerId}`,
    stop,
    kill: () => daemon.kill('SIGKILL'),
  }
}

// Dial `to` from `from` and keep the connection: the mesh has no discovery of its own.
export const connectKuboNodes = async (from: KuboNode, to: KuboNode): Promise<void> => {
  await kuboRpc(from.rpcUrl, `swarm/connect?arg=${encodeURIComponent(to.swarmMultiaddr)}`)
  console.log(`kubo '${from.config.name}' connected to '${to.config.name}'`)
}

export const kuboPeerCount = async (node: KuboNode): Promise<number> => {
  const peers = await kuboRpc(node.rpcUrl, 'swarm/peers')
  return peers?.Peers?.length ?? 0
}
