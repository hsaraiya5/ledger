-- Ledger's whole schema. One owner per database: only the email in private.owner can read anything,
-- and only the server (service role) writes. Plaid access tokens are stored encrypted by the app.

-- ---- Owner ----

create schema if not exists private;

create table private.owner (email text primary key);

-- Runs as its definer so signed-in users can ask "am I the owner?" without reading the table.
create or replace function private.is_owner()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from private.owner where email = lower(auth.jwt() ->> 'email'))
$$;
grant usage on schema private to authenticated;
grant execute on function private.is_owner() to authenticated;

-- Setup calls this once (with the secret key) to record whose data this is.
create or replace function public.set_owner(owner_email text)
returns void
language sql
security definer
set search_path = ''
as $$
  delete from private.owner;
  insert into private.owner (email) values (lower(trim(owner_email)));
$$;
revoke execute on function public.set_owner(text) from public, anon, authenticated;
grant execute on function public.set_owner(text) to service_role;

-- ---- Accounts and balances ----

create table public.plaid_items (
  id text primary key, -- Plaid item_id
  institution_name text not null,
  products text[] not null,
  access_token_enc text not null,
  transactions_cursor text,
  status text not null default 'ok' check (status in ('ok', 'needs_login', 'error')),
  last_error text,
  last_synced_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.accounts (
  id text primary key,
  name text not null,
  institution text not null,
  bucket text not null check (bucket in ('retirement', 'brokerage', 'cash', 'credit')),
  tax_treatment text not null,
  data_source text not null default 'manual' check (data_source in ('plaid', 'statement', 'manual')),
  sort_order int not null default 0,
  hidden boolean not null default false,
  -- An account that counts toward another (e.g. checking + savings under one bank).
  parent_id text references public.accounts (id) on delete set null,
  plaid_item_id text references public.plaid_items (id) on delete set null,
  plaid_account_id text unique,
  mask text,
  nickname text,
  kept_separate boolean not null default false,
  created_at timestamptz not null default now()
);
create index accounts_plaid_item_idx on public.accounts (plaid_item_id);
create index accounts_parent_idx on public.accounts (parent_id);

create table public.balance_snapshots (
  account_id text not null references public.accounts (id) on delete cascade,
  as_of date not null,
  balance numeric(14, 2) not null,
  source text not null check (source in ('sheet', 'plaid', 'statement', 'manual')),
  created_at timestamptz not null default now(),
  primary key (account_id, as_of)
);
create index balance_snapshots_as_of_idx on public.balance_snapshots (as_of);

-- ---- Investments ----

create table public.holdings (
  account_id text not null references public.accounts (id) on delete cascade,
  as_of date not null,
  security_id text not null,
  ticker text,
  name text not null,
  security_type text,
  quantity numeric(20, 6) not null,
  price numeric(16, 4),
  value numeric(14, 2) not null,
  cost_basis numeric(14, 2),
  primary key (account_id, as_of, security_id)
);
create index holdings_as_of_idx on public.holdings (as_of);

create table public.investment_transactions (
  id text primary key, -- Plaid investment_transaction_id
  account_id text not null references public.accounts (id) on delete cascade,
  date date not null,
  type text not null,
  subtype text,
  name text not null,
  ticker text,
  quantity numeric(20, 6),
  price numeric(16, 4),
  amount numeric(14, 2) not null -- Plaid sign: positive = cash out of the account (a buy), negative = cash in
);
create index investment_transactions_account_date_idx on public.investment_transactions (account_id, date);

-- What you paid per share, where the brokerage doesn't say.
create table public.manual_cost (
  account_id text not null references public.accounts (id) on delete cascade,
  ticker text not null,
  per_share numeric not null check (per_share > 0),
  updated_at timestamptz not null default now(),
  primary key (account_id, ticker)
);

-- ---- Spending ----

create table public.categories (
  name text primary key,
  is_project boolean not null default false,
  color text not null, -- a palette slot, g1–g14
  sort integer not null default 0,
  started_on date,
  finished_on date,
  created_at timestamptz not null default now()
);

create table public.subcategories (
  category text not null references public.categories (name) on update cascade on delete cascade,
  name text not null,
  sort integer not null default 0,
  primary key (category, name)
);

create table public.transactions (
  id text primary key, -- Plaid transaction_id
  account_id text not null references public.accounts (id) on delete cascade,
  date date not null,
  amount numeric(14, 2) not null, -- Plaid sign: positive = money out
  name text not null,
  merchant_name text,
  plaid_category text,
  plaid_category_detailed text,
  pending boolean not null default false,
  kind text check (kind in ('spend', 'transfer', 'income')),
  category text,
  subcategory text,
  category_source text check (category_source in ('rule', 'auto', 'plaid', 'ai', 'user')),
  confidence numeric(3, 2),
  needs_review boolean not null default false,
  note text,
  payback boolean not null default false, -- money in that is someone paying you back, so not income
  created_at timestamptz not null default now()
);
create index transactions_account_date_idx on public.transactions (account_id, date);
create index transactions_date_idx on public.transactions (date);
create index transactions_needs_review_idx on public.transactions (needs_review) where needs_review;
create index transactions_uncategorized_idx on public.transactions (date) where kind is null;

create table public.category_rules (
  id bigint generated always as identity primary key,
  match text not null unique, -- lowercase text the merchant/name must contain
  kind text not null check (kind in ('spend', 'transfer', 'income')),
  category text,
  subcategory text,
  created_at timestamptz not null default now()
);

create table public.transaction_splits (
  id bigint generated always as identity primary key,
  transaction_id text not null references public.transactions (id) on delete cascade,
  category text not null,
  subcategory text,
  amount numeric(12, 2) not null,
  sort integer not null default 0
);
create index transaction_splits_txn_idx on public.transaction_splits (transaction_id);

create table public.owed (
  id bigint generated always as identity primary key,
  transaction_id text not null references public.transactions (id) on delete cascade,
  person text not null,
  amount numeric(12, 2) not null,
  status text not null default 'waiting' check (status in ('waiting', 'paid', 'gone')),
  sort integer not null default 0,
  created_at timestamptz not null default now()
);
create index owed_txn_idx on public.owed (transaction_id);

-- ---- Access: the owner reads, the server writes, nobody else sees anything ----

do $$
declare t text;
begin
  foreach t in array array['accounts', 'balance_snapshots', 'holdings', 'investment_transactions', 'manual_cost', 'categories',
    'subcategories', 'transactions', 'category_rules', 'transaction_splits', 'owed'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy "owner reads %s" on public.%I for select to authenticated using ((select private.is_owner()))', t, t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('grant all on public.%I to service_role', t);
  end loop;
end $$;

-- Plaid logins hold access tokens: server only.
alter table public.plaid_items enable row level security;
revoke all on public.plaid_items from anon, authenticated;
grant all on public.plaid_items to service_role;

-- ---- Starting categories (rename or replace them on the Spending page) ----

insert into public.categories (name, color, sort) values
  ('Housing & living', 'g1', 1), ('Groceries', 'g2', 2), ('Dining', 'g3', 3), ('Getting around', 'g7', 4),
  ('Shopping', 'g5', 5), ('Subscriptions', 'g4', 6), ('Health & fitness', 'g10', 7), ('Fun', 'g6', 8),
  ('Travel', 'g8', 9), ('Gifts & giving', 'g9', 10), ('Fees & services', 'g11', 11), ('Other', 'g11', 12);

insert into public.subcategories (category, name, sort)
select c, s, ord from (values
  ('Housing & living', array['Rent', 'Utilities', 'Internet', 'Renters insurance']),
  ('Dining', array['Restaurants', 'Delivery', 'Coffee']),
  ('Getting around', array['Metro & transit', 'Rideshare', 'Gas', 'Parking', 'Car', 'Car insurance']),
  ('Shopping', array['Household', 'Personal care', 'Clothes', 'Other']),
  ('Subscriptions', array['Streaming', 'Software & apps']),
  ('Health & fitness', array['Gym', 'Medical & pharmacy']),
  ('Fun', array['Events & tickets', 'Movies', 'Sports', 'Games', 'Books']),
  ('Travel', array['Flights', 'Lodging', 'Travel insurance']),
  ('Fees & services', array['Fees & taxes', 'Services'])
) v(c, subs), unnest(subs) with ordinality as u(s, ord);
