import fs from 'fs-extra'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import PKC from '@pkcprotocol/pkc-js'
import {startKuboNode, connectKuboNodes, type KuboNode} from './kubo-nodes.ts'
import {localKuboNodes, kuboRpcUrl} from './local-kubo-config.ts'

// The node-side half of the reply-propagation benchmark: a community that accepts publications
// headlessly, plus the *publishing* client. The *reading* client lives in the benchmark itself
// (benchmark/benchmark-reply-propagation.ts) so it can run in node or in a real browser, which
// also makes the two clients separate processes, not just separate PKC instances.
//
// Why a local community at all: every production 5chan board answers a challenge request with an
// interactive `url/iframe` Spam Blocker challenge, so no headless client can publish to one
// successfully — and "the reply publish succeeded" is half of what this benchmark measures.
// So the harness runs its own community with `challenges: []`, on its own kubo node, and gives
// each client its own kubo node. The three nodes have no public bootstrap peers and are wired
// only to each other: the number this benchmark reports is the pkc-js pipeline (community
// accepts -> community publishes a new record -> client notices and fetches it), not today's
// weather on the public DHT.

const rootPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const dataPath = path.join(rootPath, '.pkc-reply-propagation')

interface PkcLike {
  createSigner: () => Promise<unknown>
  createCommunity: (a: unknown) => Promise<any>
  createComment: (a: unknown) => Promise<any>
  destroy: () => Promise<void>
  on: (event: string, handler: (arg: any) => void) => void
}

export interface ReplyPropagationPost {
  postCid: string
  communityAddress: string
  communityPublicKey: string
  // the community node's ws multiaddr, dialable by a libp2p-js/helia reading client
  communitySwarmMultiaddr: string
}

export interface ReplyPropagationReply {
  replyCid: string
  // Date.now() on this process at the moment challengeverification reported success. The reading
  // client runs on the same machine (node, or chromium driven by vitest) so this is directly
  // comparable to its own Date.now().
  publishedAtMs: number
  replyPublishTimeSeconds: number
}

const publishAndWaitForSuccess = async (publication: any, label: string): Promise<{cid: string; timeSeconds: number}> => {
  const beforeTimestamp = Date.now()
  return new Promise<{cid: string; timeSeconds: number}>(async (resolve, reject) => {
    const timer = setTimeout(() => reject(Error(`${label} timed out after 120s`)), 1000 * 120)
    publication.on('error', (e: Error) => console.log(`reply-propagation ${label} error:`, e.message))
    publication.once('challengeverification', (verification: any) => {
      clearTimeout(timer)
      if (!verification.challengeSuccess) {
        reject(Error(`${label} was rejected by the community: ${verification.reason ?? JSON.stringify(verification.challengeErrors)}`))
        return
      }
      const cid = publication.cid ?? verification.comment?.cid
      if (!cid) {
        reject(Error(`${label} succeeded but has no cid`))
        return
      }
      resolve({cid, timeSeconds: (Date.now() - beforeTimestamp) / 1000})
    })
    try {
      await publication.publish()
    } catch (e) {
      clearTimeout(timer)
      reject(e as Error)
    }
  })
}

class ReplyPropagationHost {
  private nodes: KuboNode[] = []
  private communityPkc?: PkcLike
  private publisherPkc?: PkcLike
  private community?: any
  private communityNode?: KuboNode
  private startPromise?: Promise<void>

  async start(): Promise<void> {
    if (!this.startPromise) this.startPromise = this._start()
    return this.startPromise
  }

  private async _start(): Promise<void> {
    fs.removeSync(dataPath)
    this._killNodesOnProcessExit()

    // The community node also serves /routing/v1 (Gateway.ExposeRoutingAPI) so a libp2p-js
    // reading client has an http router to ask for providers and IPNS records, the same way a
    // browser client asks routing.lol in production.
    const communityNode = await startKuboNode({
      config: localKuboNodes.community,
      dir: path.join(dataPath, 'kubo-community'),
      exposeRoutingApi: true,
    })
    const publisherNode = await startKuboNode({config: localKuboNodes.publisher, dir: path.join(dataPath, 'kubo-publisher')})
    const readerNode = await startKuboNode({config: localKuboNodes.reader, dir: path.join(dataPath, 'kubo-reader')})
    this.nodes = [communityNode, publisherNode, readerNode]
    this.communityNode = communityNode
    await connectKuboNodes(publisherNode, communityNode)
    await connectKuboNodes(readerNode, communityNode)
    await connectKuboNodes(readerNode, publisherNode)

    // httpRoutersOptions: [] on every kubo-backed PKC on purpose. pkc-js defaults it to the
    // production routers and then rewrites Routing.Routers on the kubo node and POSTs /shutdown
    // to force a restart — which would kill the node this benchmark just booted.
    this.communityPkc = (await PKC({
      dataPath: path.join(dataPath, 'pkc-community'),
      kuboRpcClientsOptions: [kuboRpcUrl(localKuboNodes.community)],
      pubsubKuboRpcClientsOptions: [kuboRpcUrl(localKuboNodes.community)],
      ipfsGatewayUrls: [],
      httpRoutersOptions: [],
      resolveAuthorNames: false,
      validatePages: false,
    } as never)) as unknown as PkcLike
    this.communityPkc.on('error', (e: Error) => console.log('reply-propagation community pkc error:', e.message))

    const signer = await this.communityPkc.createSigner()
    const community = await this.communityPkc.createCommunity({signer})
    await community.edit({settings: {challenges: []}}) // headless clients can't answer a challenge
    await community.start()
    await new Promise((resolve) => community.once('update', resolve))
    this.community = community
    console.log(`reply-propagation community ready: ${community.address}`)

    this.publisherPkc = (await PKC({
      dataPath: path.join(dataPath, 'pkc-publisher'),
      kuboRpcClientsOptions: [kuboRpcUrl(localKuboNodes.publisher)],
      pubsubKuboRpcClientsOptions: [kuboRpcUrl(localKuboNodes.publisher)],
      ipfsGatewayUrls: [],
      httpRoutersOptions: [],
      resolveAuthorNames: false,
      validatePages: false,
    } as never)) as unknown as PkcLike
    this.publisherPkc.on('error', (e: Error) => console.log('reply-propagation publisher pkc error:', e.message))
  }

  // A fresh post per sample: the reading client must be watching a post whose reply has not been
  // published yet, so samples can't share one.
  async createPost(): Promise<ReplyPropagationPost> {
    await this.start()
    const publisherPkc = this.publisherPkc!
    const community = this.community!
    const post = await publisherPkc.createComment({
      signer: await publisherPkc.createSigner(),
      communityPublicKey: community.publicKey,
      title: `pkc-js benchmark reply-propagation post ${Date.now()}`,
      content: `pkc-js benchmark reply-propagation post ${Date.now()}`,
    })
    const {cid} = await publishAndWaitForSuccess(post, 'post')
    await post.stop().catch(() => {})
    return {
      postCid: cid,
      communityAddress: community.address,
      communityPublicKey: community.publicKey,
      communitySwarmMultiaddr: this.communityNode!.swarmMultiaddr,
    }
  }

  async publishReply(postCid: string): Promise<ReplyPropagationReply> {
    await this.start()
    const publisherPkc = this.publisherPkc!
    const community = this.community!
    const reply = await publisherPkc.createComment({
      signer: await publisherPkc.createSigner(),
      communityPublicKey: community.publicKey,
      parentCid: postCid,
      postCid,
      content: `pkc-js benchmark reply-propagation reply ${Date.now()}`,
    })
    const {cid, timeSeconds} = await publishAndWaitForSuccess(reply, 'reply')
    const publishedAtMs = Date.now()
    await reply.stop().catch(() => {})
    return {replyCid: cid, publishedAtMs, replyPublishTimeSeconds: timeSeconds}
  }

  // The daemons are children of this process but do not die with it, so a crash or a Ctrl-C
  // between benchmarks would otherwise leave them holding their ports (see shutdownStaleNode).
  private _killNodesOnProcessExit(): void {
    const killAll = () => this.nodes.forEach((node) => node.kill())
    process.once('exit', killAll)
    for (const signal of ['SIGINT', 'SIGTERM'] as const) {
      process.once(signal, () => {
        killAll()
        process.exit(1)
      })
    }
  }

  async stop(): Promise<void> {
    if (!this.startPromise) return
    this.startPromise = undefined
    try {
      await this.community?.stop()
    } catch (e) {
      // already stopped
    }
    for (const pkc of [this.publisherPkc, this.communityPkc]) {
      try {
        await pkc?.destroy()
      } catch (e) {
        // already destroyed
      }
    }
    await Promise.all(this.nodes.map((node) => node.stop()))
    this.nodes = []
    this.community = undefined
    this.communityPkc = undefined
    this.publisherPkc = undefined
    console.log('reply-propagation host stopped')
  }
}

export const replyPropagationHost = new ReplyPropagationHost()
