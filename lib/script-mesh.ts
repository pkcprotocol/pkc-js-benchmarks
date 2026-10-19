import fs from 'fs-extra'
import path from 'node:path'
import {startKuboNode, connectKuboNodes, type KuboNode} from './kubo-nodes.ts'
import {localKuboNodes} from './local-kubo-config.ts'

// The two-node kubo mesh of a script benchmark (seeded-board, rpc-community-list, soak): a node for
// the community and one for the publishing client, wired only to each other, on ports of their own
// (localKuboNodes.script*) so they never meet the benchmark server's mesh.

export interface ScriptMesh {
  community: KuboNode
  publisher: KuboNode
  stop: () => Promise<void>
}

export const startScriptMesh = async (dataDir: string): Promise<ScriptMesh> => {
  fs.ensureDirSync(dataDir)
  const community = await startKuboNode({
    config: localKuboNodes.scriptCommunity,
    dir: path.join(dataDir, 'kubo-community'),
    exposeRoutingApi: true,
  })
  const publisher = await startKuboNode({config: localKuboNodes.scriptPublisher, dir: path.join(dataDir, 'kubo-publisher')})
  const killAll = () => [community, publisher].forEach((node) => node.kill())
  process.once('exit', killAll)
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => {
      killAll()
      process.exit(1)
    })
  }
  await connectKuboNodes(publisher, community)
  return {
    community,
    publisher,
    stop: async () => {
      await Promise.all([community.stop(), publisher.stop()])
    },
  }
}

// the PKC options of a kubo-backed client on one mesh node. httpRoutersOptions: [] on purpose:
// pkc-js otherwise rewrites the node's Routing config and POSTs /shutdown to it.
export const kuboPkcOptions = (node: KuboNode, dataPath?: string) => ({
  ...(dataPath ? {dataPath} : {}),
  kuboRpcClientsOptions: [node.rpcUrl],
  pubsubKuboRpcClientsOptions: [node.rpcUrl],
  ipfsGatewayUrls: [],
  httpRoutersOptions: [],
  resolveAuthorNames: false,
  validatePages: false,
})

export const withDeadline = <T>(promise: Promise<T>, ms: number, label: string): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(Error(`${label} timed out after ${Math.round(ms / 1000)}s`)), ms)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (e) => {
        clearTimeout(timer)
        reject(e)
      },
    )
  })

// how long a script benchmark may still run: start.ts passes the cell's wall-time cap, and a script
// that is about to hit it reports what it has instead of being killed with nothing
export const cellDeadlineMs = (): number => {
  const ms = Number(process.env.BENCHMARK_CELL_DEADLINE_MS)
  return Number.isFinite(ms) && ms > 0 ? ms : 60 * 60 * 1000
}
