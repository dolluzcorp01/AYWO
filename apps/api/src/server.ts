import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import websocket from '@fastify/websocket';
import Fastify from 'fastify';
import type { FastifyRequest } from 'fastify';
import { ZodError } from 'zod';
import { backupKey, config, isProduction } from './config.ts';
import { asServer } from './db.ts';
import { safeError, toHttpError } from './errors.ts';
import { startJobs } from './jobs.ts';
import { adminRoutes } from './routes/admin.ts';
import { authRoutes } from './routes/auth.ts';
import { linkPageRoutes } from './routes/link-page.ts';
import { opsRoutes } from './routes/ops.ts';
import { paymentRoutes } from './routes/payments.ts';
import { rpcRoutes } from './routes/rpc.ts';
import { socialRoutes } from './routes/social.ts';
import { trackRoutes } from './routes/track.ts';
import { recordServerError } from './services/serverErrors.ts';
import { treeEditRoutes } from './routes/tree-edit.ts';
import { treeViewRoutes } from './routes/tree-view.ts';
import { uploadRoutes } from './routes/uploads.ts';

/** Who a rate limit counts: the address the platform's proxy vouches for, otherwise the connection itself. */
function clientKey(req: FastifyRequest): string {
  const vouched = config.CLIENT_IP_HEADER ? req.headers[config.CLIENT_IP_HEADER.toLowerCase()] : undefined;
  return typeof vouched === 'string' && vouched.length > 0 ? vouched : req.ip;
}

export async function buildServer() {
  // No trustProxy: it believes the leftmost X-Forwarded-For, which the visitor writes, so a new made-up address per
  // request escaped every limit, OTP guessing included. See clientKey.
  const app = Fastify({
    logger: {
      serializers: {
        // A link token in the address is a key, and a query can hold a name or a phone number searched for. Neither is logged.
        req: (req: { method: string; url: string }) => ({
          method: req.method,
          url: req.url.split('?')[0].replace(/^\/(sos\/live|view-by-link)\/[^/]+/, '/$1/[token]'),
        }),
      },
    },
    bodyLimit: 2_000_000,
  });

  await app.register(helmet, { contentSecurityPolicy: false });
  await app.register(cors, {
    origin: isProduction ? [config.WEB_URL] : true,
    methods: ['GET', 'HEAD', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    // The admin web app's second sign-in step travels in its own header.
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Staff-Proof'],
  });
  await app.register(rateLimit, { max: 300, timeWindow: '1 minute', keyGenerator: clientKey });
  await app.register(websocket);

  // LLD L5: {code, message_key}. Anything unexpected is logged and never shown to the user.
  app.setErrorHandler((error, req, reply) => {
    if (error instanceof ZodError) return reply.status(422).send({ code: 'bad_input', message_key: 'errors.bad_input' });
    const known = toHttpError(error);
    if (known) return reply.status(known.status).send({ code: known.code, message_key: `errors.${known.code}` });
    req.log.error(safeError(error));
    recordServerError(req.method, req.routeOptions?.url ?? 'unknown', error);
    return reply.status(500).send({ code: 'server_error', message_key: 'errors.server_error' });
  });

  // For DigitalOcean's health check: is the server up. Kept simple, so a database hiccup does not restart the server.
  app.get('/health', async () => ({ ok: true }));

  // For an uptime monitor: can the server reach the database, are jobs failing, how old is the last backup.
  // 503 when the database cannot be reached. Counts only, nothing about anyone.
  app.get('/health/deep', async (_req, reply) => {
    try {
      const facts = await Promise.race([
        asServer(async (db) => {
          const { rows } = await db.query(
            `select (select count(*)::int from job_status where failures_in_row >= 3) as failing_jobs,
                    (select extract(epoch from now() - max(finished_at)) / 3600 from backup_runs where ok) as backup_hours`,
          );
          return rows[0] as { failing_jobs: number; backup_hours: number | null };
        }),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('database timeout')), 3000)),
      ]);
      return {
        ok: facts.failing_jobs === 0,
        db: true,
        failing_jobs: facts.failing_jobs,
        backups: backupKey() ? 'on' : 'off',
        last_backup_hours: facts.backup_hours === null ? null : Math.round(Number(facts.backup_hours) * 10) / 10,
      };
    } catch {
      return reply.status(503).send({ ok: false, db: false });
    }
  });

  await app.register(authRoutes);
  await app.register(rpcRoutes);
  await app.register(treeViewRoutes);
  await app.register(linkPageRoutes);
  await app.register(uploadRoutes);
  await app.register(treeEditRoutes);
  await app.register(paymentRoutes);
  await app.register(adminRoutes);
  await app.register(socialRoutes);
  await app.register(opsRoutes);
  await app.register(trackRoutes);
  return app;
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop() ?? '')) {
  const app = await buildServer();
  startJobs(app.log);
  await app.listen({ port: config.PORT, host: '0.0.0.0' });
}
