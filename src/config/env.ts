import dotenv from 'dotenv';

dotenv.config();

export const config = {
  port: parseInt(process.env.PORT || '3000', 10),
  line: {
    channelSecret: process.env.LINE_CHANNEL_SECRET || '',
    channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN || ''
  },
  gemini: {
    apiKey: process.env.GEMINI_API_KEY || '',
    model: process.env.GEMINI_MODEL || 'gemini-3.6-flash'
  },
  liffId: process.env.LIFF_ID || '',
  adminKey: process.env.ADMIN_KEY || ''
};

/**
 * (Re)initialise config from a Cloudflare Workers env binding.
 * Must be called before handling each request in src/worker.ts so that
 * module-level clients (LINE, Gemini) see the bound secrets.
 */
export function initConfig(env: Record<string, string | undefined>) {
  config.line.channelSecret = env.LINE_CHANNEL_SECRET || '';
  config.line.channelAccessToken = env.LINE_CHANNEL_ACCESS_TOKEN || '';
  config.gemini.apiKey = env.GEMINI_API_KEY || '';
  config.gemini.model = env.GEMINI_MODEL || process.env.GEMINI_MODEL || 'gemini-3.6-flash';
  config.liffId = env.LIFF_ID || '';
  config.adminKey = env.ADMIN_KEY || '';
}

export function validateConfig() {
  const missing: string[] = [];
  if (!config.line.channelSecret) missing.push('LINE_CHANNEL_SECRET');
  if (!config.line.channelAccessToken) missing.push('LINE_CHANNEL_ACCESS_TOKEN');

  if (missing.length > 0) {
    console.warn(`[Config Warning] Missing environment variables: ${missing.join(', ')}`);
  }
}
