import express, { Application, Request, Response } from 'express';
import { webhookHandler } from './handlers/webhook';

export function createApp(): Application {
  const app = express();

  // Parse JSON and preserve raw body for LINE signature verification
  app.use(
    express.json({
      verify: (req: Request, _res: Response, buf: Buffer) => {
        (req as any).rawBody = buf;
      }
    })
  );

  // Healthcheck endpoint
  app.get('/health', (_req: Request, res: Response) => {
    res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  // LINE Webhook endpoint
  app.post('/webhook', webhookHandler);

  return app;
}
