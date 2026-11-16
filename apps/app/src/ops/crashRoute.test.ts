import { describe, expect, it } from 'vitest';
import { safeRoute } from './crashRoute';

describe('safeRoute', () => {
  const token = 'Zk3pQ9xLm2Vt7Rw1Yb8Nc4Hd6Fg0JsAa';

  it('hides share, invite and group-join tokens', () => {
    expect(safeRoute(`/invite/${token}`)).toBe('/invite/:token');
    expect(safeRoute(`/link/${token}`)).toBe('/link/:token');
    expect(safeRoute(`/social/groups/join/${token}`)).toBe('/social/groups/join/:token');
    expect(safeRoute('/social/sos/watch/short1')).toBe('/social/sos/watch/:token');
  });
  it('hides a long random part wherever it sits, and drops the query', () => {
    expect(safeRoute(`/somewhere/${token}/more?code=123456`)).toBe('/somewhere/:token/more');
    expect(safeRoute('/otp?phone=%2B919800000002')).toBe('/otp');
  });
  it('keeps ordinary screens and ids', () => {
    expect(safeRoute('/home')).toBe('/home');
    expect(safeRoute('/tree/0b0e6a0e-1c1d-4e2f-9a3b-5c6d7e8f9a0b')).toBe('/tree/0b0e6a0e-1c1d-4e2f-9a3b-5c6d7e8f9a0b');
    expect(safeRoute('/settings/notifications')).toBe('/settings/notifications');
    expect(safeRoute('')).toBe('');
  });
});
