import { useSyncExternalStore } from 'react'
import { emitStoreChange } from '../lib/bus'

/**
 * Local articles store — the seed of the For You feed. Once accounts exist,
 * articles become rows in Supabase and the feed mixes in posts from people
 * you follow; the card shapes below stay identical.
 */

export interface ArticleSubject {
  showId: number
  showName: string
  image: string | null
  /** set when the article is about one episode, e.g. "S5E01" */
  epCode?: string
  epName?: string
}

export interface Article {
  id: string
  title: string
  body: string
  subject: ArticleSubject
  author: string
  createdAt: number
}

const STORAGE_KEY = 'mrwatch:articles:v1'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function load(): Article[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const list = JSON.parse(raw) as Article[]
      // ids written before cloud sync existed weren't UUIDs; the database
      // requires them, so upgrade any legacy id in place
      return list.map((a) => (UUID_RE.test(a.id) ? a : { ...a, id: crypto.randomUUID() }))
    }
  } catch {
    // start fresh
  }
  return []
}

let state: Article[] = load()
const listeners = new Set<() => void>()
let hydrating = false

function commit(next: Article[]) {
  state = next
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  listeners.forEach((l) => l())
  if (!hydrating) emitStoreChange('articles')
}

export function getArticlesState(): Article[] {
  return state
}

/** Replace local state with the cloud copy — never triggers a push. */
export function hydrateArticles(next: Article[]) {
  hydrating = true
  commit(next)
  hydrating = false
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function useArticles(): Article[] {
  return useSyncExternalStore(subscribe, () => state)
}

export function addArticle(article: Omit<Article, 'id' | 'createdAt'>) {
  const full: Article = {
    ...article,
    id: crypto.randomUUID(),
    createdAt: Date.now(),
  }
  commit([full, ...state])
  return full.id
}

export function deleteArticle(id: string) {
  commit(state.filter((a) => a.id !== id))
}
