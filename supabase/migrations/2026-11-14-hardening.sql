-- MrWatch hardening (2026-11-14). Idempotent — safe to run more than once.
--
-- The publishable key ships in the browser, so anyone can call the REST API
-- directly. The policies already stop one user writing another's rows; this
-- closes what was left: unbounded storage, rows shaped to crash other
-- people's screens, tracking pixels in image columns, and notification spam.
--
-- CHECK constraints are added NOT VALID: existing rows are not re-checked,
-- only new and updated ones. Before running, confirm these return nothing
-- surprising (each should be empty, or within the limits below):
--
--   select id from public.profiles
--     where avatar_url is not null and avatar_url !~ '^data:image/(jpeg|png|webp);base64,';
--   select distinct substring(image from '^https?://[^/]+') from public.tracks where image is not null;
--   select distinct substring(poster from '^https?://[^/]+') from public.movie_tracks where poster is not null;
--   select max(char_length(bio)) from public.profiles;
--   select max(char_length(title)), max(char_length(body)) from public.articles;

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
