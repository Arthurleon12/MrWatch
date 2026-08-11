/**
 * Tiny event bus. Stores announce mutations here; the sync layer listens
 * and pushes to Supabase. Keeps stores free of any backend imports.
 */

export type StoreName = 'library' | 'movies' | 'profile' | 'articles'

type Handler = (store: StoreName) => void

const handlers = new Set<Handler>()

export function onStoreChange(handler: Handler): () => void {
  handlers.add(handler)
  return () => handlers.delete(handler)
}

export function emitStoreChange(store: StoreName) {
  handlers.forEach((h) => h(store))
}
