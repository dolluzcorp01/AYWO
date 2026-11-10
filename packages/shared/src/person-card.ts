// What the person card shows for contact details (wireframes D1, D2, D3). The server decides; this only draws its answer.

export type ContactKind = 'mobile' | 'whatsapp' | 'email';

/** Why the card looks the way it does. 'ask': needs the Creator's OK. 'plus': OK given, needs AYWO Plus. */
export type ContactAccess = 'self' | 'open' | 'plus' | 'ask' | 'none';

export interface ContactsAnswer {
  values?: { kind: ContactKind; value: string; link_value: string }[];
  has_mobile?: boolean;
  has_whatsapp?: boolean;
  has_email?: boolean;
}

export interface ContactAction {
  kind: ContactKind;
  url: string | null;
}

/** Opens the dialler, WhatsApp or mail (T-CON-02). Everything is cleaned, so stored text cannot become another kind of link. */
export function contactUrl(kind: ContactKind, value: string): string | null {
  if (kind === 'email') {
    if (!/^[^\s@]+@[^\s@]+$/.test(value)) return null;
    return `mailto:${encodeURIComponent(value).replace('%40', '@')}`;
  }
  const digits = value.replace(/\D/g, '');
  if (digits.length < 5) return null;
  return kind === 'mobile' ? `tel:+${digits}` : `https://wa.me/${digits}`;
}

const ORDER: ContactKind[] = ['mobile', 'whatsapp', 'email'];

/** The buttons, in the wireframe's order. With values they open; without, they show what exists, greyed out. */
export function contactActions(answer: ContactsAnswer | null | undefined): ContactAction[] {
  if (!answer) return [];
  const values = answer.values;
  if (values) {
    const out: ContactAction[] = [];
    for (const kind of ORDER) {
      const found = values.find((v) => v.kind === kind);
      if (found) out.push({ kind, url: contactUrl(kind, found.link_value) });
    }
    return out;
  }
  const has: Record<ContactKind, boolean | undefined> = {
    mobile: answer.has_mobile,
    whatsapp: answer.has_whatsapp,
    email: answer.has_email,
  };
  return ORDER.filter((kind) => has[kind]).map((kind) => ({ kind, url: null }));
}
