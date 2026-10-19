// Builds one seeded-board fixture: a local community's data directory holding a production-shaped
// board of posts and nested replies, written by an OLD pkc-js (the builder install), so that every
// version under test starts on the same board at the oldest database schema and migrates it forward.
//
// Run by lib/board-fixture.ts as its own process, because it imports the builder install's internals
// (not the pkc-js under test): node lib/build-board-fixture.ts <builderDir> <outDir> '<spec json>'
//
// Ported from pkc-js test/manual-e2e/large-board-seeder.ts (issue #386). Every comment is a real
// CommentIpfs: signed by its author's own ed25519 signer, its cid the sha256 of its deterministic
// JSON, so `community.start()` re-adds it to kubo byte for byte and a client can verify every
// signature in the published pages. The challenge/pubsub flow is bypassed because it is the only way
// to get 100k comments into a board in a minute rather than hours; the rows written are the rows
// storeCommentInDb writes for a comment that passed its challenge.
import fs from 'node:fs'
import path from 'node:path'
import {pathToFileURL} from 'node:url'
import {startKuboNode} from './kubo-nodes.ts'
import {localKuboNodes, kuboRpcUrl} from './local-kubo-config.ts'
import type {BoardFixtureSpec} from '../types.ts'

const [builderDir, outDir, specJson] = process.argv.slice(2)
if (!builderDir || !outDir || !specJson) throw Error('usage: build-board-fixture.ts <builderDir> <outDir> <spec json>')
const spec = JSON.parse(specJson) as BoardFixtureSpec

const pkcJsDir = path.join(builderDir, 'node_modules', '@pkcprotocol', 'pkc-js')
const internal = async (relative: string) => import(pathToFileURL(path.join(pkcJsDir, 'dist', 'node', relative)).href)
const {default: PKC} = await import(pathToFileURL(path.join(pkcJsDir, 'dist', 'node', 'index.js')).href)
const {stringify: deterministicStringify} = await import(
  pathToFileURL(path.join(builderDir, 'node_modules', 'safe-stable-stringify', 'index.js')).href
)
const {signComment} = await internal('signer/signatures.js')
const {createSigner} = await internal('signer/index.js')
const {getPKCAddressFromPublicKey} = await internal('signer/util.js')
const {calculateIpfsCidV0} = await internal('util.js')
const {deriveCommentIpfsFromCommentTableRow} = await internal('runtime/node/util.js')
const {communityIdentityPublicKey} = await internal('runtime/node/community/local-community/identity.js')
const {cleanWireAuthor} = await internal('publications/publication-author.js')
const {default: env} = await internal('version.js')
const builderVersion = JSON.parse(fs.readFileSync(path.join(pkcJsDir, 'package.json'), 'utf-8')).version as string

// the bench's entry size, so page byte sizes line up with pkc-js's own page-generation tables
const CONTENT = 'x'.repeat(200)

// xorshift32, so two builds produce the same board shape (signers are fresh keys every build)
const makeDeterministicRandom = (seed: number) => {
  let state = seed >>> 0 || 1
  const random = () => {
    state ^= state << 13
    state ^= state >>> 17
    state ^= state << 5
    return ((state >>> 0) % 1_000_000) / 1_000_000
  }
  const randomInt = (min: number, max: number) => min + Math.floor(random() * (max - min + 1))
  return {random, randomInt}
}

fs.rmSync(outDir, {recursive: true, force: true})
const dataPath = path.join(outDir, 'pkc-data')
fs.mkdirSync(dataPath, {recursive: true})

// createCommunity needs a kubo node (it imports the community's IPNS key); nothing is published
const kubo = await startKuboNode({config: localKuboNodes.scriptCommunity, dir: path.join(outDir, '.kubo-builder')})
try {
  const pkc = await PKC({
    dataPath,
    kuboRpcClientsOptions: [kuboRpcUrl(localKuboNodes.scriptCommunity)],
    pubsubKuboRpcClientsOptions: [kuboRpcUrl(localKuboNodes.scriptCommunity)],
    ipfsGatewayUrls: [],
    httpRoutersOptions: [],
    resolveAuthorNames: false,
    validatePages: false,
  })
  pkc.on('error', (e: Error) => console.log('fixture builder pkc error:', e.message))
  const community = await pkc.createCommunity({signer: await pkc.createSigner()})
  // the benchmark publishes to this board headlessly
  await community.edit({settings: {challenges: []}})
  // createCommunity does not open the database until start(); the seeder writes to it before that
  const db = community._dbHandler
  await db.initDbIfNeeded()
  await db.createOrMigrateTablesIfNeeded()

  const {random, randomInt} = makeDeterministicRandom(1)
  const authorCount = Math.max(1, Math.ceil(spec.posts / spec.postsPerAuthor))
  const authors: any[] = []
  for (let i = 0; i < authorCount; i++) authors.push(await createSigner())
  let authorCounter = 0
  const nextAuthor = () => authors[authorCounter++ % authors.length]

  const buildRow = async (signer: any, depth: number, fields: Record<string, unknown>) => {
    const toSign: any = {
      ...fields,
      // a wire author with no fields is dropped by cleanWireAuthor, leaving the stored comment
      // without the author its signature names
      author: {displayName: `seeded ${signer.address.slice(-6)}`},
      protocolVersion: env.PROTOCOL_VERSION,
      communityPublicKey: communityIdentityPublicKey(community),
      communityAddress: community.address,
      signer,
    }
    const signature = await signComment({comment: toSign, pkc})
    const {signer: _signer, communityAddress: _communityAddress, ...publication} = toSign
    const commentIpfs: any = {...publication, signature, depth}
    commentIpfs.author = cleanWireAuthor(commentIpfs.author)
    const cid = await calculateIpfsCidV0(deterministicStringify(commentIpfs))
    return {
      cid,
      row: {
        ...commentIpfs,
        cid,
        postCid: commentIpfs.postCid ?? cid,
        authorSignerAddress: getPKCAddressFromPublicKey(signature.publicKey),
        insertedAt: fields.timestamp,
      },
    }
  }

  let rows: any[] = []
  let reconstructionChecks = 0
  const flush = () => {
    if (!rows.length) return
    db.createTransaction()
    try {
      db.insertComments(rows)
      db.commitTransaction()
    } catch (e) {
      db.rollbackTransaction?.()
      throw e
    }
    rows = []
  }
  const push = async (row: any) => {
    // the first rows are checked the way start() checks every row: the CommentIpfs derived back from
    // the row must hash to the row's cid, or the repin walk throws on the board's first comment
    if (reconstructionChecks < 100) {
      reconstructionChecks++
      const derivedCid = await calculateIpfsCidV0(deterministicStringify(deriveCommentIpfsFromCommentTableRow(row)))
      if (derivedCid !== row.cid) throw Error(`seeded comment ${row.cid} does not reconstruct from its row (derived ${derivedCid})`)
    }
    rows.push(row)
    if (rows.length >= 5000) flush()
  }

  const start = performance.now()
  // posts one minute apart, ending an hour ago; replies five seconds apart after their post
  const base = Math.floor(Date.now() / 1000) - spec.posts * 60 - 3600
  let replyTotal = 0
  for (let i = 0; i < spec.posts; i++) {
    const postTimestamp = base + i * 60
    const post = await buildRow(nextAuthor(), 0, {title: `post ${i}`, content: CONTENT, timestamp: postTimestamp})
    await push(post.row)
    const replyCount = randomInt(spec.minReplies, spec.maxReplies)
    const replies: {cid: string; depth: number}[] = []
    for (let r = 0; r < replyCount; r++) {
      // about 20% of replies nest under an earlier reply
      const nested = replies.length > 0 && random() < 0.2 ? replies[randomInt(0, replies.length - 1)] : undefined
      const depth = nested ? nested.depth + 1 : 1
      const reply = await buildRow(nextAuthor(), depth, {
        content: CONTENT,
        parentCid: nested ? nested.cid : post.cid,
        postCid: post.cid,
        timestamp: postTimestamp + (r + 1) * 5,
      })
      await push(reply.row)
      replies.push({cid: reply.cid, depth})
    }
    replyTotal += replyCount
    if ((i + 1) % 100 === 0) console.log(`seeded ${i + 1}/${spec.posts} posts, ${i + 1 + replyTotal} comments`)
  }
  flush()
  // fold the WAL into the database file so the fixture is one self-contained file
  try {
    db._db?.pragma?.('wal_checkpoint(TRUNCATE)')
  } catch (e) {
    // copying the -wal file along works too
  }
  const fixture = {
    address: community.address,
    posts: spec.posts,
    comments: spec.posts + replyTotal,
    authors: authorCount,
    builtWith: builderVersion,
    seedMs: Math.round(performance.now() - start),
    spec,
  }
  await pkc.destroy()
  fs.writeFileSync(path.join(outDir, 'fixture.json'), JSON.stringify(fixture, null, 2))
  console.log(`board fixture built with pkc-js ${builderVersion}:`, fixture)
} finally {
  await kubo.stop()
  fs.rmSync(path.join(outDir, '.kubo-builder'), {recursive: true, force: true})
}
process.exit(0)
