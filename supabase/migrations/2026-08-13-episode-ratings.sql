-- MrWatch migration: episode ratings (Aug 13, 2026).
-- 1-10 with one decimal (7.2, 8.8), attached to the check-in row.
-- Idempotent: safe to run twice.

alter table public.watched
  add column if not exists rating numeric(3,1)
  check (rating is null or (rating >= 1 and rating <= 10));
