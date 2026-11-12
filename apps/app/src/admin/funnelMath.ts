// Plain arithmetic for the signup funnel view, kept apart from React Native so it can be tested.

/** Share of the first step, as a whole percent. */
export function share(part: number, whole: number): number {
  return whole > 0 ? Math.round((100 * part) / whole) : 0;
}

/** The step where the most people are lost (largest drop from the step before), or null with no drop. */
export function biggestDrop(counts: number[]): number | null {
  let at: number | null = null;
  let worst = 0;
  for (let i = 1; i < counts.length; i++) {
    const lost = counts[i - 1] - counts[i];
    if (lost > worst) {
      worst = lost;
      at = i;
    }
  }
  return at;
}
