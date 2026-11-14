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
  -- what you thought of it: 1-10, one decimal, feeds the taste engine
  rating numeric(3,1) check (rating is null or (rating >= 1 and rating <= 10)),
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
-- client_errors: crashes and silent failures from real browsers
-- ---------------------------------------------------------------------------
create table public.client_errors (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users (id) on delete set null,
  kind text not null,
  message text not null,
  stack text,
  -- the route PATTERN ("/u/:username"), never the filled-in path
  route text,
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
create index client_errors_recent on public.client_errors (created_at desc);

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
alter table public.client_errors enable row level security;

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

-- A crash on the auth screen is exactly the kind we most need to hear about,
-- so anonymous reports are allowed — but never under someone else's id, and
-- reads are limited to your own rows so this can't be used to stash data.
create policy "anyone can report an error"
  on public.client_errors for insert to anon, authenticated
  with check (user_id is null or user_id = auth.uid());
create policy "read only your own reports"
  on public.client_errors for select to authenticated
  using (user_id = auth.uid());

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

-- ---------------------------------------------------------------------------
-- Hardening: limits, quotas, throttles (same as migrations/2026-11-14-hardening.sql)
-- ---------------------------------------------------------------------------
-- ===== A. client_errors: RLS on, narrow grants, server-side throttle =======
alter table public.client_errors enable row level security;
revoke all on public.client_errors from anon, authenticated;
grant insert on public.client_errors to anon, authenticated;
grant select on public.client_errors to authenticated;

create or replace function public.throttle_client_errors()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  recent integer;
begin
  new.created_at := now();  -- never client-chosen: the window can't be dodged
  if new.user_id is null then
    select count(*) into recent from (
      select 1 from public.client_errors
      where user_id is null and created_at > now() - interval '1 hour'
      limit 60) s;
    if recent >= 60 then return null; end if;   -- drop silently
  else
    select count(*) into recent from (
      select 1 from public.client_errors
      where user_id = new.user_id and created_at > now() - interval '1 hour'
      limit 30) s;
    if recent >= 30 then return null; end if;
  end if;
  return new;
end
$$;

drop trigger if exists client_errors_throttle on public.client_errors;
create trigger client_errors_throttle
  before insert on public.client_errors
  for each row execute function public.throttle_client_errors();

-- ===== B. length and shape limits ==========================================
alter table public.profiles drop constraint if exists profiles_bio_len;
alter table public.profiles add constraint profiles_bio_len
  check (char_length(bio) <= 500) not valid;

-- avatars are always a downscaled data URL (src/store/profile.ts fileToAvatar);
-- a remote URL here would let one user log the IP of everyone who sees them
alter table public.profiles drop constraint if exists profiles_avatar_shape;
alter table public.profiles add constraint profiles_avatar_shape
  check (avatar_url is null or (
    char_length(avatar_url) <= 150000
    and avatar_url ~ '^data:image/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$')) not valid;

alter table public.profiles drop constraint if exists profiles_top10_shape;
alter table public.profiles add constraint profiles_top10_shape
  check (
    jsonb_typeof(top10_shows) = 'array'    and jsonb_array_length(top10_shows) <= 10    and octet_length(top10_shows::text) <= 8000
    and jsonb_typeof(top10_episodes) = 'array' and jsonb_array_length(top10_episodes) <= 10 and octet_length(top10_episodes::text) <= 8000
    and jsonb_typeof(top10_movies) = 'array'   and jsonb_array_length(top10_movies) <= 10   and octet_length(top10_movies::text) <= 8000
  ) not valid;

alter table public.tracks drop constraint if exists tracks_limits;
alter table public.tracks add constraint tracks_limits
  check (
    show_id > 0
    and char_length(name) between 1 and 300
    and (image is null or (char_length(image) <= 500 and image ~ '^https?://static\.tvmaze\.com/'))
    and (status is null or char_length(status) <= 40)
    and (network is null or char_length(network) <= 120)
    and (premiered is null or char_length(premiered) <= 20)
  ) not valid;

alter table public.watched drop constraint if exists watched_ids_positive;
alter table public.watched add constraint watched_ids_positive
  check (show_id > 0 and episode_id > 0) not valid;

alter table public.movie_tracks drop constraint if exists movie_tracks_limits;
alter table public.movie_tracks add constraint movie_tracks_limits
  check (
    movie_id > 0
    and char_length(title) between 1 and 300
    and (year is null or char_length(year) <= 10)
    and (poster is null or (char_length(poster) <= 500 and poster ~ '^https://image\.tmdb\.org/'))
    and jsonb_typeof(genres) = 'array' and octet_length(genres::text) <= 2000
    and (runtime is null or runtime between 0 and 100000)
  ) not valid;

-- a subject that is not this exact shape crashes the feed for everyone who
-- loads it, so the shape is enforced where the row is written
alter table public.articles drop constraint if exists articles_limits;
alter table public.articles add constraint articles_limits
  check (
    char_length(title) between 1 and 200
    and char_length(body) <= 20000
    and jsonb_typeof(subject) = 'object'
    and octet_length(subject::text) <= 2000
    and jsonb_typeof(subject -> 'showId') = 'number'
    and jsonb_typeof(subject -> 'showName') = 'string'
    and coalesce(jsonb_typeof(subject -> 'image'), 'null') in ('string', 'null')
    and coalesce(jsonb_typeof(subject -> 'epCode'), 'null') in ('string', 'null')
    and coalesce(jsonb_typeof(subject -> 'epName'), 'null') in ('string', 'null')
    and (subject ->> 'image' is null
         or subject ->> 'image' ~ '^https?://(static\.tvmaze\.com|image\.tmdb\.org)/')
  ) not valid;

-- ===== C. articles: no future dating, no re-dating, no owner change ========
-- (a post dated 2099 would sit at the top of everyone's feed forever)
create or replace function public.guard_article_row()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    new.created_at := old.created_at;
    new.user_id := old.user_id;
  elsif new.created_at > now() then
    new.created_at := now();
  end if;
  return new;
end
$$;

drop trigger if exists articles_guard on public.articles;
create trigger articles_guard
  before insert or update on public.articles
  for each row execute function public.guard_article_row();

-- ===== D. per-user row quotas (one count per statement, not per row) =======
create or replace function public.enforce_row_quota()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  n bigint;
begin
  if uid is null then return null; end if;  -- service role / dashboard
  execute format('select count(*) from %s where %I = $1', tg_relid::regclass, tg_argv[0])
    into n using uid;
  if n > tg_argv[1]::bigint then
    raise exception 'Row limit reached for % (max %)', tg_table_name, tg_argv[1]
      using errcode = 'check_violation';
  end if;
  return null;
end
$$;

drop trigger if exists tracks_quota on public.tracks;
create trigger tracks_quota after insert on public.tracks
  for each statement execute function public.enforce_row_quota('user_id', '5000');

drop trigger if exists watched_quota on public.watched;
create trigger watched_quota after insert on public.watched
  for each statement execute function public.enforce_row_quota('user_id', '100000');

drop trigger if exists movie_tracks_quota on public.movie_tracks;
create trigger movie_tracks_quota after insert on public.movie_tracks
  for each statement execute function public.enforce_row_quota('user_id', '10000');

drop trigger if exists articles_quota on public.articles;
create trigger articles_quota after insert on public.articles
  for each statement execute function public.enforce_row_quota('user_id', '500');

drop trigger if exists follows_quota on public.follows;
create trigger follows_quota after insert on public.follows
  for each statement execute function public.enforce_row_quota('follower_id', '5000');

-- ===== E. notifications: one per event, recipient may only mark read =======
create index if not exists notifications_by_actor
  on public.notifications (actor_id, recipient_id, type);

create or replace function public.notify_on_follow()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- follow / unfollow in a loop must not grow the recipient's feed
  if not exists (
    select 1 from public.notifications
    where recipient_id = new.followee_id and actor_id = new.follower_id and type = 'follow'
  ) then
    insert into public.notifications (recipient_id, actor_id, type)
    values (new.followee_id, new.follower_id, 'follow');
  end if;
  return new;
end
$$;

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
  if article_owner is not null and article_owner <> new.user_id
     and not exists (
       select 1 from public.notifications
       where recipient_id = article_owner and actor_id = new.user_id and type = 'like'
         and payload ->> 'articleId' = new.article_id::text)
  then
    insert into public.notifications (recipient_id, actor_id, type, payload)
    values (article_owner, new.user_id, 'like',
      jsonb_build_object('articleId', new.article_id, 'title', left(article_title, 200)));
  end if;
  return new;
end
$$;

revoke update on public.notifications from anon, authenticated;
grant update (read) on public.notifications to authenticated;

-- ===== F. function hygiene =================================================
revoke all on function public.delete_user() from public, anon;
grant execute on function public.delete_user() to authenticated;

-- the reserved names now also require the owner's email to be CONFIRMED
create or replace function public.enforce_reserved_usernames()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if lower(new.username::text) in ('arthur', 'mrwatch')
     and coalesce((select email from auth.users
                   where id = new.id and email_confirmed_at is not null), '')
         <> 'arthurleon12@gmail.com'
  then
    raise exception 'This username is reserved.';
  end if;
  return new;
end
$$;

-- ===== G. indexes for queries the app actually runs ========================
create index if not exists articles_by_user on public.articles (user_id, created_at desc);
create index if not exists watched_by_user_time on public.watched (user_id, watched_at desc);
create index if not exists client_errors_by_user on public.client_errors (user_id, created_at desc);
