import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import './index.css'
import { Layout } from './components/Layout'
import { UpNextPage } from './pages/UpNextPage'
import { SchedulePage } from './pages/SchedulePage'
import { SearchPage } from './pages/SearchPage'
import { ShowPage } from './pages/ShowPage'
import { ForYouPage } from './pages/ForYouPage'
import { ProfilePage } from './pages/ProfilePage'
import { WritePage } from './pages/WritePage'
import { ArticlePage } from './pages/ArticlePage'
import { RankPage } from './pages/RankPage'
import { AuthPage } from './pages/AuthPage'
import { UserPage } from './pages/UserPage'
import { initAuth } from './store/session'

initAuth()

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, refetchOnWindowFocus: false },
  },
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route element={<Layout />}>
            <Route index element={<UpNextPage />} />
            <Route path="/schedule" element={<SchedulePage />} />
            <Route path="/foryou" element={<ForYouPage />} />
            <Route path="/search" element={<SearchPage />} />
            <Route path="/profile" element={<ProfilePage />} />
            <Route path="/write" element={<WritePage />} />
            <Route path="/article/:id" element={<ArticlePage />} />
            <Route path="/rank/:id" element={<RankPage />} />
            <Route path="/auth" element={<AuthPage />} />
            <Route path="/u/:username" element={<UserPage />} />
            <Route path="/show/:id" element={<ShowPage />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
)
