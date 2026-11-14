/**
 * The two pure rules the sync layer is built on. They exist because "replace
 * the cloud with this device's snapshot" destroyed a real watch history: a
 * device that has an incomplete picture must never be able to delete rows it
 * has simply not seen.
 *
 * A *baseline* is what this device last saw in the cloud for one table: a map
 * of row key → signature (a string that changes when the row's synced fields
 * change). Everything is expressed against it:
 *
 *   push  = only the rows this device added or changed, and deletions of rows
 *           the device knew about and the user removed here
 *   merge = cloud state, plus this device's unsynced adds/changes, minus this
 *           device's unsynced removals
 */

export type Baseline<K> = Map<K, string>

export function signatures<K, V>(rows: Map<K, V>, sig: (v: V) => string): Baseline<K> {
  const out: Baseline<K> = new Map()
  for (const [k, v] of rows) out.set(k, sig(v))
  return out
}

/**
 * What a push has to send. A key the baseline has never seen is never deleted
 * — it can only have come from another device.
 */
export function diffAgainstBaseline<K, V>(
  local: Map<K, V>,
  baseline: Baseline<K>,
  sig: (v: V) => string,
): { upserts: V[]; deletes: K[] } {
  const upserts: V[] = []
  for (const [k, v] of local) {
    if (baseline.get(k) !== sig(v)) upserts.push(v)
  }
  const deletes: K[] = []
  for (const k of baseline.keys()) {
    if (!local.has(k)) deletes.push(k)
  }
  return { upserts, deletes }
}

/**
 * Fold unsynced local edits into a fresh cloud copy.
 *
 * With a baseline it is a three-way merge. Without one (a fresh page load —
 * the baseline lives in memory) nothing can tell "removed here" from "added
 * elsewhere", so the merge is a union with local values winning: an unsynced
 * removal may come back, but nothing is ever lost.
 */
export function mergeWithCloud<K, V>(
  cloud: Map<K, V>,
  local: Map<K, V>,
  baseline: Baseline<K> | undefined,
  sig: (v: V) => string,
): Map<K, V> {
  const merged = new Map(cloud)
  if (!baseline) {
    for (const [k, v] of local) merged.set(k, v)
    return merged
  }
  for (const k of baseline.keys()) {
    if (!local.has(k)) merged.delete(k) // removed on this device, not yet pushed
  }
  for (const [k, v] of local) {
    // added or changed here; an untouched row follows the cloud, including
    // the cloud having dropped it on another device
    if (baseline.get(k) !== sig(v)) merged.set(k, v)
  }
  return merged
}

export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}
