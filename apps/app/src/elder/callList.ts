// Who an elder can call from the simple Home: living family with a phone or WhatsApp number on file.
// The server decides whether the number itself can be seen (AYWO Plus, the Creator's OK); a locked number still
// shows the person, and the tap goes to their card, which explains how to unlock it.
import { contactActions } from '@aywo/shared';
import type { ContactsAnswer } from '@aywo/shared';

export interface CallNode {
  id: string;
  name: string;
  nameUnknown?: boolean;
  living: string;
  photoUrl?: string | null;
}

export interface CallPerson {
  id: string;
  name: string;
  photoUrl: string | null;
  /** 'tel:' link, or null when the number is there but locked. */
  call: string | null;
  /** 'https://wa.me/' link, or null. */
  whatsapp: string | null;
  locked: boolean;
}

export function callList(nodes: CallNode[], contacts: Record<string, ContactsAnswer> | undefined, viewerId: string | null): CallPerson[] {
  const out: CallPerson[] = [];
  for (const node of nodes) {
    if (node.id === viewerId || node.living === 'deceased' || node.nameUnknown) continue;
    const actions = contactActions(contacts?.[node.id]).filter((a) => a.kind === 'mobile' || a.kind === 'whatsapp');
    if (actions.length === 0) continue;
    const call = actions.find((a) => a.kind === 'mobile')?.url ?? null;
    const whatsapp = actions.find((a) => a.kind === 'whatsapp')?.url ?? null;
    out.push({ id: node.id, name: node.name, photoUrl: node.photoUrl ?? null, call, whatsapp, locked: !call && !whatsapp });
  }
  // People who can be called right away come first, then by name.
  return out.sort((a, b) => Number(a.locked) - Number(b.locked) || a.name.localeCompare(b.name));
}
