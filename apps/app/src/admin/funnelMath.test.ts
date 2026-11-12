import { describe, expect, it } from 'vitest';
import { biggestDrop, share } from './funnelMath';

describe('share', () => {
  it('is a whole percent of the first step', () => {
    expect(share(1, 3)).toBe(33);
    expect(share(0, 0)).toBe(0);
  });
});

describe('biggestDrop', () => {
  it('finds the step where the most people stop', () => {
    expect(biggestDrop([100, 90, 40, 35, 30])).toBe(2);
  });
  it('is null when nobody is lost', () => {
    expect(biggestDrop([5, 5, 5])).toBeNull();
    expect(biggestDrop([])).toBeNull();
  });
});
