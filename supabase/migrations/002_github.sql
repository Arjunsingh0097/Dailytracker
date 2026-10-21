-- Daily Task Tracker — GitHub pull request integration
-- Run in the Supabase SQL editor, or via: supabase db push

-- Public-safe connection info (client can read its own rows)
create table public.github_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  label text not null default 'GitHub',
  github_login text not null,
  github_user_id bigint not null,
  resource_owner text,
  token_last4 text not null,
  token_expires_at timestamptz,
  status text not null default 'active' check (status in ('active','invalid','expired','rate_limited')),
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  unique (user_id, github_user_id, resource_owner)
);

-- Encrypted secrets (NO client policies; service role only)
create table public.github_secrets (
  connection_id uuid primary key references public.github_connections(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  token_ciphertext text not null,
  token_iv text not null,
  key_version int not null default 1
);

-- Cached pull requests
create table public.github_prs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  connection_id uuid not null references public.github_connections(id) on delete cascade,
  gh_pr_id bigint not null,
  repo_full_name text not null,
  number integer not null,
  title text not null,
  html_url text not null,
  state text not null check (state in ('open','closed','merged')),
  is_draft boolean not null default false,
  author_login text,
  role text not null default 'author' check (role in ('author','reviewer','assignee','review_requested')),
  labels jsonb not null default '[]',
  created_at_gh timestamptz not null,
  updated_at_gh timestamptz not null,
  closed_at_gh timestamptz,
  merged_at_gh timestamptz,
  unique (user_id, gh_pr_id, role)
);
create index github_prs_user_created_idx on public.github_prs (user_id, created_at_gh desc);
create index github_prs_user_repo_idx on public.github_prs (user_id, repo_full_name);

alter table public.github_connections enable row level security;
alter table public.github_secrets enable row level security;  -- intentionally no policies
alter table public.github_prs enable row level security;

create policy "own connections select" on public.github_connections for select using (auth.uid() = user_id);
create policy "own connections delete" on public.github_connections for delete using (auth.uid() = user_id);
create policy "own prs select" on public.github_prs for select using (auth.uid() = user_id);

-- Realtime so the PR list updates without a refresh
alter publication supabase_realtime add table public.github_prs;

-- Link tasks to PRs
alter table public.tasks
  add column github_pr_url text,
  add column github_pr_title text;
