// What a crash report may say about where it happened. Some addresses carry a secret: a family share link, an invite,
// a group-join or SOS-watch link. Whoever holds that part can open the link, so it never leaves the device.
// No app imports, so it can be tested on its own.

// The part after each of these is a secret token.
const SECRET_AFTER = new Set(['invite', 'link', 'join', 'watch', 'outsider', 'view-by-link']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Anything else long and random-looking is treated as a token too. Ids (uuids) are not secrets and help find the bug.
const LOOKS_SECRET = /^[A-Za-z0-9_-]{20,}$/;

/** '/invite/AbC...xyz?x=1' becomes '/invite/:token'. The query and fragment are dropped: they can carry codes too. */
export function safeRoute(route: string): string {
  const path = route.split(/[?#]/)[0] ?? '';
  const parts = path.split('/');
  const out = parts.map((part, i) => {
    if (!part) return part;
    if (SECRET_AFTER.has(parts[i - 1] ?? '')) return ':token';
    if (!UUID.test(part) && LOOKS_SECRET.test(part)) return ':token';
    return part;
  });
  return out.join('/').slice(0, 200);
}
