// The one place to fill in before going live. Every XXX is shown on the public pages until it is replaced here.
// pnpm legal:check fails while any XXX is left, or while LEGAL_DRAFT is still true. Full list: docs/GO-LIVE-PLACEHOLDERS.md.
// Kept out of the words so a translation cannot change them.
export const PUBLISHER = {
  company: 'XXX',
  cin: 'XXX',
  gstin: 'XXX',
  address: 'XXX',
  email: 'XXX',
  phone: 'XXX',
  supportHours: 'XXX',
  website: 'aywo.in',
  grievanceOfficer: 'XXX',
  grievanceEmail: 'XXX',
  courtCity: 'XXX',
  deliveryDays: 'XXX',
  // Draft policy numbers: confirm or change them at the final review.
  refundDays: '7',
  damageDays: '7',
  refundWorkingDays: '7',
};

/** Shows the "draft" notice on these pages. Set to false once the lawyer has reviewed them. */
export const LEGAL_DRAFT = true;

/** Recorded with each person's consent. Change it when the Terms or Privacy policy change. */
export const LEGAL_VERSION = '2026-11';
