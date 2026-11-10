import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import websocket from '@fastify/websocket';
import Fastify from 'fastify';
import type { FastifyRequest } from 'fastify';
import { ZodError } from 'zod';
import { config, isProduction } from './config.ts';
import { safeError, toHttpError } from './errors.ts';
import { startJobs } from './jobs.ts';
import { adminRoutes } from './routes/admin.ts';
import { authRoutes } from './routes/auth.ts';
import { opsRoutes } from './routes/ops.ts';
import { paymentRoutes } from './routes/payments.ts';
import { rpcRoutes } from './routes/rpc.ts';
import { socialRoutes } from './routes/social.ts';
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
    return reply.status(500).send({ code: 'server_error', message_key: 'errors.server_error' });
  });

  app.get('/health', async () => ({ ok: true }));

  await app.register(authRoutes);
  await app.register(rpcRoutes);
  await app.register(treeViewRoutes);
  await app.register(uploadRoutes);
  await app.register(treeEditRoutes);
  await app.register(paymentRoutes);
  await app.register(adminRoutes);
  await app.register(socialRoutes);
  await app.register(opsRoutes);
  return app;
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop() ?? '')) {
  const app = await buildServer();
  startJobs(app.log);
  await app.listen({ port: config.PORT, host: '0.0.0.0' });
}
