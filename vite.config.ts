import { readFileSync } from 'node:fs'
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

/**
 * The security headers production serves (vercel.json), so `npm run preview`
 * runs the built app under the same Content-Security-Policy. A change that
 * the policy would block shows up locally instead of on arthur.fund.
 */
function productionHeaders(): Record<string, string> {
  const config = JSON.parse(readFileSync(new URL('./vercel.json', import.meta.url), 'utf8')) as {
    headers?: { source: string; headers: { key: string; value: string }[] }[]
  }
  const all = config.headers?.find((h) => h.source === '/(.*)')?.headers ?? []
  return Object.fromEntries(
    all
      // the policy upgrades http → https, which a plain-http localhost can't serve
      .map((h) => [h.key, h.value.replace('; upgrade-insecure-requests', '')]),
  )
}

export default defineConfig(({ mode }) => {
  // Everything under VITE_ ships in the public bundle. Refuse to build if a
  // key doesn't look like the credential it claims to be — this catches a
  // wrong secret pasted into the deploy config before it can leak.
  const env = loadEnv(mode, process.cwd(), 'VITE_')
  const tmdbKey = (env.VITE_TMDB_API_KEY ?? '').trim()
  const looksLikeTmdb = /^([a-f0-9]{32}|eyJ[\w-]+\.[\w-]+\.[\w-]+)$/.test(tmdbKey)
  if (tmdbKey && !looksLikeTmdb) {
    throw new Error(
      'VITE_TMDB_API_KEY is not a TMDB credential (expected the 32-char v3 key ' +
        'or the eyJ… v4 read token). Refusing to bake it into a public bundle.',
    )
  }

  // The app deliberately falls back to on-device mode without Supabase, which
  // makes a missing variable on the production deploy look like a working
  // app that silently syncs nothing. Production must have both.
  if (process.env.VERCEL_ENV === 'production') {
    for (const name of ['VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY']) {
      if (!(env[name] ?? '').trim()) throw new Error(`${name} is not set for the production build.`)
    }
  }

  // Which deploy an error report came from. Vercel sets the commit sha on
  // the build; locally it is just "dev".
  const buildId = (process.env.VERCEL_GIT_COMMIT_SHA ?? '').slice(0, 7) || 'dev'

  return {
    plugins: [react(), tailwindcss()],
    server: { port: 5173 },
    preview: { port: 4173, headers: productionHeaders() },
    define: { 'import.meta.env.VITE_BUILD_ID': JSON.stringify(buildId) },
  }
})
