-- MrWatch migration: likes + notifications (Aug 13, 2026).
-- Adds Instagram-style social plumbing: article likes, and a notifications
-- feed filled by database triggers (follow -> notify, like -> notify) so
-- clients can't forge notifications for other people.
-- Idempotent: safe to run twice. Fresh installs get all of this from schema.sql.

create table if not exists public.likes (
  user_id uuid not null references public.profiles (id) on delete cascade,
  article_id uuid not null references public.articles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, article_id)
);
create index if not exists likes_by_article on public.likes (article_id);

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references public.profiles (id) on delete cascade,
  actor_id uuid not null references public.profiles (id) on delete cascade,
  type text not null check (type in ('follow', 'like')),
  payload jsonb not null default '{}',
  read boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists notifications_by_recipient
  on public.notifications (recipient_id, created_at desc);

-- ---------------------------------------------------------------------------
-- triggers: the database writes notifications, not the client
-- ---------------------------------------------------------------------------
create or replace function public.notify_on_follow()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.notifications (recipient_id, actor_id, type)
  values (new.followee_id, new.follower_id, 'follow');
  return new;
end
$$;

drop trigger if exists notify_follow on public.follows;
create trigger notify_follow
  after insert on public.follows
  for each row execute function public.notify_on_follow();

create or replace function public.notify_on_like()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  article_owner uuid;
  article_title text;
begin
  select user_id, title into article_owner, article_title
    from public.articles where id = new.article_id;
  if article_owner is not null and article_owner <> new.user_id then
    insert into public.notifications (recipient_id, actor_id, type, payload)
    values (
      article_owner,
      new.user_id,
      'like',
      jsonb_build_object('articleId', new.article_id, 'title', article_title)
    );
  end if;
  return new;
end
$$;

drop trigger if exists notify_like on public.likes;
create trigger notify_like
  after insert on public.likes
  for each row execute function public.notify_on_like();

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.likes enable row level security;
alter table public.notifications enable row level security;

drop policy if exists "likes readable by members" on public.likes;
create policy "likes readable by members"
  on public.likes for select to authenticated using (true);
drop policy if exists "like as yourself" on public.likes;
create policy "like as yourself"
  on public.likes for insert to authenticated with check (user_id = auth.uid());
drop policy if exists "unlike as yourself" on public.likes;
create policy "unlike as yourself"
  on public.likes for delete to authenticated using (user_id = auth.uid());

drop policy if exists "own notifications readable" on public.notifications;
create policy "own notifications readable"
  on public.notifications for select to authenticated using (recipient_id = auth.uid());
drop policy if exists "mark own notifications read" on public.notifications;
create policy "mark own notifications read"
  on public.notifications for update to authenticated
  using (recipient_id = auth.uid()) with check (recipient_id = auth.uid());
drop policy if exists "clear own notifications" on public.notifications;
create policy "clear own notifications"
  on public.notifications for delete to authenticated using (recipient_id = auth.uid());
