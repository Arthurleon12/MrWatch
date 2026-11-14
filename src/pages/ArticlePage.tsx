import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { deleteArticle, useArticles, type Article } from '../store/articles'
import { supabase } from '../lib/supabase'
import { useSession } from '../store/session'
import { useArticleLikes, useSpoilerGuard } from '../queries'
import { agoLabel } from '../lib/time'
import { compactCount } from '../lib/format'
import { cleanSubject } from '../lib/sanitize'
import { useBack } from '../lib/useBack'
import { Poster } from '../components/Poster'
import { LikeButton } from '../components/LikeButton'
import { ShareButton } from '../components/ShareButton'
import { SpoilerBlock, SpoilerText } from '../components/Spoiler'
import { AuthRedirect, PageSkeleton } from '../components/AppShell'
import { ChevronLeftIcon } from '../components/icons'

export function ArticlePage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const goBack = useBack('/foryou')
  const articles = useArticles()
  const { session, initializing } = useSession()
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const local = articles.find((a) => a.id === id)

  // not one of yours? fetch it from the community feed
  const { data: remote, isLoading, isError, refetch } = useQuery({
    queryKey: ['article', id],
    queryFn: async (): Promise<Article | null> => {
      const { data, error } = await supabase!
        .from('articles')
        .select('id, title, body, subject, created_at, profiles(username)')
        .eq('id', id!)
        .maybeSingle()
      // a failed fetch is not a deleted article — let the page say so
      if (error) throw new Error(error.message)
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

  // Rows come from the cloud (other people's, or your own synced from an
  // older build): a malformed one is treated as missing, never rendered.
  const raw = local ?? remote
  const subject = raw ? cleanSubject(raw.subject) : null
  const article =
    raw && subject
      ? {
          id: raw.id,
          title: typeof raw.title === 'string' ? raw.title : '',
          body: typeof raw.body === 'string' ? raw.body : '',
          author: typeof raw.author === 'string' ? raw.author : 'someone',
          createdAt: raw.createdAt,
          subject,
        }
      : null
  const isMine = !!local

  const uid = session?.user.id
  const { data: likeRows } = useArticleLikes(id ? [id] : [], !!session)
  const likers = likeRows ?? []
  const liked = likers.some((r) => r.user_id === uid)

  // deep links (a notification, a shared URL) reach this page without ever
  // passing the gated card in the feed — so it gates here too
  const spoilers = useSpoilerGuard(article ? [article.subject.showId] : [])
  const spoils = article ? spoilers.hides(article.subject.showId, article.subject.epCode) : false

  if (!article) {
    // the session is still restoring — "doesn't exist" would be a lie
    if (initializing || isLoading) return <PageSkeleton />
    // a shared link opened signed-out: sign in, then come straight back here
    if (!local && supabase && !session) return <AuthRedirect />
    if (isError) {
      return (
        <div className="px-4 pt-6">
          <p className="text-sm text-ink-soft">Couldn't load this article — check your connection.</p>
          <button
            onClick={() => void refetch()}
            className="mt-3 min-h-11 rounded-full bg-accent px-5 font-display text-xs font-bold text-bg"
          >
            Retry
          </button>
        </div>
      )
    }
    return (
      <div className="px-4 pt-6">
        <p className="text-sm text-ink-soft">This article doesn't exist (or was deleted).</p>
        <Link to="/foryou" className="mt-3 inline-block text-sm text-accent">Back to For You</Link>
      </div>
    )
  }

  return (
    <div className="px-4 pt-4">
      <div className="flex items-center justify-between">
        <button
          onClick={goBack}
          aria-label="Back"
          className="flex h-11 w-11 items-center justify-center rounded-full bg-surface text-ink-soft"
        >
          <ChevronLeftIcon className="h-5 w-5" />
        </button>
        {/* only posts that exist in the cloud have a link anyone else can open */}
        {supabase && session && (
          <ShareButton
            path={`/article/${article.id}`}
            title={spoils ? `A post about ${article.subject.showName} on MrWatch` : article.title}
            text={`@${article.author} on ${article.subject.showName} — MrWatch`}
            label="Share this article"
          />
        )}
      </div>

      {/* the card is one big link; the spoiler control sits above it rather
          than inside it, so revealing a title never also navigates */}
      <div className="relative mt-4 rounded-xl bg-surface p-3">
        <Link
          to={`/show/${article.subject.showId}`}
          aria-label={`Open ${article.subject.showName}`}
          className="absolute inset-0 rounded-xl"
        />
        <div className="pointer-events-none relative flex items-center gap-3">
          <Poster src={article.subject.image} alt="" className="h-16 w-11 flex-none rounded-md" />
          <div className="min-w-0">
            <span className="font-display text-[0.6875rem] font-bold uppercase tracking-wider text-accent">
              {article.subject.epCode ? `Episode · ${article.subject.epCode}` : 'Show'}
            </span>
            <p className="truncate font-display text-sm font-bold">
              {article.subject.showName}
              {article.subject.epName && ' — '}
              {article.subject.epName &&
                (spoils ? (
                  <SpoilerText label="Episode title hidden" className="pointer-events-auto">
                    {article.subject.epName}
                  </SpoilerText>
                ) : (
                  article.subject.epName
                ))}
            </p>
          </div>
        </div>
      </div>

      <h1 className="mt-5 font-display text-2xl font-bold leading-tight" style={{ textWrap: 'balance' }}>
        {spoils ? <SpoilerText label="Post title hidden">{article.title}</SpoilerText> : article.title}
      </h1>
      <p className="mt-1.5 text-xs text-ink-faint">
        by @{article.author} · {agoLabel(new Date(article.createdAt))}
      </p>

      {session && uid && id && (
        <div className="mt-3 flex items-center gap-3">
          <LikeButton articleId={id} uid={uid} count={likers.length} liked={liked} size="full" />
          {likers.length > 0 && (
            <p className="min-w-0 truncate text-xs text-ink-faint">
              Liked by{' '}
              {likers.slice(0, 3).map((l, i) => (
                <span key={l.user_id}>
                  {i > 0 && ', '}
                  <Link to={`/u/${l.username}`} className="font-medium text-ink-soft">
                    @{l.username}
                  </Link>
                </span>
              ))}
              {likers.length > 3 && ` and ${compactCount(likers.length - 3)} more`}
            </p>
          )}
        </div>
      )}

      {spoils ? (
        <SpoilerBlock epCode={article.subject.epCode} className="mt-4">
          <div className="mt-4 whitespace-pre-wrap text-[0.95rem] leading-relaxed text-ink">
            {article.body}
          </div>
        </SpoilerBlock>
      ) : (
        <div className="mt-4 whitespace-pre-wrap text-[0.95rem] leading-relaxed text-ink">
          {article.body}
        </div>
      )}

      {isMine &&
        (confirmingDelete ? (
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <button
              onClick={() => {
                deleteArticle(article.id)
                navigate('/foryou', { replace: true })
              }}
              className="min-h-11 rounded-full bg-red-400/15 px-4 font-display text-xs font-bold text-red-400"
            >
              Delete for good
            </button>
            <button
              onClick={() => setConfirmingDelete(false)}
              className="min-h-11 rounded-full bg-surface px-4 font-display text-xs font-bold text-ink-soft"
            >
              Keep it
            </button>
          </div>
        ) : (
          <button
            onClick={() => setConfirmingDelete(true)}
            className="-mx-2 mt-6 min-h-11 px-2 text-xs font-medium text-red-400"
          >
            Delete article
          </button>
        ))}
    </div>
  )
}
