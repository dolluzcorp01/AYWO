// POST /track: the app's anonymous step notes for the signup funnel (0017). No login needed: most steps happen
// before there is an account. Nothing personal is accepted, only a random device id, the step, the platform and the
// language. Each device can send each step once; the database ignores repeats. Always answers 204 so the app never waits.
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { asServer } from '../db.ts';

const STEPS = ['app_opened', 'code_requested', 'code_verified', 'name_saved', 'tree_started', 'first_relative', 'five_people', 'invite_sent'] as const;

const body = z.object({
  device: z.string().uuid(),
  event: z.enum(STEPS),
  platform: z.enum(['web', 'ios', 'android']),
  lang: z.string().regex(/^[A-Za-z]{2,3}([-_][A-Za-z0-9]{2,8})?$/),
});

export async function trackRoutes(app: FastifyInstance): Promise<void> {
  // A real device sends at most 8 notes ever; 30 a minute from one address leaves room for a family on one Wi-Fi.
  app.post('/track', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (req, reply) => {
    const note = body.parse(req.body);
    await asServer((db) => db.query('select track_event($1, $2, $3, $4)', [note.device, note.event, note.platform, note.lang]));
    return reply.code(204).send();
  });
}
