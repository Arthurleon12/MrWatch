-- MrWatch — full database schema.
-- Run this once in the Supabase SQL editor (Dashboard → SQL Editor → New query → paste → Run).

create extension if not exists citext;

-- ---------------------------------------------------------------------------
-- profiles: one row per account, created when the user claims a username
-- ---------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  username citext unique not null,
  bio text not null default '',
  avatar_url text,
  top10_shows jsonb not null default '[]',
  top10_episodes jsonb not null default '[]',
  top10_movies jsonb not null default '[]',
  created_at timestamptz not null default now(),
  constraint username_format check (username ~ '^[A-Za-z0-9_]{3,20}$')
);

-- Usernames reserved for the founder's account. Enforced here, not in the
-- client, so nobody can claim them by talking to the API directly.
create or replace function public.enforce_reserved_usernames()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if lower(new.username::text) in ('arthur', 'mrwatch')
     and coalesce((select email from auth.users where id = new.id), '') <> 'arthurleon12@gmail.com'
  then
    raise exception 'This username is reserved.';
  end if;
  return new;
end
$$;

create trigger reserved_usernames
  before insert or update of username on public.profiles
  for each row execute function public.enforce_reserved_usernames();

-- ---------------------------------------------------------------------------
-- tracks: the shows a user follows
-- ---------------------------------------------------------------------------
create table public.tracks (
  user_id uuid not null references public.profiles (id) on delete cascade,
  show_id integer not null,
  name text not null,
  image text,
  status text,
  network text,
  premiered text,
  added_at timestamptz not null default now(),
  primary key (user_id, show_id)
);

-- ---------------------------------------------------------------------------
-- watched: per-episode check-ins
-- ---------------------------------------------------------------------------
create table public.watched (
  user_id uuid not null references public.profiles (id) on delete cascade,
  show_id integer not null,
  episode_id integer not null,
  watched_at timestamptz not null default now(),
  primary key (user_id, episode_id)
);
create index watched_by_show on public.watched (user_id, show_id);

-- ---------------------------------------------------------------------------
-- movie_tracks: movies on a user's list (TMDB ids; status: want | watched)
-- ---------------------------------------------------------------------------
create table public.movie_tracks (
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

-- ---------------------------------------------------------------------------
-- follows
-- ---------------------------------------------------------------------------
create table public.follows (
  follower_id uuid not null references public.profiles (id) on delete cascade,
  followee_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (follower_id, followee_id),
  constraint no_self_follow check (follower_id <> followee_id)
);
create index follows_by_followee on public.follows (followee_id);

-- ---------------------------------------------------------------------------
-- articles: posts pinned to a show (subject jsonb mirrors the app's shape)
-- ---------------------------------------------------------------------------
create table public.articles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  title text not null,
  body text not null,
  subject jsonb not null,
  created_at timestamptz not null default now()
);
create index articles_by_time on public.articles (created_at desc);

-- ---------------------------------------------------------------------------
-- likes: hearts on articles
-- ---------------------------------------------------------------------------
create table public.likes (
  user_id uuid not null references public.profiles (id) on delete cascade,
  article_id uuid not null references public.articles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, article_id)
);
create index likes_by_article on public.likes (article_id);

-- ---------------------------------------------------------------------------
-- notifications: written by database triggers only (follow / like)
-- ---------------------------------------------------------------------------
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references public.profiles (id) on delete cascade,
  actor_id uuid not null references public.profiles (id) on delete cascade,
  type text not null check (type in ('follow', 'like')),
  payload jsonb not null default '{}',
  read boolean not null default false,
  created_at timestamptz not null default now()
);
create index notifications_by_recipient
  on public.notifications (recipient_id, created_at desc);

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

create trigger notify_like
  after insert on public.likes
  for each row execute function public.notify_on_like();

-- ---------------------------------------------------------------------------
-- Row Level Security: everyone signed-in can read (it's a social app);
-- only the owner can write their own rows.
-- ---------------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.tracks enable row level security;
alter table public.watched enable row level security;
alter table public.movie_tracks enable row level security;
alter table public.follows enable row level security;
alter table public.articles enable row level security;
alter table public.likes enable row level security;
alter table public.notifications enable row level security;

create policy "profiles are readable by members"
  on public.profiles for select to authenticated using (true);
create policy "insert own profile"
  on public.profiles for insert to authenticated with check (id = auth.uid());
create policy "update own profile"
  on public.profiles for update to authenticated using (id = auth.uid());

create policy "tracks readable by members"
  on public.tracks for select to authenticated using (true);
create policy "manage own tracks"
  on public.tracks for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "watched readable by members"
  on public.watched for select to authenticated using (true);
create policy "manage own watched"
  on public.watched for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "movie tracks readable by members"
  on public.movie_tracks for select to authenticated using (true);
create policy "manage own movie tracks"
  on public.movie_tracks for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "follows readable by members"
  on public.follows for select to authenticated using (true);
create policy "follow as yourself"
  on public.follows for insert to authenticated with check (follower_id = auth.uid());
create policy "unfollow as yourself"
  on public.follows for delete to authenticated using (follower_id = auth.uid());

create policy "articles readable by members"
  on public.articles for select to authenticated using (true);
create policy "manage own articles"
  on public.articles for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "likes readable by members"
  on public.likes for select to authenticated using (true);
create policy "like as yourself"
  on public.likes for insert to authenticated with check (user_id = auth.uid());
create policy "unlike as yourself"
  on public.likes for delete to authenticated using (user_id = auth.uid());

create policy "own notifications readable"
  on public.notifications for select to authenticated using (recipient_id = auth.uid());
create policy "mark own notifications read"
  on public.notifications for update to authenticated
  using (recipient_id = auth.uid()) with check (recipient_id = auth.uid());
create policy "clear own notifications"
  on public.notifications for delete to authenticated using (recipient_id = auth.uid());

-- ---------------------------------------------------------------------------
-- Account deletion (App Store requires in-app deletion; good practice anyway)
-- ---------------------------------------------------------------------------
create or replace function public.delete_user()
returns void
language sql
security definer
set search_path = ''
as $$
  delete from auth.users where id = auth.uid();
$$;

revoke all on function public.delete_user() from public;
grant execute on function public.delete_user() to authenticated;
