import { describe, expect, it } from 'vitest';
import { ApiError, toHttpError } from '../errors';

describe('toHttpError', () => {
  it('passes our own errors and database PT codes through', () => {
    expect(toHttpError(new ApiError(403, 'not_allowed'))).toEqual({ status: 403, code: 'not_allowed' });
    expect(toHttpError({ code: 'PT409', message: 'version_conflict' })).toEqual({ status: 409, code: 'version_conflict' });
  });

  it('answers 4xx for a request Fastify itself refused, such as broken JSON', () => {
    expect(toHttpError({ code: 'FST_ERR_CTP_INVALID_JSON_BODY', statusCode: 400 })).toEqual({ status: 400, code: 'bad_input' });
    expect(toHttpError({ code: 'FST_ERR_CTP_BODY_TOO_LARGE', statusCode: 413 })).toEqual({ status: 413, code: 'bad_input' });
  });

  it('still treats anything unknown as a server error', () => {
    expect(toHttpError(new Error('boom'))).toBeNull();
    expect(toHttpError({ code: 'FST_ERR_SOMETHING', statusCode: 500 })).toBeNull();
    expect(toHttpError({ code: '57014', message: 'canceling statement' })).toBeNull();
  });
});
