-- Daily Task Tracker — task descriptions
-- Run in the Supabase SQL editor, or via: supabase db push

alter table public.tasks
  add column description text
  check (description is null or char_length(description) between 1 and 2000);
