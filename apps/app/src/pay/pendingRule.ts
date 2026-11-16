// The rule for a remembered Plus purchase (see pending.ts). No app imports, so it can be tested on its own.

export const PENDING_MS = 30 * 60_000;

/** Pure, so it can be tested: when the saved purchase started, or null when there is none that still counts. */
export function pendingSince(saved: string | null, profileId: string, now: number): number | null {
  if (!saved) return null;
  try {
    const value = JSON.parse(saved) as { at?: unknown; profile?: unknown };
    if (typeof value.at !== 'number' || value.profile !== profileId) return null;
    return value.at <= now && now - value.at < PENDING_MS ? value.at : null;
  } catch {
    return null;
  }
}
