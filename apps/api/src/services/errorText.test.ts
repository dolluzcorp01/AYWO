import { describe, expect, it } from 'vitest';
import { fingerprint, scrubMessage } from './errorText';

describe('scrubMessage', () => {
  it('blanks phone numbers, emails and ids that a database error may quote', () => {
    const raw = 'error: duplicate key value violates unique constraint. Key (phone)=(+919812345678) for ravi@x.in, id 3f2b1c4d-1111-4222-8333-444455556666';
    const clean = scrubMessage(raw);
    expect(clean).not.toContain('9812345678');
    expect(clean).not.toContain('ravi@x.in');
    expect(clean).not.toContain('3f2b1c4d');
    expect(clean).toContain('<number>');
    expect(clean).toContain('<email>');
  });
  it('keeps short numbers such as status codes', () => {
    expect(scrubMessage('Error: status 503')).toBe('Error: status 503');
  });
  it('is never longer than 300 characters', () => {
    expect(scrubMessage('x'.repeat(1000)).length).toBe(300);
  });
});

describe('fingerprint', () => {
  it('groups the same error with different numbers together', () => {
    expect(fingerprint('GET', '/trees/:id', 'Error: took 120 ms')).toBe(fingerprint('GET', '/trees/:id', 'Error: took 340 ms'));
    expect(fingerprint('GET', '/trees/:id', 'Error: a')).not.toBe(fingerprint('POST', '/trees/:id', 'Error: a'));
  });
});
