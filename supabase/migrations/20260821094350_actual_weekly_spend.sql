create table public.actual_weekly_spend (
  id text primary key default gen_random_uuid()::text,
  user_id uuid not null references auth.users(id) on delete cascade,
  "weekStart" date not null,
  "weekEnd" date not null,
  amount numeric not null check (amount >= 0),
  unique (user_id, "weekStart")
);

alter table public.actual_weekly_spend enable row level security;

create policy "Users manage their own actual weekly spend"
on public.actual_weekly_spend
for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

grant select, insert, update, delete on public.actual_weekly_spend to authenticated;
