-- ====================================================================
-- Migration: 001_init.sql
-- Description: Core Schema for LINE Expense Bot (Users, Groups, Transactions)
--              Includes RLS policies (service_role only) and summary functions
-- ====================================================================

-- 1. Create Users Table
create table if not exists users (
  line_user_id text primary key,
  nickname text,
  created_at timestamptz not null default now()
);

-- 2. Create Groups Table
create table if not exists groups (
  line_group_id text primary key,
  group_name text,
  created_at timestamptz not null default now()
);

-- 3. Create Transactions Table
create table if not exists transactions (
  id uuid primary key default gen_random_uuid(),
  line_user_id text references users(line_user_id) not null,
  line_group_id text references groups(line_group_id), -- null when individual
  amount numeric not null,
  type text check (type in ('income', 'expense')) not null,
  category text,
  merchant text,
  date date not null,
  note text,
  slip_image_url text,
  created_at timestamptz not null default now()
);

-- 4. Indexes for fast aggregation & lookup
create index if not exists idx_transactions_group_date on transactions(line_group_id, date);
create index if not exists idx_transactions_user_date on transactions(line_user_id, date);

-- 5. Row Level Security (RLS)
-- Deny public / anon / authenticated access directly; permit only service_role (backend server)
alter table users enable row level security;
alter table groups enable row level security;
alter table transactions enable row level security;

-- Policy: Restrict direct client-side access, backend uses service_role key
create policy "Allow service_role full access to users"
  on users
  for all
  to service_role
  using (true)
  with check (true);

create policy "Allow service_role full access to groups"
  on groups
  for all
  to service_role
  using (true)
  with check (true);

create policy "Allow service_role full access to transactions"
  on transactions
  for all
  to service_role
  using (true)
  with check (true);

-- 6. Helper Function: Summary by Category & Type
-- Returns total amount grouped by category and type for a given date range
create or replace function get_summary_by_category(
  p_user_id text default null,
  p_group_id text default null,
  p_start_date date default null,
  p_end_date date default null
)
returns table (
  category text,
  type text,
  total_amount numeric,
  transaction_count bigint
)
language sql
security definer
as $$
  select
    coalesce(t.category, 'ไม่ระบุ') as category,
    t.type,
    sum(t.amount) as total_amount,
    count(t.id) as transaction_count
  from transactions t
  where
    -- Parentheses are required: "a or b and c and d" evaluates as "a or (b and c and d)",
    -- which would drop the date filters from the group branch entirely.
    (
      (p_group_id is not null and t.line_group_id = p_group_id)
      or
      (p_group_id is null and p_user_id is not null and t.line_user_id = p_user_id and t.line_group_id is null)
    )
    and (p_start_date is null or t.date >= p_start_date)
    and (p_end_date is null or t.date <= p_end_date)
  group by coalesce(t.category, 'ไม่ระบุ'), t.type
  order by total_amount desc;
$$;

-- 7. Helper Function: Group Member Summary
-- Returns total expenditure breakdown per member in a group
create or replace function get_group_member_summary(
  p_group_id text,
  p_start_date date default null,
  p_end_date date default null
)
returns table (
  line_user_id text,
  nickname text,
  total_paid numeric,
  transaction_count bigint
)
language sql
security definer
as $$
  select
    t.line_user_id,
    coalesce(u.nickname, 'สมาชิก') as nickname,
    sum(t.amount) as total_paid,
    count(t.id) as transaction_count
  from transactions t
  left join users u on t.line_user_id = u.line_user_id
  where
    t.line_group_id = p_group_id
    and t.type = 'expense'
    and (p_start_date is null or t.date >= p_start_date)
    and (p_end_date is null or t.date <= p_end_date)
  group by t.line_user_id, coalesce(u.nickname, 'สมาชิก')
  order by total_paid desc;
$$;
