# MrWatch 📺

Track the shows you watch, never miss an episode, and share your taste —
the TV Time replacement, built by Arthur.

- **Up Next** — your watch queue, one tap per check-in
- **Schedule** — upcoming episodes in your timezone, binge drops and TBA handled
- **For You** — taste-matched recommendations with honest match % and attribution,
  "fans also watch" via TMDB, and articles from the community
- **The Ladder** — head-to-head ranking instead of star ratings; your Top 10 shows
  and episodes live on your profile
- **Accounts & social** — Google / Apple / email sign-in, unique @usernames,
  follow friends, public profiles (Supabase)

## Run it locally

```bash
npm install
npm run dev
```

Works instantly in local, on-device mode. To turn on accounts, sync, and social,
follow [SETUP.md](SETUP.md) (Supabase + Vercel, ~30–45 min of account setup).

## Stack

React 19 · Vite 6 · TypeScript · Tailwind v4 · TanStack Query · React Router ·
Supabase (Postgres, Auth, RLS) · TVmaze API (shows & air dates) · TMDB (collaborative recs)

Data lives in swappable stores (`src/store/*`) — localStorage first, write-through
sync to Supabase when signed in (`src/lib/sync.ts`). Database schema and security
policies: [`supabase/schema.sql`](supabase/schema.sql).
