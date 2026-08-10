import { useQuery } from '@tanstack/react-query'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { deleteArticle, useArticles, type Article } from '../store/articles'
import { supabase } from '../lib/supabase'
import { useSession } from '../store/session'
import { agoLabel } from '../lib/time'
import { Poster } from '../components/Poster'
import { ChevronLeftIcon } from '../components/icons'

export function ArticlePage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const articles = useArticles()
  const { session } = useSession()
  const local = articles.find((a) => a.id === id)

  // not one of yours? fetch it from the community feed
  const { data: remote, isLoading } = useQuery({
    queryKey: ['article', id],
    queryFn: async (): Promise<Article | null> => {
      const { data } = await supabase!
        .from('articles')
        .select('id, title, body, subject, created_at, profiles(username)')
        .eq('id', id!)
        .maybeSingle()
      if (!data) return null
      return {
        id: data.id,
        title: data.title,
        body: data.body,
        subject: data.subject,
        author: (data.profiles as unknown as { username: string })?.username ?? 'someone',
        createdAt: new Date(data.created_at).getTime(),
      }
    },
    enabled: !local && !!supabase && !!session && !!id,
  })

  const article = local ?? remote
  const isMine = !!local

  if (!article && isLoading) {
    return <div className="px-4 pt-6"><div className="h-40 animate-pulse rounded-xl bg-surface" /></div>
  }
  if (!article) {
    return (
      <div className="px-4 pt-6">
        <p className="text-sm text-ink-soft">This article doesn't exist (or was deleted).</p>
        <Link to="/foryou" className="mt-3 inline-block text-sm text-accent">Back to For You</Link>
      </div>
    )
  }

  const { subject } = article
  return (
    <div className="px-4 pt-4">
      <button
        onClick={() => navigate(-1)}
        aria-label="Back"
        className="flex h-9 w-9 items-center justify-center rounded-full bg-surface text-ink-soft"
      >
        <ChevronLeftIcon className="h-5 w-5" />
      </button>

      <Link
        to={`/show/${subject.showId}`}
        className="mt-4 flex items-center gap-3 rounded-xl bg-surface p-3"
      >
        <Poster src={subject.image} alt="" className="h-16 w-11 flex-none rounded-md" />
        <div className="min-w-0">
          <span className="font-display text-[0.62rem] font-bold uppercase tracking-wider text-accent">
            {subject.epCode ? `Episode · ${subject.epCode}` : 'Show'}
          </span>
          <p className="truncate font-display text-sm font-bold">
            {subject.showName}
            {subject.epName ? ` — ${subject.epName}` : ''}
          </p>
        </div>
      </Link>

      <h1 className="mt-5 font-display text-2xl font-bold leading-tight" style={{ textWrap: 'balance' }}>
        {article.title}
      </h1>
      <p className="mt-1.5 text-xs text-ink-faint">
        by @{article.author} · {agoLabel(new Date(article.createdAt))}
      </p>

      <div className="mt-4 whitespace-pre-wrap text-[0.95rem] leading-relaxed text-ink">
        {article.body}
      </div>

      {isMine && (
        <button
          onClick={() => {
            deleteArticle(article.id)
            navigate('/foryou', { replace: true })
          }}
          className="mt-8 text-xs font-medium text-red-400"
        >
          Delete article
        </button>
      )}
    </div>
  )
}
