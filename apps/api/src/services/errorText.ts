// Making a server error safe to keep: numbers, emails and ids blanked, and a fingerprint to group repeats.
import { createHash } from 'node:crypto';

export function scrubMessage(message: string): string {
  return message
    .replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, '<email>')
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '<id>')
    .replace(/\+?\d[\d\s-]{5,}\d/g, '<number>')
    .slice(0, 300);
}

export function fingerprint(method: string, route: string, message: string): string {
  return createHash('sha256').update(`${method} ${route} ${message.replace(/\d+/g, '#')}`).digest('hex').slice(0, 16);
}
