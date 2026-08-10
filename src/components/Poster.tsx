import { TvIcon } from './icons'

interface PosterProps {
  src: string | null | undefined
  alt: string
  className?: string
}

export function Poster({ src, alt, className = '' }: PosterProps) {
  if (!src) {
    return (
      <div className={`flex items-center justify-center bg-raised text-ink-faint ${className}`}>
        <TvIcon className="h-6 w-6" />
      </div>
    )
  }
  return <img src={src} alt={alt} loading="lazy" className={`object-cover bg-raised ${className}`} />
}
