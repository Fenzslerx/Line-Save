-- ====================================================================
-- Migration: 002_fix_summary_date_filter.sql
-- Description: Fixes operator precedence in get_summary_by_category.
--              The old WHERE clause was:
--                (group match) or (user match) and (start date) and (end date)
--              In SQL, AND binds tighter than OR, so the date filters only
--              applied to the personal branch — group summaries ignored the
--              date range and returned all-time totals.
--
--              Run this once on databases that already applied 001_init.sql
--              (Supabase SQL Editor -> paste -> Run). Safe to run repeatedly.
-- ====================================================================

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
