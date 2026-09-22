import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { config } from '../config/env';

let supabaseClient: SupabaseClient | null = null;

export function getSupabaseClient(): SupabaseClient {
  if (!supabaseClient) {
    if (!config.supabase.url || !config.supabase.serviceKey) {
      throw new Error('Supabase credentials (SUPABASE_URL, SUPABASE_SERVICE_KEY) are not set.');
    }
    supabaseClient = createClient(config.supabase.url, config.supabase.serviceKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false
      }
    });
  }
  return supabaseClient;
}

/**
 * Checks connectivity to Supabase.
 * Note: Supabase Free Tier projects automatically pause after 7 days of inactivity.
 * If paused, requests will fail until resumed from the Supabase web dashboard.
 */
export async function checkSupabaseConnection(): Promise<{ ok: boolean; message: string }> {
  try {
    if (!config.supabase.url || !config.supabase.serviceKey) {
      return {
        ok: false,
        message: 'SUPABASE_URL or SUPABASE_SERVICE_KEY is missing in environment variables.'
      };
    }

    const client = getSupabaseClient();
    // Simple lightweight query to check connectivity
    const { error } = await client.from('users').select('line_user_id').limit(1);

    if (error) {
      return {
        ok: false,
        message: `Supabase connection query failed: ${error.message} (Note: If project was inactive > 7 days, check if it was paused in Supabase Dashboard)`
      };
    }

    return {
      ok: true,
      message: 'Supabase connected successfully.'
    };
  } catch (err: any) {
    return {
      ok: false,
      message: `Supabase connection error: ${err.message || err}`
    };
  }
}
