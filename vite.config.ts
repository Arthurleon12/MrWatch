import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

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

  // Which deploy an error report came from. Vercel sets the commit sha on
  // the build; locally it is just "dev".
  const buildId = (process.env.VERCEL_GIT_COMMIT_SHA ?? '').slice(0, 7) || 'dev'

  return {
    plugins: [react(), tailwindcss()],
    server: { port: 5173 },
    define: { 'import.meta.env.VITE_BUILD_ID': JSON.stringify(buildId) },
  }
})
