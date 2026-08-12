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

  return {
    plugins: [react(), tailwindcss()],
    server: { port: 5173 },
  }
})
