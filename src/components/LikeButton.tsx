import { useLikeMutation } from '../queries'
import { HeartIcon } from './icons'

interface LikeButtonProps {
  articleId: string
  count: number
  liked: boolean
  uid: string
  /** compact = feed card; full = article page */
  size?: 'compact' | 'full'
}

/** Instagram-style heart. Optimistic: the tap shows instantly. */
export function LikeButton({ articleId, count, liked, uid, size = 'compact' }: LikeButtonProps) {
  const mutation = useLikeMutation()
  const pendingHere = mutation.isPending && mutation.variables?.articleId === articleId
  const shownLiked = pendingHere ? mutation.variables!.like : liked
  const shownCount = pendingHere ? count + (mutation.variables!.like ? 1 : -1) : count

  return (
    <button
      onClick={(e) => {
        e.preventDefault() // cards are inside <Link>s — don't navigate
        e.stopPropagation()
        mutation.mutate({ articleId, like: !shownLiked, uid })
      }}
      aria-label={shownLiked ? 'Unlike' : 'Like'}
      className={`flex items-center gap-1.5 transition-colors ${
        shownLiked ? 'text-accent' : 'text-ink-faint active:text-accent'
      } ${size === 'full' ? 'text-sm' : 'text-xs'}`}
    >
      <HeartIcon filled={shownLiked} className={size === 'full' ? 'h-5 w-5' : 'h-4 w-4'} />
      {shownCount > 0 && <span className="font-medium tabular-nums">{shownCount}</span>}
    </button>
  )
}
