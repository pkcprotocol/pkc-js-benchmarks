import fs from 'fs-extra'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import PKC from '@pkcprotocol/pkc-js'
import {startKuboNode, connectKuboNodes, type KuboNode} from './kubo-nodes.ts'
import {localKuboNodes, kuboRpcUrl, kuboHttpRouterUrl} from './local-kubo-config.ts'
import {buildPkcOptions} from './build-pkc-options.ts'
import {startProcessMetrics, type ProcessMetricsSampler} from './process-metrics.ts'
import {startInProcessProfile, stopInProcessProfile} from './cpu-profile.ts'
import type {
  CpuProfileSummary,
  LocalChallengeKind,
  ProcessMetrics,
  ReplyPropagationBenchmarkOptions,
} from '../types.ts'

// The node-side half of every benchmark that needs a community of its own (reply-propagation,
// comment-update-propagation, local-publish): local communities that accept publications
// headlessly, plus a *publishing* client. The *reading* (or, for local-publish, publishing) client
// lives in the benchmark itself so it can run in node or in a real browser, which also makes the two
// clients separate processes, not just separate PKC instances.
//
// Why local communities at all: every production 5chan board answers a challenge request with an
// interactive `url/iframe` Spam Blocker challenge, so no headless client can publish to one
// successfully. So the harness runs its own communities — one with `challenges: []`, one with a
// `question` challenge whose answer it knows — on its own kubo node, and gives each client its own
// kubo node. The three nodes have no public bootstrap peers and are wired only to each other: the
// numbers these benchmarks report are the pkc-js pipeline, not today's weather on the public DHT.

const rootPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const dataPath = path.join(rootPath, '.pkc-local-community')

// the answer to the question challenge of the harness's `question` community
export const localChallengeAnswer = 'pkc-js-benchmarks'

interface PkcLike {
  createSigner: () => Promise<any>
  createCommunity: (a: unknown) => Promise<any>
  createComment: (a: unknown) => Promise<any>
  createVote: (a: unknown) => Promise<any>
  createCommentEdit: (a: unknown) => Promise<any>
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

export interface PublishedUpdate {
  publishedAtMs: number
  publishTimeSeconds: number
}

// what a benchmark-side publisher needs to publish to one of the local communities
export interface LocalCommunityTarget {
  challenge: LocalChallengeKind
  communityAddress: string
  communityPublicKey: string
  communitySwarmMultiaddr: string
  // the community node's /routing/v1, for a libp2p-js publisher
  httpRouterUrl: string
  challengeAnswers: string[]
}

export const publishAndWaitForSuccess = async (
  publication: any,
  label: string,
  challengeAnswers?: string[],
  timeoutMs = 1000 * 120,
): Promise<{cid: string | undefined; timeSeconds: number}> => {
  const beforeTimestamp = Date.now()
  return new Promise<{cid: string | undefined; timeSeconds: number}>(async (resolve, reject) => {
    const timer = setTimeout(() => reject(Error(`${label} timed out after ${timeoutMs / 1000}s`)), timeoutMs)
    publication.on('error', (e: Error) => console.log(`${label} error:`, e.message))
    publication.on('challenge', () => {
      if (!challengeAnswers?.length) {
        clearTimeout(timer)
        reject(Error(`${label} got a challenge but has no answer (remote community: set REMOTE_COMMUNITY_CHALLENGE_ANSWER)`))
        return
      }
      // a rejected answer publish must fail this publication, not the whole benchmark server: an
      // unhandled rejection here once took down a server mid-run and lost a version's whole report
      Promise.resolve()
        .then(() => publication.publishChallengeAnswers({challengeAnswers}))
        .catch((e: Error) => {
          clearTimeout(timer)
          reject(Error(`${label} failed publishing its challenge answers: ${e.message}`))
        })
    })
    publication.once('challengeverification', (verification: any) => {
      clearTimeout(timer)
      if (!verification.challengeSuccess) {
        reject(Error(`${label} was rejected by the community: ${verification.reason ?? JSON.stringify(verification.challengeErrors)}`))
        return
      }
      resolve({cid: publication.cid ?? verification.comment?.cid, timeSeconds: (Date.now() - beforeTimestamp) / 1000})
    })
    try {
      await publication.publish()
    } catch (e) {
      clearTimeout(timer)
      reject(e as Error)
    }
  })
}

const requireCid = ({cid, timeSeconds}: {cid: string | undefined; timeSeconds: number}, label: string) => {
  if (!cid) throw Error(`${label} succeeded but has no cid`)
  return {cid, timeSeconds}
}

class LocalCommunityHost {
  private nodes: KuboNode[] = []
  private communityPkc?: PkcLike
  private publisherPkc?: PkcLike
  private communities = new Map<LocalChallengeKind, Promise<any>>()
  private communityNode?: KuboNode
  private startPromise?: Promise<void>
  // post cid -> the signer that wrote it, so an author edit can be signed by the post's author
  private postSigners = new Map<string, any>()
  private metricsWindows = new Map<string, ProcessMetricsSampler>()
  // remote-community mode: one publishing client per distinct publisher transport, and one
  // public-network kubo node shared by whichever reader cells ask for it
  private remotePublishers = new Map<string, Promise<PkcLike>>()
  private publicReaderNodePromise?: Promise<KuboNode>

  async start(): Promise<void> {
    if (!this.startPromise) this.startPromise = this._start()
    return this.startPromise
  }

  // A kubo node on the real network for the reading client, configured the way pkc-js configures
  // a production node (Routing.Routers written up front so pkc-js does not rewrite them and
  // shut the node down). IPNS then resolves over ipns-over-pubsub, exactly as in production.
  private async ensurePublicReaderNode(httpRouters: string[]): Promise<KuboNode> {
    if (!this.publicReaderNodePromise) {
      this.publicReaderNodePromise = (async () => {
        const node = await startKuboNode({
          config: localKuboNodes.publicReader,
          dir: path.join(dataPath, 'kubo-public-reader'),
          publicNetwork: true,
          httpRouters,
        })
        this.nodes.push(node)
        this._killNodesOnProcessExit()
        return node
      })()
    }
    return this.publicReaderNodePromise
  }

  private async ensureRemotePublisher(options: ReplyPropagationBenchmarkOptions): Promise<PkcLike> {
    const key = JSON.stringify(options.publisherPkcOptions ?? {})
    let publisher = this.remotePublishers.get(key)
    if (!publisher) {
      publisher = (async () => {
        const pkc = (await PKC(buildPkcOptions(options.publisherPkcOptions ?? {}))) as unknown as PkcLike
        pkc.on('error', (e: Error) => console.log('reply-propagation remote publisher pkc error:', e.message))
        return pkc
      })()
      this.remotePublishers.set(key, publisher)
    }
    return publisher
  }

  private remoteCommunityIdentifiers(options: ReplyPropagationBenchmarkOptions) {
    const community = options.community!
    return community.name
      ? {communityName: community.name, communityPublicKey: community.publicKey}
      : {communityPublicKey: community.publicKey}
  }

  private async _start(): Promise<void> {
    fs.removeSync(dataPath)
    this._killNodesOnProcessExit()

    // The community node also serves /routing/v1 (Gateway.ExposeRoutingAPI) so a libp2p-js
    // client has an http router to ask for providers and IPNS records, the same way a browser
    // client asks routing.lol in production.
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
    this.communityPkc.on('error', (e: Error) => console.log('local community pkc error:', e.message))

    this.publisherPkc = (await PKC({
      dataPath: path.join(dataPath, 'pkc-publisher'),
      kuboRpcClientsOptions: [kuboRpcUrl(localKuboNodes.publisher)],
      pubsubKuboRpcClientsOptions: [kuboRpcUrl(localKuboNodes.publisher)],
      ipfsGatewayUrls: [],
      httpRoutersOptions: [],
      resolveAuthorNames: false,
      validatePages: false,
    } as never)) as unknown as PkcLike
    this.publisherPkc.on('error', (e: Error) => console.log('local publisher pkc error:', e.message))
  }

  // One community per challenge kind, created on first use and kept for the rest of the run.
  async community(challenge: LocalChallengeKind = 'none'): Promise<any> {
    await this.start()
    let community = this.communities.get(challenge)
    if (!community) {
      community = (async () => {
        const pkc = this.communityPkc!
        const created = await pkc.createCommunity({signer: await pkc.createSigner()})
        const challenges =
          challenge === 'question'
            ? [{name: 'question', options: {question: 'What is the password?', answer: localChallengeAnswer}}]
            : [] // headless clients can't answer the default challenge
        await created.edit({settings: {challenges}})
        await created.start()
        await new Promise((resolve) => created.once('update', resolve))
        console.log(`local community (challenge: ${challenge}) ready: ${created.address}`)
        return created
      })()
      this.communities.set(challenge, community)
    }
    return community
  }

  async target(challenge: LocalChallengeKind): Promise<LocalCommunityTarget> {
    const community = await this.community(challenge)
    return {
      challenge,
      communityAddress: community.address,
      communityPublicKey: community.publicKey ?? community.address,
      communitySwarmMultiaddr: this.communityNode!.swarmMultiaddr,
      httpRouterUrl: kuboHttpRouterUrl(localKuboNodes.community),
      challengeAnswers: challenge === 'question' ? [localChallengeAnswer] : [],
    }
  }

  // A fresh post per sample: the reading client must be watching a post whose reply has not been
  // published yet, so samples can't share one.
  async createPost(options: ReplyPropagationBenchmarkOptions): Promise<ReplyPropagationPost> {
    if (options.community) {
      if (options.readerKuboNode) await this.ensurePublicReaderNode(options.pkcOptions.httpRoutersOptions ?? [])
      const publisherPkc = await this.ensureRemotePublisher(options)
      const post = await publisherPkc.createComment({
        ...this.remoteCommunityIdentifiers(options),
        signer: await publisherPkc.createSigner(),
        title: `pkc-js benchmark reply-propagation post ${Date.now()}`,
        content: `pkc-js benchmark reply-propagation post ${Date.now()}`,
      })
      const {cid} = requireCid(await publishAndWaitForSuccess(post, 'post', remoteChallengeAnswers(options)), 'post')
      await post.stop().catch(() => {})
      return {
        postCid: cid,
        communityAddress: options.community.name ?? options.community.publicKey,
        communityPublicKey: options.community.publicKey,
        communitySwarmMultiaddr: '', // the community is someone else's node
      }
    }

    const community = await this.community('none')
    const publisherPkc = this.publisherPkc!
    const signer = await publisherPkc.createSigner()
    const post = await publisherPkc.createComment({
      signer,
      communityPublicKey: community.publicKey,
      title: `pkc-js benchmark post ${Date.now()}`,
      content: `pkc-js benchmark post ${Date.now()}`,
    })
    const {cid} = requireCid(await publishAndWaitForSuccess(post, 'post'), 'post')
    await post.stop().catch(() => {})
    this.postSigners.set(cid, signer)
    return {
      postCid: cid,
      communityAddress: community.address,
      communityPublicKey: community.publicKey,
      communitySwarmMultiaddr: this.communityNode!.swarmMultiaddr,
    }
  }

  async publishReply(options: ReplyPropagationBenchmarkOptions, postCid: string): Promise<ReplyPropagationReply> {
    if (options.community) {
      const publisherPkc = await this.ensureRemotePublisher(options)
      const reply = await publisherPkc.createComment({
        ...this.remoteCommunityIdentifiers(options),
        signer: await publisherPkc.createSigner(),
        parentCid: postCid,
        postCid,
        content: `pkc-js benchmark reply-propagation reply ${Date.now()}`,
      })
      const {cid, timeSeconds} = requireCid(await publishAndWaitForSuccess(reply, 'reply', remoteChallengeAnswers(options)), 'reply')
      const publishedAtMs = Date.now()
      await reply.stop().catch(() => {})
      return {replyCid: cid, publishedAtMs, replyPublishTimeSeconds: timeSeconds}
    }

    const community = await this.community('none')
    const publisherPkc = this.publisherPkc!
    const reply = await publisherPkc.createComment({
      signer: await publisherPkc.createSigner(),
      communityPublicKey: community.publicKey,
      parentCid: postCid,
      postCid,
      content: `pkc-js benchmark reply-propagation reply ${Date.now()}`,
    })
    const {cid, timeSeconds} = requireCid(await publishAndWaitForSuccess(reply, 'reply'), 'reply')
    const publishedAtMs = Date.now()
    await reply.stop().catch(() => {})
    return {replyCid: cid, publishedAtMs, replyPublishTimeSeconds: timeSeconds}
  }

  // an upvote from a fresh author on a post of the no-challenge community
  async publishVote(postCid: string): Promise<PublishedUpdate> {
    const community = await this.community('none')
    const publisherPkc = this.publisherPkc!
    const vote = await publisherPkc.createVote({
      signer: await publisherPkc.createSigner(),
      communityPublicKey: community.publicKey,
      commentCid: postCid,
      vote: 1,
    })
    const {timeSeconds} = await publishAndWaitForSuccess(vote, 'vote')
    const publishedAtMs = Date.now()
    await vote.stop().catch(() => {})
    return {publishedAtMs, publishTimeSeconds: timeSeconds}
  }

  // the post's own author edits its content (only posts made by createPost() can be edited)
  async publishEdit(postCid: string, content: string): Promise<PublishedUpdate> {
    const signer = this.postSigners.get(postCid)
    if (!signer) throw Error(`no signer for post ${postCid}, it was not created by this host`)
    const community = await this.community('none')
    const publisherPkc = this.publisherPkc!
    const edit = await publisherPkc.createCommentEdit({
      signer,
      communityPublicKey: community.publicKey,
      commentCid: postCid,
      content,
    })
    const {timeSeconds} = await publishAndWaitForSuccess(edit, 'edit')
    const publishedAtMs = Date.now()
    await edit.stop().catch(() => {})
    return {publishedAtMs, publishTimeSeconds: timeSeconds}
  }

  // Process metrics of this (the benchmark server's) process and the community's kubo daemon over
  // a window the benchmark opens and closes around its measurement. Nothing else runs in the
  // server while a cell runs, so this is the local community's cost.
  startMetrics(id: string): void {
    this.metricsWindows.get(id)?.stop()
    this.metricsWindows.set(id, startProcessMetrics({kuboPids: {community: this.communityNode?.pid}}))
  }

  stopMetrics(id: string): ProcessMetrics | null {
    const sampler = this.metricsWindows.get(id)
    if (!sampler) return null
    this.metricsWindows.delete(id)
    return sampler.stop()
  }

  startProfile(): Promise<void> {
    return startInProcessProfile()
  }

  stopProfile(label: string): Promise<CpuProfileSummary> {
    return stopInProcessProfile(label)
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
    for (const publisher of this.remotePublishers.values()) {
      try {
        await (await publisher).destroy()
      } catch (e) {
        // already destroyed
      }
    }
    this.remotePublishers.clear()
    this.publicReaderNodePromise = undefined
    for (const sampler of this.metricsWindows.values()) sampler.stop()
    this.metricsWindows.clear()
    if (!this.startPromise) {
      await Promise.all(this.nodes.map((node) => node.stop()))
      this.nodes = []
      return
    }
    this.startPromise = undefined
    for (const community of this.communities.values()) {
      try {
        await (await community).stop()
      } catch (e) {
        // already stopped, or never started
      }
    }
    this.communities.clear()
    for (const pkc of [this.publisherPkc, this.communityPkc]) {
      try {
        await pkc?.destroy()
      } catch (e) {
        // already destroyed
      }
    }
    await Promise.all(this.nodes.map((node) => node.stop()))
    this.nodes = []
    this.postSigners.clear()
    this.communityPkc = undefined
    this.publisherPkc = undefined
    console.log('local community host stopped')
  }
}

// The remote community's `question` answer is only visible to its owner (community.settings), and
// the owner rotates it — a stale hardcoded answer made every remote cell fail "Wrong answer." for
// fifteen releases. CI passes the current one in REMOTE_COMMUNITY_CHALLENGE_ANSWER (a repository
// secret); the options' own answer is only the fallback.
const remoteChallengeAnswers = (options: ReplyPropagationBenchmarkOptions): string[] | undefined =>
  process.env.REMOTE_COMMUNITY_CHALLENGE_ANSWER
    ? [process.env.REMOTE_COMMUNITY_CHALLENGE_ANSWER]
    : options.community?.challengeAnswers

export const localCommunityHost = new LocalCommunityHost()
