import { FilmIcon, TvIcon } from './icons'

interface PosterProps {
  src: string | null | undefined
  alt: string
  className?: string
  /** which placeholder icon to show when there is no artwork */
  kind?: 'tv' | 'movie'
}

export function Poster({ src, alt, className = '', kind = 'tv' }: PosterProps) {
  if (!src) {
    const Icon = kind === 'movie' ? FilmIcon : TvIcon
    // keep the name: a poster-only link would otherwise be announced as nothing
    return (
      <div
        role={alt ? 'img' : undefined}
        aria-label={alt || undefined}
        className={`flex items-center justify-center bg-raised text-ink-faint ${className}`}
      >
        <Icon className="h-6 w-6" />
      </div>
    )
  }
  return (
    <img
      src={src}
      alt={alt}
      loading="lazy"
      decoding="async"
      className={`object-cover bg-raised ${className}`}
    />
  )
}
