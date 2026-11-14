import { lazy } from 'react'

// Up Next is the start screen, so it ships in the main bundle. Every other
// screen loads on first visit (Layout's <Suspense> shows a skeleton meanwhile;
// ErrorBoundary reloads once if a deploy has replaced the chunk).
export const SchedulePage = lazy(() => import('./SchedulePage').then((m) => ({ default: m.SchedulePage })))
export const SearchPage = lazy(() => import('./SearchPage').then((m) => ({ default: m.SearchPage })))
export const ShowPage = lazy(() => import('./ShowPage').then((m) => ({ default: m.ShowPage })))
export const MoviePage = lazy(() => import('./MoviePage').then((m) => ({ default: m.MoviePage })))
export const TogetherPage = lazy(() => import('./TogetherPage').then((m) => ({ default: m.TogetherPage })))
export const ForYouPage = lazy(() => import('./ForYouPage').then((m) => ({ default: m.ForYouPage })))
export const ProfilePage = lazy(() => import('./ProfilePage').then((m) => ({ default: m.ProfilePage })))
export const SettingsPage = lazy(() => import('./SettingsPage').then((m) => ({ default: m.SettingsPage })))
export const WritePage = lazy(() => import('./WritePage').then((m) => ({ default: m.WritePage })))
export const ArticlePage = lazy(() => import('./ArticlePage').then((m) => ({ default: m.ArticlePage })))
export const RankPage = lazy(() => import('./RankPage').then((m) => ({ default: m.RankPage })))
export const AuthPage = lazy(() => import('./AuthPage').then((m) => ({ default: m.AuthPage })))
export const UserPage = lazy(() => import('./UserPage').then((m) => ({ default: m.UserPage })))
export const NotificationsPage = lazy(() => import('./NotificationsPage').then((m) => ({ default: m.NotificationsPage })))
export const FriendsPage = lazy(() => import('./FriendsPage').then((m) => ({ default: m.FriendsPage })))
