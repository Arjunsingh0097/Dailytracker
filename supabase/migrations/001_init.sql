-- Daily Task Tracker — initial schema
-- Run in the Supabase SQL editor, or via: supabase db push

create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 200),
  task_date date not null,
  estimate_minutes integer check (estimate_minutes is null or estimate_minutes between 1 and 999),
  spent_seconds integer not null default 0,
  timer_started_at timestamptz,
  is_done boolean not null default false,
  done_at timestamptz,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index tasks_user_date_idx on public.tasks (user_id, task_date);

-- Only one running timer per user
create unique index one_running_timer_per_user
  on public.tasks (user_id) where timer_started_at is not null;

alter table public.tasks enable row level security;

create policy "own tasks select" on public.tasks for select using (auth.uid() = user_id);
create policy "own tasks insert" on public.tasks for insert with check (auth.uid() = user_id);
create policy "own tasks update" on public.tasks for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own tasks delete" on public.tasks for delete using (auth.uid() = user_id);

create or replace function public.set_updated_at() returns trigger as $$
begin new.updated_at = now(); return new; end; $$ language plpgsql;

create trigger tasks_updated_at before update on public.tasks
  for each row execute function public.set_updated_at();

alter publication supabase_realtime add table public.tasks;

-- ---------------------------------------------------------------------------
-- Timer RPCs (security invoker: caller's RLS applies).
-- Elapsed time is always spent_seconds + (now() - timer_started_at) when running.
-- ---------------------------------------------------------------------------

-- start_timer(task_id): pause any other running task for the user, then start this one.
create or replace function public.start_timer(task_id uuid)
returns setof public.tasks
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_now timestamptz := now();
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  -- Pause any other running timer for this user (atomic vs. the unique index)
  update public.tasks
     set spent_seconds = spent_seconds
       + greatest(extract(epoch from (v_now - timer_started_at))::integer, 0),
         timer_started_at = null
   where user_id = v_uid
     and timer_started_at is not null
     and id <> task_id;

  update public.tasks
     set timer_started_at = v_now
   where id = task_id
     and user_id = v_uid
     and timer_started_at is null
     and is_done = false;

  return query
    select * from public.tasks where user_id = v_uid and id = task_id;
end;
$$;

-- pause_timer(task_id): add elapsed seconds to spent_seconds and clear timer_started_at.
create or replace function public.pause_timer(task_id uuid)
returns setof public.tasks
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_now timestamptz := now();
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  update public.tasks
     set spent_seconds = spent_seconds
       + greatest(extract(epoch from (v_now - timer_started_at))::integer, 0),
         timer_started_at = null
   where id = task_id
     and user_id = v_uid
     and timer_started_at is not null;

  return query
    select * from public.tasks where user_id = v_uid and id = task_id;
end;
$$;

-- complete_task(task_id): stop the timer if running, mark done.
create or replace function public.complete_task(task_id uuid)
returns setof public.tasks
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_now timestamptz := now();
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  update public.tasks
     set spent_seconds = spent_seconds
       + case when timer_started_at is not null
              then greatest(extract(epoch from (v_now - timer_started_at))::integer, 0)
              else 0 end,
         timer_started_at = null,
         is_done = true,
         done_at = v_now
   where id = task_id
     and user_id = v_uid;

  return query
    select * from public.tasks where user_id = v_uid and id = task_id;
end;
$$;
