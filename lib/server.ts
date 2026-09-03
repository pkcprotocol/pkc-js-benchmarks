import fs from 'fs-extra'
import express from 'express'
import yargs from 'yargs/yargs'
import {fileURLToPath} from 'node:url'
import path from 'node:path'
import PKC from '@pkcprotocol/pkc-js'
import type {Server} from 'node:http'
import {buildPkcOptions} from './build-pkc-options.ts'
import {replyPropagationHost} from './reply-propagation-host.ts'
import type {
  BenchmarkOptionsFile,
  BenchmarkOptionsType,
  CommunityMetrics,
  ReplyPropagationBenchmarkOptions,
} from '../types.ts'

const argv = yargs(process.argv).argv as {apiPort?: number}

const rootPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const reportPath = path.join(rootPath, 'report.json')
const communitiesCachePath = path.join(rootPath, 'communities-cache.json')
const benchmarkOptionsPath = path.join(rootPath, 'benchmark-options.ts')

const communityFailedCacheSeconds = 60 * 30
let communitiesCache: Record<string, CommunityMetrics> = {}
try {
  communitiesCache = JSON.parse(fs.readFileSync(communitiesCachePath, 'utf-8'))
} catch (e) {
  // first run: no cache yet
}

const pkc = await PKC(
  buildPkcOptions({
    ipfsGatewayUrls: ['https://ipfsgateway.xyz', 'https://gateway.plebpubsub.xyz', 'https://gateway.forumindex.com'],
    chainProviders: {
      eth: {urls: ['https://ethrpc.xyz', 'viem'], chainId: 1},
    },
    resolveAuthorAddresses: false,
  }),
)
pkc.on('error', () => {})

const apiPort = argv.apiPort ?? 3000
const app = express()
app.use(express.json())

app.get('/benchmark-options', async (req, res) => {
  console.log('/benchmark-options', req.query)
  const benchmarkOptionsType = req.query.benchmarkOptionsType as BenchmarkOptionsType
  const benchmarkOptionsName = req.query.benchmarkOptionsName as string
  const {default: benchmarkOptions} = (await import(benchmarkOptionsPath)) as {default: BenchmarkOptionsFile}
  const list = benchmarkOptions[benchmarkOptionsType] ?? []
  const found = list.find((item: {name: string}) => item.name === benchmarkOptionsName)
  res.send(found ?? 'null')
})

app.post('/report', async (req, res) => {
  console.log('/report', req.body)
  const report = req.body

  let reports: unknown[] = []
  try {
    reports = JSON.parse(fs.readFileSync(reportPath, 'utf-8'))
  } catch (e) {
    // first report: file doesn't exist yet
  }
  reports.push(report)
  fs.writeFileSync(reportPath, JSON.stringify(reports))

  res.send()
})

// reply-propagation benchmark. The community and the publishing client live here, in the
// benchmark server, so that the reading client in benchmark/benchmark-reply-propagation.ts is a
// genuinely separate process (and can be a real browser). See lib/reply-propagation-host.ts.
// The benchmark identifies itself by options name; the server reads the entry so the community
// target and the publishing client's transport stay declared in one place (benchmark-options.ts).
const replyPropagationOptions = async (req: express.Request): Promise<ReplyPropagationBenchmarkOptions> => {
  const benchmarkOptionsName = (req.body as {benchmarkOptionsName?: string})?.benchmarkOptionsName
  if (!benchmarkOptionsName) throw Error('missing benchmarkOptionsName')
  const {default: benchmarkOptions} = (await import(benchmarkOptionsPath)) as {default: BenchmarkOptionsFile}
  const found = benchmarkOptions.replyPropagationBenchmarkOptions.find((item) => item.name === benchmarkOptionsName)
  if (!found) throw Error(`no replyPropagationBenchmarkOptions named '${benchmarkOptionsName}'`)
  return found
}

app.post('/reply-propagation/post', async (req, res) => {
  console.log('/reply-propagation/post', req.body)
  try {
    res.send(JSON.stringify(await replyPropagationHost.createPost(await replyPropagationOptions(req))))
  } catch (e) {
    console.log('/reply-propagation/post failed:', (e as Error).message)
    res.status(500).send(JSON.stringify({error: {message: (e as Error).message}}))
  }
})

app.post('/reply-propagation/reply', async (req, res) => {
  console.log('/reply-propagation/reply', req.body)
  try {
    const postCid = (req.body as {postCid?: string})?.postCid
    if (!postCid) throw Error('missing postCid')
    res.send(JSON.stringify(await replyPropagationHost.publishReply(await replyPropagationOptions(req), postCid)))
  } catch (e) {
    console.log('/reply-propagation/reply failed:', (e as Error).message)
    res.status(500).send(JSON.stringify({error: {message: (e as Error).message}}))
  }
})

app.post('/reply-propagation/stop', async (req, res) => {
  console.log('/reply-propagation/stop')
  await replyPropagationHost.stop()
  res.send(JSON.stringify({stopped: true}))
})

app.get('/community', async (req, res) => {
  console.log('/community', req.query)
  const communityName = req.query.communityName as string
  const communityPublicKey = req.query.communityPublicKey as string

  let sent = false
  const send = (string: string) => {
    if (sent) return
    sent = true
    res.send(string)
  }

  const cached = communitiesCache[communityName]
  if (cached?.failedAt && cached.failedAt > Date.now() / 1000 - communityFailedCacheSeconds) {
    send(JSON.stringify({error: {message: `fetching community failed recently, not fetching will probably fail again: ${cached.error?.message}`}}))
    return
  }

  if (!cached) {
    try {
      setTimeout(() => {
        const error = {message: 'pkc.getCommunity timed out'}
        send(JSON.stringify({error}))
        communitiesCache[communityName] = {failedAt: Math.round(Date.now() / 1000), error}
        fs.writeFileSync(communitiesCachePath, JSON.stringify(communitiesCache))
      }, 1000 * 120)

      console.log(`${communityName} not cached, fetching...`)
      const community = await (pkc as unknown as {
        getCommunity: (a: {name: string; publicKey: string}) => Promise<unknown>
      }).getCommunity({name: communityName, publicKey: communityPublicKey})
      communitiesCache[communityName] = JSON.parse(JSON.stringify(community))
      fs.writeFileSync(communitiesCachePath, JSON.stringify(communitiesCache))
    } catch (e) {
      const error = {message: (e as Error).message}
      send(JSON.stringify({error}))
      communitiesCache[communityName] = {failedAt: Math.round(Date.now() / 1000), error}
      fs.writeFileSync(communitiesCachePath, JSON.stringify(communitiesCache))
      return
    }
  }
  send(JSON.stringify(communitiesCache[communityName] ?? null))
})

const listen = (): Promise<Server> =>
  new Promise((resolve, reject) => {
    try {
      const server = app.listen(apiPort, () => {
        console.log(`api listening on port ${apiPort}`)
        resolve(server)
      })
    } catch (e) {
      reject(e as Error)
    }
  })

export default listen
