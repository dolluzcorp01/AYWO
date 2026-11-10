// LLD L5 error shape: {code, message_key}. message_key is an i18n key, so the app shows it in the user's language.

export class ApiError extends Error {
  status: number;
  constructor(status: number, code: string) {
    super(code);
    this.status = status;
  }
}

/**
 * What may go in a log. A Postgres error's detail field quotes the row ('Failing row contains ...'), which can hold a
 * phone number or a contact value, so an error object is never logged whole.
 */
export function safeError(e: unknown): { code?: unknown; message?: unknown; stack?: unknown } {
  const err = e as { code?: unknown; message?: unknown; stack?: unknown };
  return { code: err?.code, message: err?.message, stack: err?.stack };
}

/** Database functions raise SQLSTATE PTnnn, where nnn is the HTTP status (for example PT403, PT409, PT422). */
export function toHttpError(e: unknown): { status: number; code: string } | null {
  if (e instanceof ApiError) return { status: e.status, code: e.message };
  const err = e as { code?: unknown; message?: unknown; validation?: unknown; statusCode?: unknown };
  if (err.validation) return { status: 422, code: 'bad_input' };
  if (err.statusCode === 429) return { status: 429, code: 'too_many_requests' };
  if (typeof err.code !== 'string') return null;
  const custom = err.code.match(/^PT(\d{3})$/);
  if (custom) return { status: Number(custom[1]), code: String(err.message) };
  if (err.code === '42501') return { status: 403, code: 'not_allowed' };
  if (err.code === '23505') return { status: 409, code: 'already_exists' };
  if (err.code === '23503' || err.code === '22P02' || err.code === '23514') return { status: 422, code: 'bad_input' };
  return null;
}
