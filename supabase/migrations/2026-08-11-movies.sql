-- MrWatch migration: movies (Aug 11, 2026).
-- For databases created from the original schema.sql. Fresh installs get all
-- of this from schema.sql already. Run in Supabase → SQL Editor → Run.
-- Idempotent: safe to run twice.

alter table public.profiles
  add column if not exists top10_movies jsonb not null default '[]';

create table if not exists public.movie_tracks (
  user_id uuid not null references public.profiles (id) on delete cascade,
  movie_id integer not null,
  title text not null,
  year text,
  poster text,
  genres jsonb not null default '[]',
  runtime integer,
  status text not null check (status in ('want', 'watched')),
  added_at timestamptz not null default now(),
  watched_at timestamptz,
  primary key (user_id, movie_id)
);

alter table public.movie_tracks enable row level security;

drop policy if exists "movie tracks readable by members" on public.movie_tracks;
create policy "movie tracks readable by members"
  on public.movie_tracks for select to authenticated using (true);

drop policy if exists "manage own movie tracks" on public.movie_tracks;
create policy "manage own movie tracks"
  on public.movie_tracks for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
