import { SupabaseClient } from '@supabase/supabase-js';

export interface UserRecord {
  line_user_id: string;
  nickname?: string;
  created_at?: string;
}

export interface GroupRecord {
  line_group_id: string;
  group_name?: string;
  created_at?: string;
}

export interface TransactionRecord {
  id?: string;
  line_user_id: string;
  line_group_id?: string | null;
  amount: number;
  type: 'income' | 'expense';
  category?: string | null;
  merchant?: string | null;
  date: string; // YYYY-MM-DD
  note?: string | null;
  slip_image_url?: string | null;
  created_at?: string;
}

export interface CategorySummary {
  category: string;
  type: 'income' | 'expense';
  total_amount: number;
  transaction_count: number;
}

export interface MemberSummary {
  line_user_id: string;
  nickname: string;
  total_paid: number;
  transaction_count: number;
}

/**
 * Register or update user nickname
 */
export async function upsertUser(
  client: SupabaseClient,
  user: UserRecord
): Promise<UserRecord> {
  const { data, error } = await client
    .from('users')
    .upsert({ line_user_id: user.line_user_id, nickname: user.nickname })
    .select()
    .single();

  if (error) throw error;
  return data;
}

/**
 * Register or update group name
 */
export async function upsertGroup(
  client: SupabaseClient,
  group: GroupRecord
): Promise<GroupRecord> {
  const { data, error } = await client
    .from('groups')
    .upsert({ line_group_id: group.line_group_id, group_name: group.group_name })
    .select()
    .single();

  if (error) throw error;
  return data;
}

/**
 * Insert a new financial transaction
 */
export async function createTransaction(
  client: SupabaseClient,
  transaction: TransactionRecord
): Promise<TransactionRecord> {
  const { data, error } = await client
    .from('transactions')
    .insert(transaction)
    .select()
    .single();

  if (error) throw error;
  return data;
}

/**
 * Get category-based summary for a user or group over a date range
 */
export async function getCategorySummary(
  client: SupabaseClient,
  options: {
    userId?: string;
    groupId?: string;
    startDate?: string;
    endDate?: string;
  }
): Promise<CategorySummary[]> {
  // Uses PostgreSQL RPC helper defined in 001_init.sql
  const { data, error } = await client.rpc('get_summary_by_category', {
    p_user_id: options.userId || null,
    p_group_id: options.groupId || null,
    p_start_date: options.startDate || null,
    p_end_date: options.endDate || null
  });

  if (error) throw error;
  return data || [];
}

/**
 * Get expense summary broken down by group members
 */
export async function getGroupMemberSummary(
  client: SupabaseClient,
  options: {
    groupId: string;
    startDate?: string;
    endDate?: string;
  }
): Promise<MemberSummary[]> {
  // Uses PostgreSQL RPC helper defined in 001_init.sql
  const { data, error } = await client.rpc('get_group_member_summary', {
    p_group_id: options.groupId,
    p_start_date: options.startDate || null,
    p_end_date: options.endDate || null
  });

  if (error) throw error;
  return data || [];
}
