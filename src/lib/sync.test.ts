import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * These pin the failure that once destroyed a real watch history, and its
 * relatives: a device with an incomplete picture of the cloud must never be
 * able to delete from it, and an edit the cloud has not confirmed must never
 * be erased by a pull.
 */

type Row = Record<string, unknown>

const PK: Record<string, string[]> = {
  profiles: ['id'],
  tracks: ['user_id', 'show_id'],
  watched: ['user_id', 'episode_id'],
  movie_tracks: ['user_id', 'movie_id'],
  articles: ['id'],
}

const db = vi.hoisted(() => ({
  rows: {} as Record<string, Record<string, unknown>[]>,
  fail: new Set<string>(),
  writes: [] as string[],
  uid: 'user-a' as string | null,
}))

function from(table: string) {
  let op = 'select'
  let payload: Row[] = []
  let range: [number, number] | null = null
  let single = false
  const filters: ((r: Row) => boolean)[] = []
  const exec = () => {
    if (db.fail.has(`${op}:${table}`)) return { data: null, error: { message: `${op} ${table} failed` } }
    const all = (db.rows[table] ??= [])
    if (op === 'select') {
      const hit = all.filter((r) => filters.every((f) => f(r)))
      if (single) return { data: hit[0] ?? null, error: null }
      return { data: range ? hit.slice(range[0], range[1] + 1) : hit, error: null }
    }
    db.writes.push(`${op}:${table}`)
    if (op === 'upsert') {
      for (const row of payload) {
        const i = all.findIndex((r) => PK[table].every((k) => r[k] === row[k]))
        if (i >= 0) all[i] = { ...all[i], ...row }
        else all.push({ ...row })
      }
    } else {
      db.rows[table] = all.filter((r) => !filters.every((f) => f(r)))
    }
    return { data: null, error: null }
  }
  const q = {
    select: () => q,
    upsert: (rows: Row[] | Row) => ((op = 'upsert'), (payload = Array.isArray(rows) ? rows : [rows]), q),
    delete: () => ((op = 'delete'), q),
    eq: (c: string, v: unknown) => (filters.push((r) => r[c] === v), q),
    in: (c: string, vs: unknown[]) => (filters.push((r) => vs.includes(r[c])), q),
    order: () => q,
    range: (a: number, b: number) => ((range = [a, b]), q),
    maybeSingle: () => ((single = true), q),
    then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(exec()).then(res, rej),
  }
  return q
}

vi.mock('./supabase', () => ({ supabase: { from } }))
vi.mock('./report', () => ({ reportError: vi.fn() }))
vi.mock('../store/session', () => ({
  getSession: () => (db.uid ? { user: { id: db.uid } } : null),
}))

import {
  clearLocalData,
  flushSync,
  hasUnsyncedChanges,
  pullAndHydrate,
  startSync,
  stopSync,
} from './sync'
import { getLibraryState, setEpisodeWatched, trackShow, untrackShow } from '../store/library'
import { makeShow } from '../test/fixtures'

const A = 'user-a'
const B = 'user-b'

function seedCloud(uid: string, showId: number, episodes: number[]) {
  ;(db.rows.profiles ??= []).push({ id: uid, username: uid })
  ;(db.rows.tracks ??= []).push({ user_id: uid, show_id: showId, name: 'Show', added_at: '2026-01-01T00:00:00Z' })
  for (const episode_id of episodes) {
    ;(db.rows.watched ??= []).push({ user_id: uid, show_id: showId, episode_id, rating: null })
  }
}

const cloudEpisodes = (uid: string) =>
  (db.rows.watched ?? [])
    .filter((r) => r.user_id === uid)
    .map((r) => r.episode_id as number)
    .sort((a, b) => a - b)

/** Let queued pushes, and the pulls or pushes they schedule, run dry. */
async function settle() {
  for (let i = 0; i < 6; i++) await flushSync()
}

/** What a closed-and-reopened app looks like: memory gone, disk kept. */
function restart() {
  stopSync()
  startSync()
}

beforeEach(() => {
  stopSync()
  db.uid = A
  clearLocalData()
  db.rows = {}
  db.fail.clear()
  db.writes = []
  startSync()
})

describe('push', () => {
  it('does not delete rows another device added since this one last pulled', async () => {
    seedCloud(A, 7, [1, 2])
    await pullAndHydrate(A)
    // meanwhile, on the laptop:
    db.rows.watched.push({ user_id: A, show_id: 7, episode_id: 3, rating: null })

    setEpisodeWatched(7, 4, true)
    await settle()

    expect(cloudEpisodes(A)).toEqual([1, 2, 3, 4])
  })

  it('removes from the cloud exactly what the user removed here', async () => {
    seedCloud(A, 7, [1, 2])
    await pullAndHydrate(A)
    setEpisodeWatched(7, 2, false)
    await settle()
    expect(cloudEpisodes(A)).toEqual([1])
  })

  it('untracking a show removes its rows and nothing else', async () => {
    seedCloud(A, 7, [1, 2])
    db.rows.tracks.push({ user_id: A, show_id: 8, name: 'Other', added_at: '2026-01-01T00:00:00Z' })
    db.rows.watched.push({ user_id: A, show_id: 8, episode_id: 50, rating: null })
    await pullAndHydrate(A)
    untrackShow(7)
    await settle()
    expect(cloudEpisodes(A)).toEqual([50])
    expect(db.rows.tracks.map((r) => r.show_id)).toEqual([8])
  })

  it('writes nothing at all after a failed pull', async () => {
    seedCloud(A, 7, [1, 2])
    db.fail.add('select:watched')
    await pullAndHydrate(A)

    trackShow(makeShow({ id: 9, name: 'New' }))
    setEpisodeWatched(9, 90, true)
    await settle()

    expect(db.writes).toEqual([])
    expect(cloudEpisodes(A)).toEqual([1, 2])
  })

  it('catches up once a pull succeeds, without deleting what it never saw', async () => {
    seedCloud(A, 7, [1, 2])
    db.fail.add('select:watched')
    await pullAndHydrate(A)
    trackShow(makeShow({ id: 9, name: 'New' }))
    setEpisodeWatched(9, 90, true)
    await settle()

    db.fail.clear()
    await pullAndHydrate(A)
    await settle()

    expect(cloudEpisodes(A)).toEqual([1, 2, 90])
    expect(getLibraryState().watched[7]?.slice().sort()).toEqual([1, 2])
  })
})

describe('pull', () => {
  it('keeps an edit the cloud never received (app closed before the push)', async () => {
    seedCloud(A, 7, [1, 2])
    await pullAndHydrate(A)
    setEpisodeWatched(7, 3, true) // debounce pending…
    restart() // …and the app is killed

    await pullAndHydrate(A)
    expect(getLibraryState().watched[7]).toContain(3)
    await settle()
    expect(cloudEpisodes(A)).toEqual([1, 2, 3])
  })

  it('keeps an edit whose push failed', async () => {
    seedCloud(A, 7, [1, 2])
    await pullAndHydrate(A)
    db.fail.add('upsert:watched')
    setEpisodeWatched(7, 3, true)
    await settle()
    expect(cloudEpisodes(A)).toEqual([1, 2])

    db.fail.clear()
    restart()
    await pullAndHydrate(A)
    await settle()
    expect(getLibraryState().watched[7]).toContain(3)
    expect(cloudEpisodes(A)).toEqual([1, 2, 3])
  })

  it('takes the cloud as truth when nothing local is unsynced', async () => {
    seedCloud(A, 7, [1, 2])
    await pullAndHydrate(A)
    db.rows.watched = db.rows.watched.filter((r) => r.episode_id !== 2) // removed on another device
    await pullAndHydrate(A)
    expect(getLibraryState().watched[7]).toEqual([1])
  })
})

describe('first sync of a new account', () => {
  it('uploads history that existed on the device before the account', async () => {
    trackShow(makeShow({ id: 7, name: 'Before' }))
    setEpisodeWatched(7, 1, true)
    ;(db.rows.profiles ??= []).push({ id: A, username: 'a' })

    await pullAndHydrate(A, true)
    await settle()
    expect(cloudEpisodes(A)).toEqual([1])
  })

  it('an interrupted first sync resumes instead of wiping the device', async () => {
    trackShow(makeShow({ id: 7, name: 'Before' }))
    setEpisodeWatched(7, 1, true)
    ;(db.rows.profiles ??= []).push({ id: A, username: 'a' })
    db.fail.add('upsert:watched')
    await pullAndHydrate(A, true)
    await settle()
    expect(cloudEpisodes(A)).toEqual([])

    db.fail.clear()
    restart()
    await pullAndHydrate(A) // an ordinary boot, not a seeding one
    await settle()
    expect(getLibraryState().watched[7]).toEqual([1])
    expect(cloudEpisodes(A)).toEqual([1])
  })
})

describe('unsynced changes', () => {
  it('reports them until a push carrying them succeeds — sign-out relies on this', async () => {
    seedCloud(A, 7, [1, 2])
    await pullAndHydrate(A)
    expect(hasUnsyncedChanges(A)).toBe(false)

    db.fail.add('upsert:watched')
    setEpisodeWatched(7, 3, true)
    expect(hasUnsyncedChanges(A)).toBe(true)
    await settle()
    expect(hasUnsyncedChanges(A)).toBe(true) // the push failed: still not safe to wipe

    db.fail.clear()
    setEpisodeWatched(7, 4, true)
    await settle()
    expect(hasUnsyncedChanges(A)).toBe(false)
    expect(cloudEpisodes(A)).toEqual([1, 2, 3, 4])
  })
})

describe('account boundaries', () => {
  it("never uploads the previous user's leftovers into another account", async () => {
    seedCloud(A, 7, [1, 2])
    await pullAndHydrate(A)
    setEpisodeWatched(7, 3, true) // unsynced, then A's session expires
    stopSync()

    db.uid = B
    ;(db.rows.profiles ??= []).push({ id: B, username: 'b' })
    startSync()
    await pullAndHydrate(B, true)
    await settle()

    expect(getLibraryState().shows).toEqual({})
    expect(cloudEpisodes(B)).toEqual([])
    expect(cloudEpisodes(A)).toEqual([1, 2])
  })

  it('drops a pull that resolves after the account changed', async () => {
    seedCloud(A, 7, [1, 2])
    const pending = pullAndHydrate(A)
    db.uid = null
    await pending
    expect(getLibraryState().shows).toEqual({})
  })
})
