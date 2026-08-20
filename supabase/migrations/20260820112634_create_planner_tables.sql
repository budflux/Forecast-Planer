create table public.settings (
  user_id uuid not null references auth.users(id) on delete cascade,
  key text not null,
  value text not null default '',
  primary key (user_id, key)
);

create table public.earnings (
  id text primary key default gen_random_uuid()::text,
  user_id uuid not null references auth.users(id) on delete cascade,
  "fromDate" date,
  "toDate" date,
  "weeklyWage" numeric not null default 0,
  "weeklySpend" numeric not null default 0
);

create table public.rentals (
  id text primary key default gen_random_uuid()::text,
  user_id uuid not null references auth.users(id) on delete cascade,
  "fromDate" date,
  "toDate" date,
  "weeklyRental" numeric not null default 0
);

create table public.purchases (
  id text primary key default gen_random_uuid()::text,
  user_id uuid not null references auth.users(id) on delete cascade,
  date date,
  description text not null default '',
  amount numeric not null default 0,
  "includeFlag" integer not null default 1
);

create table public.deposits (
  id text primary key default gen_random_uuid()::text,
  user_id uuid not null references auth.users(id) on delete cascade,
  "depositDate" date,
  description text not null default '',
  amount numeric not null default 0
);

create table public.fixed_costs (
  id text primary key default gen_random_uuid()::text,
  user_id uuid not null references auth.users(id) on delete cascade,
  "startYear" integer,
  "endYear" integer,
  "totalYearlyCost" numeric not null default 0
);

create table public.loan_inputs (
  id text primary key default gen_random_uuid()::text,
  user_id uuid not null references auth.users(id) on delete cascade,
  "effectiveDate" date,
  "interestRate" numeric not null default 0,
  "weeklyRepayment" numeric not null default 0
);

alter table public.settings enable row level security;
alter table public.earnings enable row level security;
alter table public.rentals enable row level security;
alter table public.purchases enable row level security;
alter table public.deposits enable row level security;
alter table public.fixed_costs enable row level security;
alter table public.loan_inputs enable row level security;

do $$
declare
  table_name text;
begin
  foreach table_name in array array['settings', 'earnings', 'rentals', 'purchases', 'deposits', 'fixed_costs', 'loan_inputs'] loop
    execute format('create policy "Users manage their own %1$s" on public.%1$s for all using (auth.uid() = user_id) with check (auth.uid() = user_id)', table_name);
  end loop;
end $$;

grant select, insert, update, delete on
  public.settings,
  public.earnings,
  public.rentals,
  public.purchases,
  public.deposits,
  public.fixed_costs,
  public.loan_inputs
  to authenticated;
