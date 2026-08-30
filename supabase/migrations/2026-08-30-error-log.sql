-- MrWatch migration: client error log (Aug 30, 2026).
--
-- Production failures happen in someone else's browser, where no amount of
-- CI can see them. This is the cheapest thing that fixes that: crashes,
-- unhandled rejections and — most importantly — silent SYNC failures land in
-- a table, so a repeat of the watch-history loss shows up as rows instead of
-- as a user noticing months later.
--
-- Read them in Dashboard → Table editor → client_errors (the dashboard uses
-- the service role, so it sees every row; users only ever see their own).
--
-- Idempotent: safe to run twice.

create table if not exists public.client_errors (
  id uuid primary key default gen_random_uuid(),
  -- null for a crash that happened before sign-in; kept if the account goes
  user_id uuid references auth.users (id) on delete set null,
  kind text not null,
  message text not null,
  stack text,
  -- the route PATTERN ("/u/:username"), never the filled-in path: grouping
  -- errors matters, knowing whose profile it was does not
  route text,
  -- which deploy this came from, so a fixed bug stops counting
  build text,
  user_agent text,
  created_at timestamptz not null default now(),
  constraint client_errors_kind_check
    check (kind in ('render', 'unhandled', 'rejection', 'sync', 'manual')),
  constraint client_errors_message_len check (char_length(message) between 1 and 500),
  constraint client_errors_stack_len check (stack is null or char_length(stack) <= 4000),
  constraint client_errors_route_len check (route is null or char_length(route) <= 120),
  constraint client_errors_build_len check (build is null or char_length(build) <= 40),
  constraint client_errors_agent_len check (user_agent is null or char_length(user_agent) <= 400)
);

create index if not exists client_errors_recent on public.client_errors (created_at desc);

alter table public.client_errors enable row level security;

-- Anyone may file a report, signed in or not — a crash on the auth screen is
-- exactly the kind we most need to hear about. Nobody can file one under
-- someone else's id, and the length limits above cap what a spammer can
-- write. Reads are restricted to your own rows, so this can never be used as
-- a place to stash and retrieve data.
drop policy if exists "anyone can report an error" on public.client_errors;
create policy "anyone can report an error"
  on public.client_errors for insert to anon, authenticated
  with check (user_id is null or user_id = auth.uid());

drop policy if exists "read only your own reports" on public.client_errors;
create policy "read only your own reports"
  on public.client_errors for select to authenticated
  using (user_id = auth.uid());
