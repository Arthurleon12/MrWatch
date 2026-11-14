# MrWatch 📺

Track the shows you watch, never miss an episode, and share your taste —
the TV Time replacement, built by Arthur.

- **Up Next** — your watch queue, one tap per check-in
- **Schedule** — upcoming episodes in your timezone, binge drops and TBA handled
- **For You** — taste-matched recommendations with honest match % and attribution,
  "fans also watch" via TMDB, and articles from the community
- **The Ladder** — head-to-head ranking for your Top 10 shows, episodes and movies,
  plus 1–10 episode ratings that feed your taste profile
- **Movies & MrWatch AI** — want/watched lists and a movie picked for you and a friend
- **Spoiler guard** — episode titles and posts stay hidden until you've caught up
- **Accounts & social** — Google / Apple / email sign-in, unique @usernames,
  follow friends, public profiles (Supabase)

## Run it locally

```bash
npm ci          # Node 22 (see .nvmrc)
npm run dev
```

```bash
npm run lint && npm run typecheck && npm test   # what CI runs
npm run build && npm run preview                # the built app, under production's security headers
```

Works instantly in local, on-device mode. To turn on accounts, sync, and social,
follow [SETUP.md](SETUP.md) (Supabase + Vercel, ~30–45 min of account setup).

## Stack

React 19 · Vite 6 · TypeScript · Tailwind v4 · TanStack Query · React Router ·
Supabase (Postgres, Auth, RLS) · TVmaze API (shows & air dates) · TMDB (collaborative recs)

Data lives in swappable stores (`src/store/*`) — localStorage first, write-through
sync to Supabase when signed in (`src/lib/sync.ts`). Database schema and security
policies: [`supabase/schema.sql`](supabase/schema.sql).
