import {test} from 'vitest'
import PKC from '@pkcprotocol/pkc-js'
import {buildPkcOptions} from '../lib/build-pkc-options.ts'
import {startRuntimeMetrics} from '../lib/runtime-metrics.ts'
import {exitProcess, getBenchmarkContext, isProfiledRun, median, percentile, postToServer, writeReport} from '../lib/benchmark-client.ts'
import type {
  BenchmarkReport,
  CpuProfileSummary,
  LocalPublishBenchmarkOptions,
  LocalPublishMetrics,
  ProcessMetrics,
} from '../types.ts'

// The PUBLISHING client, against one of the harness's own communities (lib/local-community-host.ts,
// in the benchmark server). Each round fires `burst` publications at once and times each one from
// publish() to its challengeverification; the server measures what the community spent taking them
// in. This is the community-side path every production publication goes through — challenge
// exchange, signature verification, storage — which no production board lets a headless client
// reach (they all end at an interactive Spam Blocker challenge).

const benchmarkOptionsType = 'localPublishBenchmarkOptions'
// a publication that has not been verified after a minute is not coming; under a burst some never are
const publicationTimeoutMs = 1000 * 60

interface Target {
  communityPublicKey: string
  challengeAnswers: string[]
}

test('benchmark', async () => {
  const {options, runtime, reportName} = await getBenchmarkContext<LocalPublishBenchmarkOptions>(benchmarkOptionsType)
  const runtimeMetrics = await startRuntimeMetrics()
  const beforeReportTimestamp = Date.now()
  const target = await postToServer<Target>('/local-community/target', {challenge: options.challenge})

  const pkc: any = await PKC(buildPkcOptions(options.pkcOptions))
  pkc.on('error', (e: Error) => console.log('pkcErrorEvent:', e.message))

  const publishOne = async (signer: unknown, label: string): Promise<LocalPublishMetrics> => {
    const metrics: LocalPublishMetrics = {publishToVerificationTimeSeconds: null}
    if (options.challenge !== 'none') metrics.publishToChallengeTimeSeconds = null
    const comment = await pkc.createComment({
      signer,
      communityPublicKey: target.communityPublicKey,
      title: `pkc-js benchmark local-publish ${label} ${Date.now()}`,
      content: `pkc-js benchmark local-publish ${label} ${Date.now()}`,
    })
    const before = Date.now()
    try {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(Error(`timed out after ${publicationTimeoutMs / 1000}s`)), publicationTimeoutMs)
        comment.on('error', (e: Error) => console.log(`${label} error:`, e.message))
        comment.on('challenge', () => {
          metrics.publishToChallengeTimeSeconds = (Date.now() - before) / 1000
          comment.publishChallengeAnswers({challengeAnswers: target.challengeAnswers}).catch((e: Error) => {
            clearTimeout(timer)
            reject(Error(`publishing challenge answers failed: ${e.message}`))
          })
        })
        comment.once('challengeverification', (verification: any) => {
          clearTimeout(timer)
          if (!verification.challengeSuccess) {
            reject(Error(`rejected: ${verification.reason ?? JSON.stringify(verification.challengeErrors)}`))
            return
          }
          metrics.publishToVerificationTimeSeconds = (Date.now() - before) / 1000
          resolve()
        })
        comment.publish().catch((e: Error) => {
          clearTimeout(timer)
          reject(e)
        })
      })
    } catch (e) {
      metrics.error = {message: (e as Error).message}
      console.log(`  ${label} failed: ${(e as Error).message}`)
    } finally {
      await comment.stop().catch(() => {})
    }
    return metrics
  }

  // The first publication of a client also pays for joining the community's pubsub topic; it is
  // timed on its own (aggregate.warmupPublishToVerificationTimeSeconds) and kept out of the rounds.
  const warmup = await publishOne(await pkc.createSigner(), 'warmup')
  console.log(`warmup publication: ${warmup.publishToVerificationTimeSeconds ?? warmup.error?.message}`)

  const metricsId = `${reportName} ${runtime}`
  await postToServer('/local-community/metrics/start', {id: metricsId})
  if (isProfiledRun()) await postToServer('/local-community/profile/start')

  const publications: Record<string, LocalPublishMetrics> = {}
  let roundsTimeSeconds = 0
  for (let round = 0; round < options.rounds; round++) {
    const sharedSigner = options.sameAuthor ? await pkc.createSigner() : undefined
    const signers = await Promise.all(Array.from({length: options.burst}, async () => sharedSigner ?? pkc.createSigner()))
    const roundStart = Date.now()
    const results = await Promise.all(signers.map((signer, i) => publishOne(signer, `round ${round + 1} #${i + 1}`)))
    const roundSeconds = (Date.now() - roundStart) / 1000
    roundsTimeSeconds += roundSeconds
    results.forEach((metrics, i) => {
      publications[`round-${round + 1}-${String(i + 1).padStart(2, '0')}`] = metrics
    })
    const ok = results.filter((m) => typeof m.publishToVerificationTimeSeconds === 'number').length
    console.log(`round ${round + 1}/${options.rounds}: ${ok}/${options.burst} accepted in ${roundSeconds}s`)
  }

  let communityCpuProfile: CpuProfileSummary | undefined
  if (isProfiledRun()) {
    communityCpuProfile = (await postToServer<{profile: CpuProfileSummary}>('/local-community/profile/stop', {label: `local-publish ${metricsId}`})).profile
  }
  const communityProcess = (await postToServer<{metrics: ProcessMetrics | null}>('/local-community/metrics/stop', {id: metricsId})).metrics

  const times = Object.values(publications)
    .map((m) => m.publishToVerificationTimeSeconds)
    .filter((t): t is number => typeof t === 'number')
  const failed = Object.values(publications).length - times.length
  const communityCpuMs = communityProcess ? (communityProcess.cpuUserMs ?? 0) + (communityProcess.cpuSystemMs ?? 0) : null
  const report: BenchmarkReport = {
    name: reportName,
    type: benchmarkOptionsType,
    timestamp: Date.now(),
    timeSeconds: (Date.now() - beforeReportTimestamp) / 1000,
    runtime,
    publications,
    aggregate: {
      warmupPublishToVerificationTimeSeconds: warmup.publishToVerificationTimeSeconds ?? null,
      medianPublishToVerificationTimeSeconds: median(times),
      p95PublishToVerificationTimeSeconds: percentile(times, 95),
      maxPublishToVerificationTimeSeconds: times.length ? Math.max(...times) : null,
      throughputPublicationsPerSecond: roundsTimeSeconds ? Number((times.length / roundsTimeSeconds).toFixed(2)) : null,
      succeededCount: times.length,
      failedCount: failed,
      communityCpuPerPublicationMs: communityCpuMs !== null && times.length ? Number((communityCpuMs / times.length).toFixed(2)) : null,
    },
    ...(communityProcess ? {communityProcess} : {}),
    ...(communityCpuProfile ? {communityCpuProfile, profiled: true} : {}),
    process: runtimeMetrics.stop(),
  }
  await writeReport(report)
  console.log(report.aggregate)
  console.log(options.name, 'done')
  await pkc.destroy().catch(() => {})
  exitProcess()
})
