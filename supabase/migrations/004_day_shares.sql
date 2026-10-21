-- Daily Task Tracker — public day share links
-- A share link is a random UUID capability: anyone holding it can read that
-- one user's tasks for that one day (read-only). No auth required to view.

create table public.day_shares (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  task_date date not null,
  created_at timestamptz not null default now(),
  unique (user_id, task_date)
);

alter table public.day_shares enable row level security;

create policy "own shares select" on public.day_shares for select using (auth.uid() = user_id);
create policy "own shares insert" on public.day_shares for insert with check (auth.uid() = user_id);
create policy "own shares delete" on public.day_shares for delete using (auth.uid() = user_id);

-- Public read: given a share token, return found flag + that day's tasks.
-- SECURITY DEFINER so anon can read without client policies on tasks.
create or replace function public.get_shared_day(p_token uuid)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'found', true,
    'task_date', to_char(s.task_date, 'YYYY-MM-DD'),
    'tasks', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'title', t.title,
          'description', t.description,
          'is_done', t.is_done,
          'estimate_minutes', t.estimate_minutes,
          'spent_seconds', t.spent_seconds,
          'timer_started_at', case when t.timer_started_at is null then null else to_char(t.timer_started_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') end,
          'github_pr_url', t.github_pr_url,
          'sort_order', t.sort_order
        )
        order by t.sort_order, t.created_at
      )
      from public.tasks t
      where t.user_id = s.user_id and t.task_date = s.task_date
    ), '[]'::jsonb)
  )
  from public.day_shares s
  where s.id = p_token;
$$;

revoke execute on function public.get_shared_day(uuid) from public;
grant execute on function public.get_shared_day(uuid) to anon, authenticated;
