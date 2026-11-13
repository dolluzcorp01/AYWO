// POST /rpc/<name> {args}. Calls a listed database function as the signed-in person.
import type { FastifyInstance } from 'fastify';
import { optionalUser } from '../auth-tokens.ts';
import { asCaller } from '../db.ts';
import { ApiError } from '../errors.ts';
import { adminRpc } from '../rpc/admin.ts';
import { coreRpc } from '../rpc/core.ts';
import { opsRpc } from '../rpc/ops.ts';
import { paymentsRpc } from '../rpc/payments.ts';
import { socialRpc } from '../rpc/social.ts';
import { treeEditRpc } from '../rpc/tree-edit.ts';
import type { RpcList } from '../rpc/types.ts';

const ALLOWED: RpcList = { ...coreRpc, ...treeEditRpc, ...paymentsRpc, ...adminRpc, ...socialRpc, ...opsRpc };

export async function rpcRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Params: { name: string }; Body: Record<string, unknown> | null }>('/rpc/:name', async (req) => {
    const entry = Object.prototype.hasOwnProperty.call(ALLOWED, req.params.name) ? ALLOWED[req.params.name] : undefined;
    if (!entry) throw new ApiError(404, 'not_found');

    const userId = await optionalUser(req);
    if (!userId && !entry.anonymous) throw new ApiError(401, 'not_signed_in');

    const input = req.body ?? {};
    const names = Object.keys(input);
    for (const name of names) {
      if (!entry.args.includes(name)) throw new ApiError(422, 'bad_input');
    }
    const params = names.map((n) => {
      const v = input[n];
      if (entry.arrays?.includes(n) && v !== null) {
        if (!Array.isArray(v) || v.length > 200 || !v.every((x) => typeof x === 'string')) throw new ApiError(422, 'bad_input');
        return v;
      }
      return v !== null && typeof v === 'object' ? JSON.stringify(v) : v;
    });
    // Both the function name and the argument names were checked against the list above.
    const call = `public.${req.params.name}(${names.map((n, i) => `${n} => $${i + 1}`).join(', ')})`;

    return asCaller(userId, async (db) => {
      if (entry.rows) {
        const { rows } = await db.query(`select * from ${call}`, params);
        return rows;
      }
      const { rows } = await db.query(`select ${call} as result`, params);
      return rows[0].result ?? null;
    });
  });
}
