create table public.statement_daily_spend (
  user_id uuid not null references auth.users(id) on delete cascade,
  spend_date date not null,
  amount numeric not null,
  primary key (user_id, spend_date)
);

alter table public.statement_daily_spend enable row level security;

create policy "Users manage their own statement daily spend"
on public.statement_daily_spend
for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

grant select, insert, update, delete on public.statement_daily_spend to authenticated;
