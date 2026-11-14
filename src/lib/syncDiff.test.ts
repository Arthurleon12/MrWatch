import { describe, expect, it } from 'vitest'
import { chunk, diffAgainstBaseline, mergeWithCloud, signatures } from './syncDiff'

const sig = (v: { id: number; r?: number }) => String(v.r ?? '')
const rows = (...items: { id: number; r?: number }[]) => new Map(items.map((i) => [i.id, i]))

describe('diffAgainstBaseline', () => {
  it('never deletes a row the device has not seen', () => {
    // the device knows 1 and 2; the cloud also holds 3 from another device
    const baseline = signatures(rows({ id: 1 }, { id: 2 }), sig)
    const diff = diffAgainstBaseline(rows({ id: 1 }, { id: 2 }, { id: 4 }), baseline, sig)
    expect(diff.deletes).toEqual([])
    expect(diff.upserts).toEqual([{ id: 4 }])
  })

  it('deletes only what this device knew about and the user removed', () => {
    const baseline = signatures(rows({ id: 1 }, { id: 2 }), sig)
    expect(diffAgainstBaseline(rows({ id: 1 }), baseline, sig)).toEqual({ upserts: [], deletes: [2] })
  })

  it('an empty local copy against an empty baseline deletes nothing', () => {
    expect(diffAgainstBaseline(new Map(), new Map(), sig)).toEqual({ upserts: [], deletes: [] })
  })

  it('re-sends a row whose synced fields changed, and only that row', () => {
    const baseline = signatures(rows({ id: 1, r: 7 }, { id: 2, r: 8 }), sig)
    const diff = diffAgainstBaseline(rows({ id: 1, r: 9 }, { id: 2, r: 8 }), baseline, sig)
    expect(diff.upserts).toEqual([{ id: 1, r: 9 }])
  })
})

describe('mergeWithCloud', () => {
  it('without a baseline it is a union: nothing local or remote is lost', () => {
    const merged = mergeWithCloud(rows({ id: 1 }, { id: 2 }), rows({ id: 2, r: 9 }, { id: 3 }), undefined, sig)
    expect([...merged.keys()].sort()).toEqual([1, 2, 3])
    expect(merged.get(2)).toEqual({ id: 2, r: 9 }) // the unsynced local value wins
  })

  it('with a baseline it keeps remote adds, local adds and local removals', () => {
    const baseline = signatures(rows({ id: 1 }, { id: 2 }), sig)
    const cloud = rows({ id: 1 }, { id: 2 }, { id: 5 }) // 5 added on another device
    const local = rows({ id: 1 }, { id: 4 }) // 2 removed here, 4 added here
    const merged = mergeWithCloud(cloud, local, baseline, sig)
    expect([...merged.keys()].sort()).toEqual([1, 4, 5])
  })

  it('a row untouched here follows the cloud, including a remote delete', () => {
    const baseline = signatures(rows({ id: 1 }, { id: 2 }), sig)
    const merged = mergeWithCloud(rows({ id: 1 }), rows({ id: 1 }, { id: 2 }), baseline, sig)
    expect([...merged.keys()]).toEqual([1])
  })

  it('a remote change to an untouched row is taken', () => {
    const baseline = signatures(rows({ id: 1, r: 5 }), sig)
    const merged = mergeWithCloud(rows({ id: 1, r: 8 }), rows({ id: 1, r: 5 }), baseline, sig)
    expect(merged.get(1)).toEqual({ id: 1, r: 8 })
  })
})

describe('chunk', () => {
  it('splits without losing or duplicating items', () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]])
    expect(chunk([], 2)).toEqual([])
  })
})
