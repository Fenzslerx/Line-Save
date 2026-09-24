import { createApp } from './app';
import { config, validateConfig } from './config/env';
import { checkDatabaseConnection } from './db/client';

validateConfig();

const app = createApp();

app.listen(config.port, async () => {
  console.log(`[Server] LINE Expense Bot server listening on port ${config.port}`);
  console.log(`[Server] Webhook endpoint active at POST /webhook`);
  console.log(`[Server] Health check endpoint active at GET /health`);

  // Non-blocking connection check on startup
  try {
    const dbStatus = await checkDatabaseConnection();
    if (dbStatus.ok) {
      console.log(`[D1] ${dbStatus.message}`);
    } else {
      console.warn(`[D1 Warning] ${dbStatus.message}`);
    }
  } catch (err) {
    console.warn('[D1 Warning] Unexpected error during connection check:', err);
  }
});
