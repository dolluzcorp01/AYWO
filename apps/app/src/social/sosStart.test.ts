import { afterEach, describe, expect, it, vi } from 'vitest';
import { armSosStart, takeSosStart } from './sosStart';

afterEach(() => {
  vi.useRealTimers();
  takeSosStart();
});

describe('starting an SOS from the hold on Home', () => {
  it('does nothing unless the bar was held', () => {
    expect(takeSosStart()).toBe(false);
  });

  it('starts once: opening the screen again (reload, back button) does not start another', () => {
    armSosStart();
    expect(takeSosStart()).toBe(true);
    expect(takeSosStart()).toBe(false);
  });

  it('is forgotten if the SOS screen did not open soon after the hold', () => {
    vi.useFakeTimers();
    armSosStart();
    vi.advanceTimersByTime(60_000);
    expect(takeSosStart()).toBe(false);
  });
});
