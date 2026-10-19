import {discoverCommunities} from './discover-communities.ts'
import type {CommentIdentifier, CommentSampleSpec, CommunityIdentifier} from '../types.ts'

// Live comments for the fetch-comment benchmark, picked from the production boards' current pages.
// Hardcoded CIDs went stale as boards purged old threads (every fetch-comment cell reported nothing
// for months), so the benchmark server samples posts and replies at run time instead — once per run
// and spec, so every cell of a run fetches exactly the same comments.

interface PageComment {
  cid?: string
  depth?: number
  replyCount?: number
  replies?: {pages?: Record<string, {comments?: PageComment[]}>}
}

interface PkcLike {
  getCommunity: (a: {name: string; publicKey: string}) => Promise<any>
}

const withTimeout = <T>(promise: Promise<T>, ms: number, label: string): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(Error(`${label} timed out after ${ms / 1000}s`)), ms)
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

// every comment in the board's preloaded pages, posts and the replies preloaded under them
const commentsOf = (community: any): {posts: string[]; replies: string[]} => {
  const posts = new Set<string>()
  const replies = new Set<string>()
  const walk = (comments: PageComment[] = []) => {
    for (const comment of comments) {
      if (!comment?.cid) continue
      if ((comment.depth ?? 0) === 0) posts.add(comment.cid)
      else replies.add(comment.cid)
      for (const page of Object.values(comment.replies?.pages ?? {})) walk(page?.comments)
    }
  }
  for (const page of Object.values((community?.posts?.pages ?? {}) as Record<string, {comments?: PageComment[]}>)) {
    walk(page?.comments)
  }
  return {posts: [...posts], replies: [...replies]}
}

// a board whose preloaded posts carry no preloaded replies still has replies one page away
const fetchSomeReplies = async (community: any, wanted: number): Promise<string[]> => {
  const replies: string[] = []
  const posts: PageComment[] = Object.values((community?.posts?.pages ?? {}) as Record<string, {comments?: PageComment[]}>)
    .flatMap((page) => page?.comments ?? [])
    .filter((post) => (post.replyCount ?? 0) > 0)
  for (const post of posts) {
    if (replies.length >= wanted) break
    const pageCids = Object.values(((post as any).replies?.pageCids ?? {}) as Record<string, string>)
    for (const pageCid of pageCids) {
      try {
        const page = await withTimeout(community.posts.getPage({cid: pageCid}), 30_000, `replies page ${pageCid}`)
        for (const reply of (page as {comments?: PageComment[]})?.comments ?? []) if (reply.cid) replies.push(reply.cid)
        break
      } catch (e) {
        // try the next post
      }
    }
  }
  return replies.slice(0, wanted)
}

const cache = new Map<string, Promise<CommentIdentifier[]>>()

export const sampleComments = (pkc: PkcLike, spec: CommentSampleSpec, boards?: CommunityIdentifier[]): Promise<CommentIdentifier[]> => {
  const key = JSON.stringify(spec)
  let sample = cache.get(key)
  if (!sample) {
    sample = pickComments(pkc, spec, boards)
    // a failed sample is not cached, so the next cell tries again
    sample.catch(() => cache.delete(key))
    cache.set(key, sample)
  }
  return sample
}

const pickComments = async (pkc: PkcLike, spec: CommentSampleSpec, boards?: CommunityIdentifier[]): Promise<CommentIdentifier[]> => {
  const candidates = boards ?? (await discoverCommunities())
  // boards that loaded and have comments, in directory order, until we have `spec.communities`
  const loaded: {board: CommunityIdentifier; posts: string[]; replies: string[]}[] = []
  for (const board of candidates) {
    if (loaded.length >= spec.communities) break
    try {
      const community = await withTimeout(pkc.getCommunity({name: board.name, publicKey: board.publicKey}), 60_000, `getCommunity ${board.name}`)
      const comments = commentsOf(community)
      const wantedReplies = Math.ceil(spec.replies / spec.communities)
      if (comments.replies.length < wantedReplies) {
        comments.replies.push(...(await fetchSomeReplies(community, wantedReplies - comments.replies.length)))
      }
      if (spec.posts && !comments.posts.length) continue
      if (spec.replies && !comments.replies.length) continue
      loaded.push({board, ...comments})
      console.log(`comment sample: ${board.name} has ${comments.posts.length} posts, ${comments.replies.length} replies in its pages`)
    } catch (e) {
      console.log(`comment sample: skipping ${board.name}: ${(e as Error).message}`)
    }
  }
  if (!loaded.length) throw Error('no board with comments loaded')

  // round-robin over the boards, newest-first within each board's pages
  const take = (kind: 'posts' | 'replies', count: number): CommentIdentifier[] => {
    const picked: CommentIdentifier[] = []
    for (let i = 0; picked.length < count && i < count * loaded.length; i++) {
      const source = loaded[i % loaded.length]!
      const cid = source[kind][Math.floor(i / loaded.length)]
      if (cid) picked.push({cid, communityName: source.board.name, communityPublicKey: source.board.publicKey})
    }
    return picked
  }
  return [...take('posts', spec.posts), ...take('replies', spec.replies)]
}
