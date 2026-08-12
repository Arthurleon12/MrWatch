# MrWatch — going online

Everything in the codebase is ready. These are the steps only you (Arthur) can do,
because they involve creating accounts and handling keys. Total time: ~30–45 minutes.
Until they're done, the app keeps working in local, on-device mode.

---

## 1. Supabase (the backend) — ~10 min

1. Go to https://supabase.com → **Start your project** → sign up (free tier is plenty).
2. Create a new project. Name: `mrwatch`. Pick a strong database password (save it), region close to you.
3. When the project is ready, open **SQL Editor → New query**, paste the entire contents
   of [`supabase/schema.sql`](supabase/schema.sql), and click **Run**. This creates every
   table, the security policies, the reserved-username rule (Arthur / MrWatch are locked
   to arthurleon12@gmail.com at the database level), and account deletion.
4. Go to **Settings → API** and copy two values:
   - **Project URL** → `VITE_SUPABASE_URL`
   - **anon public key** → `VITE_SUPABASE_ANON_KEY`
5. For local dev: duplicate `.env.example` as `.env.local` and paste both values in.
   Restart the dev server. The Profile tab now shows "Sign in / Create account".

## 2. Google login — ~10 min

1. Go to https://console.cloud.google.com → create a project (name: MrWatch).
2. **APIs & Services → OAuth consent screen**: External, app name MrWatch, your email.
   Add your friends/family emails as test users (or publish the app later).
3. **APIs & Services → Credentials → Create credentials → OAuth client ID**:
   - Type: Web application
   - Authorized redirect URI: `https://<YOUR-PROJECT-REF>.supabase.co/auth/v1/callback`
     (shown verbatim in Supabase → Authentication → Providers → Google)
4. Copy the **Client ID** and **Client secret** into
   Supabase → **Authentication → Providers → Google** → enable → save.

## 3. Apple login — ~15 min, needs the $99/yr Apple Developer account

Apple sign-in on the web requires an Apple Developer Program membership (you'll need it
for the App Store release anyway). If you don't have it yet, **skip this — Google +
email links work today**; the Apple button starts working the moment you configure it.

1. In https://developer.apple.com/account: create an **App ID**, then a **Services ID**
   (this is the OAuth client), enable "Sign in with Apple" on it.
2. Set its return URL to `https://<YOUR-PROJECT-REF>.supabase.co/auth/v1/callback`.
3. Create a **Sign in with Apple key**, download the .p8 file.
4. Supabase → Authentication → Providers → Apple → enable, fill in Services ID, Team ID,
   Key ID, and the .p8 contents.

## 4. Email sign-in — ~15 min (two important gotchas)

Magic links work out of the box, BUT:

1. **The built-in Supabase email sender is rate-limited to ~2–4 auth emails per hour
   for the whole project** — if three friends sign up the same evening, the later ones
   get nothing. Fix before invite night: create a free Resend (or Postmark) account,
   then Supabase → Authentication → Emails → SMTP settings → plug it in.
2. **The app supports typing a 6-digit code** (needed when MrWatch is installed on the
   home screen, where the emailed link would open in the browser instead). For the code
   to appear in the email: Supabase → Authentication → Emails → "Magic Link" template →
   add a line like `Your code: {{ .Token }}` next to the link. One-time change.

## 5. Auth URLs — 2 min (easy to forget!)

Supabase → **Authentication → URL Configuration**:
- **Site URL**: your production URL (e.g. `https://mrwatch.vercel.app`) once you have it.
- **Redirect URLs**: add both `http://localhost:5173/auth` and `https://<your-domain>/auth`.

## 6. Deploy to the web (Vercel) — ~10 min

1. Push this repo to GitHub (create a repo, `git remote add origin …`, `git push`).
2. Go to https://vercel.com → sign up with that GitHub → **Import** the repo.
   Vercel auto-detects Vite. `vercel.json` (already in the repo) handles SPA routing.
3. In the import screen, add the two environment variables from step 1.4.
4. Deploy. You get `https://mrwatch-<something>.vercel.app` — share that link with
   friends and family; it works on any phone, and "Add to Home Screen" installs it.
5. Go back to step 5 and set that URL as the Site URL / redirect.

Every future `git push` redeploys automatically.

## 7. Movies + MrWatch AI (TMDB) — ~5 min

Movies (search, watchlist, Top 10 movies) and the MrWatch AI "watch together" picks
run on the TMDB catalog. Two steps:

1. **Get a key**: https://www.themoviedb.org → sign up (free) → Settings → API →
   Create → Developer → fill the form (personal/hobby project) → copy the
   **API Key**. Either credential works — the short "API Key (v3 auth)" or the
   long "API Read Access Token".
2. **Give it to the app** — either way works, the first is better:
   - **For everyone**: add `VITE_TMDB_API_KEY` with that value in Vercel →
     Settings → Environment Variables, then redeploy. Every user gets movies with
     zero setup. (Also put it in your local `.env.local`.)
   - **Just this device**: paste it in Profile → Connections.

**If your database predates movies** (it does, if you ran schema.sql before Aug 11,
2026): open Supabase → SQL Editor and run
[`supabase/migrations/2026-08-11-movies.sql`](supabase/migrations/2026-08-11-movies.sql)
once. Until then movies still work on each device — they just don't sync/appear on
profiles. Everything else keeps syncing regardless.

## What your friends experience

Open the link → Continue with Google (or email link) → pick a unique @username →
their tracking starts syncing. They can find you with Search → People → @Arthur or
@MrWatch, follow you, see your Top 10s and articles, and their For You feed shows
everyone's articles.

## Notes

- Anyone who used the app before signing in keeps their history: first sign-in
  uploads the device's data into the new account.
- The TMDB key: see step 7 — one key in Vercel unlocks movies for everyone.
- Custom domain (e.g. mrwatch.app): buy the domain, add it in Vercel → Domains,
  then update the Supabase Site URL + redirect list.
