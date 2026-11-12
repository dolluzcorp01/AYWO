// API errors that were not the caller's fault (HTTP 500), kept 30 days for Admin, App health. Never the request body,
// the full URL or a person: only the route pattern, the method and a short message with numbers and emails blanked,
// because database errors can quote a value (for example "Key (phone)=(+91...)").
import { asServer } from '../db.ts';
import { fingerprint, scrubMessage } from './errorText.ts';

/** Fire and forget: recording an error must never cause another one. */
export function recordServerError(method: string, route: string, error: unknown): void {
  const err = error as { name?: string; message?: string };
  const message = scrubMessage(`${err?.name ?? 'Error'}: ${err?.message ?? String(error)}`);
  void asServer((db) =>
    db.query(`insert into server_errors (route, method, message, fingerprint) values ($1, $2, $3, $4)`, [
      route.slice(0, 200),
      method.slice(0, 10),
      message,
      fingerprint(method, route, message),
    ]),
  ).catch(() => undefined);
}
