import { createApp } from './app';
import { config, validateConfig } from './config/env';
import { checkSupabaseConnection } from './db/client';

validateConfig();

const app = createApp();

app.listen(config.port, async () => {
  console.log(`[Server] LINE Expense Bot server listening on port ${config.port}`);
  console.log(`[Server] Webhook endpoint active at POST /webhook`);
  console.log(`[Server] Health check endpoint active at GET /health`);

  // Non-blocking connection check on startup
  try {
    const dbStatus = await checkSupabaseConnection();
    if (dbStatus.ok) {
      console.log(`[Supabase] ${dbStatus.message}`);
    } else {
      console.warn(`[Supabase Warning] ${dbStatus.message}`);
    }
  } catch (err) {
    console.warn('[Supabase Warning] Unexpected error during connection check:', err);
  }
});
