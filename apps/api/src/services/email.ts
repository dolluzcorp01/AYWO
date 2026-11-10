// Words for each notification kind, and SendGrid. The same words feed push and SMS (jobs/delivery.ts).
// Sentences use names, never he or she. Payloads are shown only through the named fields below, so a value that
// should not be in a notification cannot leak through a template.
import sgMail from '@sendgrid/mail';
import { config } from '../config.ts';

export interface NotificationFacts {
  by_name?: string | null;
  person_name?: string | null;
  date?: string | null;
  /** Words the sender wrote: an alert, a chat message, an invite title. */
  note?: string | null;
  /** The heading an AYWO Admin wrote for a system notice. */
  title?: string | null;
  tree_name?: string | null;
  alert_kind?: string | null;
  blood_group?: string | null;
  /** An order's new step: printing, shipped, delivered or cancelled. */
  step?: string | null;
  url: string;
}

export interface NotificationText {
  title: string;
  body: string;
}

type Template = (facts: NotificationFacts) => NotificationText;
type Lang = 'en' | 'ta';

const someone: Record<Lang, string> = { en: 'Someone', ta: 'ஒருவர்' };

const ORDER_STEPS: Record<Lang, Record<string, NotificationText>> = {
  en: {
    printing: { title: 'Your order is being printed', body: 'We have started printing your order. We will tell you when it ships.' },
    shipped: { title: 'Your order is on its way', body: 'Your order has shipped. Open AYWO to track it.' },
    delivered: { title: 'Your order was delivered', body: 'Your order has arrived. We hope your family enjoys it.' },
    cancelled: { title: 'Your order was cancelled', body: 'Your order was cancelled. If you paid, the refund comes to the same account.' },
  },
  ta: {
    printing: { title: 'உங்கள் ஆர்டர் அச்சிடப்படுகிறது', body: 'உங்கள் ஆர்டரை அச்சிடத் தொடங்கியுள்ளோம். அனுப்பியதும் தெரிவிப்போம்.' },
    shipped: { title: 'உங்கள் ஆர்டர் வந்துகொண்டிருக்கிறது', body: 'உங்கள் ஆர்டர் அனுப்பப்பட்டது. கண்காணிக்க AYWO-வைத் திறக்கவும்.' },
    delivered: { title: 'உங்கள் ஆர்டர் வந்து சேர்ந்தது', body: 'உங்கள் ஆர்டர் வந்துவிட்டது. உங்கள் குடும்பம் மகிழும் என நம்புகிறோம்.' },
    cancelled: { title: 'உங்கள் ஆர்டர் ரத்தானது', body: 'உங்கள் ஆர்டர் ரத்து செய்யப்பட்டது. பணம் செலுத்தியிருந்தால் அதே கணக்குக்குத் திரும்பும்.' },
  },
};
const aPerson: Record<Lang, string> = { en: 'a person', ta: 'ஒரு நபர்' };

const ALERT_WORDS: Record<Lang, Record<string, string>> = {
  en: { death: 'Sad news in the family', hospital: 'Someone is in hospital', blood: 'Blood needed urgently', help: 'Help needed', news: 'Family news' },
  ta: { death: 'குடும்பத்தில் துயரச் செய்தி', hospital: 'ஒருவர் மருத்துவமனையில் உள்ளார்', blood: 'அவசரமாக இரத்தம் தேவை', help: 'உதவி தேவை', news: 'குடும்பச் செய்தி' },
};

function alertText(lang: Lang, f: NotificationFacts): NotificationText {
  const title = ALERT_WORDS[lang][f.alert_kind ?? ''] ?? ALERT_WORDS[lang].news;
  const group = f.blood_group ? `${f.blood_group}. ` : '';
  return { title, body: `${f.by_name ?? someone[lang]}: ${group}${f.note ?? ''}`.trim() };
}

const TEMPLATES: Record<Lang, Record<string, Template>> = {
  en: {
    system_notice: (f) => ({ title: f.title ?? 'A notice from AYWO', body: f.note ?? '' }),
    request_routed: () => ({ title: 'A request came to you', body: 'A request in your family tree was waiting too long, so it has come to you. Open AYWO to answer.' }),
    request_expired: () => ({ title: 'Your request has ended', body: 'Your request was not answered in time. You can ask again in AYWO.' }),
    merge_candidate: () => ({ title: 'Same person twice?', body: 'AYWO found two entries in your tree that may be one person. Open AYWO to compare them.' }),
    share_received: (f) => ({ title: 'A family tree was shared with you', body: `${f.by_name ?? someone.en} shared a family tree with you.` }),
    share_revoked: () => ({ title: 'Access ended', body: 'Your access to a family tree has been ended by the person who shared it.' }),
    share_expired: () => ({ title: 'Access ended', body: 'Your access to a shared family tree has reached its end date.' }),
    successor_named: (f) => ({ title: 'You were named successor', body: `${f.by_name ?? someone.en} named you to look after a family tree if they cannot.` }),
    tree_deleted: () => ({ title: 'A family tree was deleted', body: 'A family tree you were part of has been deleted by its Creator.' }),
    tree_passed_to_you: () => ({ title: 'A family tree is now yours to look after', body: 'You are now the Creator of a family tree. Open AYWO to see it.' }),
    kin_term_reviewed: () => ({ title: 'Your word was reviewed', body: 'The word you suggested for a relationship has been reviewed. Open AYWO to see it.' }),
    person_taken_down: () => ({ title: 'An entry was removed', body: 'An entry in your family tree was removed after a request to AYWO.' }),
    alert: (f) => alertText('en', f),
    chat_message: (f) => ({ title: f.by_name ?? 'New message', body: f.note ?? 'Sent you a message.' }),
    chat_added: (f) => ({ title: 'New family chat', body: `${f.by_name ?? someone.en} added you to a chat.` }),
    memory_tag: (f) => ({ title: 'You are in a memory', body: `${f.by_name ?? someone.en} tagged you in a memory.` }),
    memory_collaborator: (f) => ({ title: 'Add to a memory', body: `${f.by_name ?? someone.en} asked you to add to a memory.` }),
    memory_comment: (f) => ({ title: 'New comment on a memory', body: `${f.by_name ?? someone.en} commented on a memory.` }),
    memory_reminder: () => ({ title: 'This day last year', body: 'There is a family memory from this day. Open AYWO to see it again.' }),
    invite: (f) => ({ title: 'You are invited', body: `${f.by_name ?? someone.en} invited you: ${f.note ?? ''}`.trim() }),
    invite_changed: (f) => ({ title: 'An invite changed', body: `The details of ${f.note ?? 'an invite'} have changed.` }),
    invite_cancelled: (f) => ({ title: 'An invite was cancelled', body: `${f.note ?? 'An invite'} has been cancelled.` }),
    rsvp: (f) => ({ title: 'New reply to your invite', body: `${f.by_name ?? someone.en} replied to your invite.` }),
    group_added: (f) => ({ title: 'New group', body: `${f.by_name ?? someone.en} added you to a group.` }),
    sos_ended: (f) => ({ title: 'SOS has ended', body: `${f.by_name ?? someone.en} has stopped the SOS.` }),
    claim_made: (f) => ({ title: 'Someone found their entry', body: `${f.by_name ?? someone.en} says they are ${f.person_name ?? aPerson.en} in your tree. You can undo this if it is wrong.` }),
    claim_undone: (f) => ({ title: 'Your entry was unlinked', body: `Your link to ${f.person_name ?? aPerson.en} was undone by the tree's Creator.` }),
    request_created: () => ({ title: 'A request needs you', body: 'Someone in your family tree is waiting for your decision. Open AYWO to answer.' }),
    request_decided: () => ({ title: 'Your request was answered', body: 'There is an answer to your request. Open AYWO to see it.' }),
    comment_added: (f) => ({ title: 'New comment', body: `${f.by_name ?? someone.en} added a comment on ${f.person_name ?? aPerson.en}.` }),
    trial_ending: (f) => ({ title: 'Your free months end soon', body: `Your AYWO Plus free months end on ${f.date ?? 'soon'}. After that your yearly plan starts, unless you cancel before then.` }),
    plan_trial_started: (f) => ({ title: 'Welcome to AYWO Plus', body: `Your free months have started and run until ${f.date ?? 'the end of the trial'}. You can add up to 5 family members.` }),
    plan_active: () => ({ title: 'AYWO Plus is active', body: 'Your plan is active. You can add up to 5 family members at no cost.' }),
    plan_payment_failed: () => ({ title: 'Your payment did not go through', body: 'We could not renew AYWO Plus. Please check your payment method so your family keeps Plus.' }),
    plan_ended: () => ({ title: 'AYWO Plus has ended', body: 'Your plan has ended. Your tree and all free features stay as they are. You can start Plus again at any time.' }),
    plan_ended_member: (f) => ({ title: 'AYWO Plus has ended', body: `The family plan from ${f.by_name ?? someone.en} has ended. Your tree and all free features stay as they are.` }),
    plan_member_added: (f) => ({ title: 'You now have AYWO Plus', body: `${f.by_name ?? someone.en} added you to their family plan, at no cost to you.` }),
    plan_member_removed: (f) => ({ title: 'Family plan changed', body: `${f.by_name ?? someone.en} removed you from the family plan. Your tree and all free features stay as they are.` }),
    order_paid: () => ({ title: 'Thank you for your order', body: 'Your payment was received. We will let you know when your order is ready.' }),
    order_update: (f) => ORDER_STEPS.en[f.step ?? ''] ?? { title: 'Your order was updated', body: 'Open AYWO to see your order.' },
    order_refunded: () => ({ title: 'Your refund is on its way', body: 'We refunded your order. Banks usually take 5 to 7 working days to show it.' }),
    ticket_reply: (f) => ({ title: 'AYWO Support replied', body: `About: ${f.title ?? 'your question'}. Open AYWO to read the answer.` }),
    report_decided: () => ({ title: 'Thank you for your report', body: 'We looked at what you reported and acted where it broke the AYWO rules.' }),
    plus_gift: (f) => ({ title: 'A gift of AYWO Plus', body: `You have AYWO Plus until ${f.date ?? 'the date shown in the app'}, at no cost.` }),
    referral_reward: () => ({ title: 'You earned 30 days of AYWO Plus', body: 'Thank you for bringing family to AYWO. 30 free days of Plus have been added.' }),
    birthdays_today: (f) => ({ title: 'Birthdays today', body: `Send your wishes to ${f.note ?? 'your family'}.` }),
    promo: (f) => ({ title: f.title ?? 'News from AYWO', body: f.note ?? '' }),
    staff_assigned: (f) => ({ title: 'New work for you', body: `${f.by_name ?? 'A colleague'} gave you: ${f.title ?? 'an item'}.` }),
    staff_overdue: (f) => ({ title: 'Work is past its deadline', body: `${f.title ?? 'An item'} is waiting longer than it should.` }),
  },
  ta: {
    system_notice: (f) => ({ title: f.title ?? 'AYWO அறிவிப்பு', body: f.note ?? '' }),
    request_routed: () => ({ title: 'ஒரு கோரிக்கை உங்களிடம் வந்தது', body: 'உங்கள் குடும்ப மரத்தில் ஒரு கோரிக்கை நீண்ட நாள் காத்திருந்ததால் உங்களிடம் வந்துள்ளது. பதிலளிக்க AYWO-வைத் திறக்கவும்.' }),
    request_expired: () => ({ title: 'உங்கள் கோரிக்கை முடிந்தது', body: 'உங்கள் கோரிக்கைக்கு நேரத்தில் பதில் வரவில்லை. AYWO-வில் மீண்டும் கேட்கலாம்.' }),
    merge_candidate: () => ({ title: 'ஒரே நபர் இரு முறையா?', body: 'உங்கள் மரத்தில் ஒரே நபராக இருக்கக்கூடிய இரு பதிவுகளை AYWO கண்டது. ஒப்பிட AYWO-வைத் திறக்கவும்.' }),
    share_received: (f) => ({ title: 'ஒரு குடும்ப மரம் பகிரப்பட்டது', body: `${f.by_name ?? someone.ta} உங்களுடன் ஒரு குடும்ப மரத்தைப் பகிர்ந்துள்ளார்.` }),
    share_revoked: () => ({ title: 'அணுகல் முடிந்தது', body: 'ஒரு குடும்ப மரத்துக்கான உங்கள் அணுகலைப் பகிர்ந்தவர் நிறுத்தியுள்ளார்.' }),
    share_expired: () => ({ title: 'அணுகல் முடிந்தது', body: 'பகிரப்பட்ட குடும்ப மரத்துக்கான உங்கள் அணுகல் காலம் முடிந்தது.' }),
    successor_named: (f) => ({ title: 'நீங்கள் வாரிசாகக் குறிக்கப்பட்டீர்கள்', body: `${f.by_name ?? someone.ta} ஒரு குடும்ப மரத்தைப் பார்த்துக்கொள்ள உங்களைக் குறித்துள்ளார்.` }),
    tree_deleted: () => ({ title: 'ஒரு குடும்ப மரம் நீக்கப்பட்டது', body: 'நீங்கள் இருந்த ஒரு குடும்ப மரத்தை அதன் உருவாக்குநர் நீக்கினார்.' }),
    tree_passed_to_you: () => ({ title: 'ஒரு குடும்ப மரம் இப்போது உங்கள் பொறுப்பு', body: 'நீங்கள் இப்போது ஒரு குடும்ப மரத்தின் உருவாக்குநர். பார்க்க AYWO-வைத் திறக்கவும்.' }),
    kin_term_reviewed: () => ({ title: 'உங்கள் சொல் பார்க்கப்பட்டது', body: 'நீங்கள் பரிந்துரைத்த உறவுச் சொல் பார்க்கப்பட்டது. அறிய AYWO-வைத் திறக்கவும்.' }),
    person_taken_down: () => ({ title: 'ஒரு பதிவு நீக்கப்பட்டது', body: 'AYWO-வுக்கு வந்த கோரிக்கையால் உங்கள் குடும்ப மரத்திலிருந்து ஒரு பதிவு நீக்கப்பட்டது.' }),
    alert: (f) => alertText('ta', f),
    chat_message: (f) => ({ title: f.by_name ?? 'புதிய செய்தி', body: f.note ?? 'உங்களுக்குச் செய்தி அனுப்பியுள்ளார்.' }),
    chat_added: (f) => ({ title: 'புதிய குடும்ப உரையாடல்', body: `${f.by_name ?? someone.ta} உங்களை ஓர் உரையாடலில் சேர்த்தார்.` }),
    memory_tag: (f) => ({ title: 'ஒரு நினைவில் நீங்கள்', body: `${f.by_name ?? someone.ta} ஒரு நினைவில் உங்களைக் குறித்துள்ளார்.` }),
    memory_collaborator: (f) => ({ title: 'நினைவில் சேருங்கள்', body: `${f.by_name ?? someone.ta} ஒரு நினைவில் சேர்க்கும்படி கேட்டுள்ளார்.` }),
    memory_comment: (f) => ({ title: 'நினைவில் புதிய கருத்து', body: `${f.by_name ?? someone.ta} ஒரு நினைவில் கருத்து தெரிவித்தார்.` }),
    memory_reminder: () => ({ title: 'கடந்த ஆண்டு இதே நாள்', body: 'இந்த நாளின் குடும்ப நினைவு ஒன்று உள்ளது. மீண்டும் பார்க்க AYWO-வைத் திறக்கவும்.' }),
    invite: (f) => ({ title: 'உங்களுக்கு அழைப்பு', body: `${f.by_name ?? someone.ta} அழைத்துள்ளார்: ${f.note ?? ''}`.trim() }),
    invite_changed: (f) => ({ title: 'அழைப்பு மாறியது', body: `${f.note ?? 'ஓர் அழைப்பு'} விவரங்கள் மாறியுள்ளன.` }),
    invite_cancelled: (f) => ({ title: 'அழைப்பு ரத்தானது', body: `${f.note ?? 'ஓர் அழைப்பு'} ரத்து செய்யப்பட்டது.` }),
    rsvp: (f) => ({ title: 'அழைப்புக்கு புதிய பதில்', body: `${f.by_name ?? someone.ta} உங்கள் அழைப்புக்கு பதிலளித்தார்.` }),
    group_added: (f) => ({ title: 'புதிய குழு', body: `${f.by_name ?? someone.ta} உங்களை ஒரு குழுவில் சேர்த்தார்.` }),
    sos_ended: (f) => ({ title: 'SOS முடிந்தது', body: `${f.by_name ?? someone.ta} SOS-ஐ நிறுத்தினார்.` }),
    claim_made: (f) => ({ title: 'ஒருவர் தன் பதிவைக் கண்டறிந்தார்', body: `உங்கள் மரத்தில் ${f.person_name ?? aPerson.ta} தாங்களே என்று ${f.by_name ?? someone.ta} கூறுகிறார். தவறு எனில் நீங்கள் இதை ரத்து செய்யலாம்.` }),
    claim_undone: (f) => ({ title: 'உங்கள் இணைப்பு நீக்கப்பட்டது', body: `${f.person_name ?? aPerson.ta} உடனான உங்கள் இணைப்பை மரத்தின் உருவாக்குநர் ரத்து செய்தார்.` }),
    request_created: () => ({ title: 'ஒரு கோரிக்கை காத்திருக்கிறது', body: 'உங்கள் குடும்ப மரத்தில் ஒருவர் உங்கள் முடிவுக்காகக் காத்திருக்கிறார். பதிலளிக்க AYWO-வைத் திறக்கவும்.' }),
    request_decided: () => ({ title: 'உங்கள் கோரிக்கைக்கு பதில் வந்தது', body: 'உங்கள் கோரிக்கைக்கு பதில் உள்ளது. பார்க்க AYWO-வைத் திறக்கவும்.' }),
    comment_added: (f) => ({ title: 'புதிய கருத்து', body: `${f.person_name ?? aPerson.ta} பற்றி ${f.by_name ?? someone.ta} ஒரு கருத்தைச் சேர்த்தார்.` }),
    trial_ending: (f) => ({ title: 'உங்கள் இலவச மாதங்கள் விரைவில் முடிகின்றன', body: `AYWO Plus இலவச மாதங்கள் ${f.date ?? 'விரைவில்'} முடிகின்றன. அதற்கு முன் ரத்து செய்யாவிட்டால் ஆண்டுத் திட்டம் தொடங்கும்.` }),
    plan_trial_started: (f) => ({ title: 'AYWO Plus-க்கு வரவேற்கிறோம்', body: `உங்கள் இலவச மாதங்கள் தொடங்கின; ${f.date ?? 'சோதனைக் காலம் முடியும் வரை'} நீடிக்கும். 5 குடும்ப உறுப்பினர்கள் வரை சேர்க்கலாம்.` }),
    plan_active: () => ({ title: 'AYWO Plus செயலில் உள்ளது', body: 'உங்கள் திட்டம் செயலில் உள்ளது. 5 குடும்ப உறுப்பினர்கள் வரை இலவசமாகச் சேர்க்கலாம்.' }),
    plan_payment_failed: () => ({ title: 'உங்கள் கட்டணம் செல்லவில்லை', body: 'AYWO Plus-ஐப் புதுப்பிக்க முடியவில்லை. உங்கள் குடும்பத்துக்கு Plus தொடர, கட்டண முறையைச் சரிபார்க்கவும்.' }),
    plan_ended: () => ({ title: 'AYWO Plus முடிந்தது', body: 'உங்கள் திட்டம் முடிந்தது. உங்கள் மரமும் இலவச வசதிகளும் அப்படியே இருக்கும். எப்போது வேண்டுமானாலும் Plus-ஐ மீண்டும் தொடங்கலாம்.' }),
    plan_ended_member: (f) => ({ title: 'AYWO Plus முடிந்தது', body: `${f.by_name ?? someone.ta} வழங்கிய குடும்பத் திட்டம் முடிந்தது. உங்கள் மரமும் இலவச வசதிகளும் அப்படியே இருக்கும்.` }),
    plan_member_added: (f) => ({ title: 'உங்களுக்கு AYWO Plus கிடைத்தது', body: `${f.by_name ?? someone.ta} உங்களைக் குடும்பத் திட்டத்தில் சேர்த்துள்ளார். உங்களுக்குக் கட்டணம் இல்லை.` }),
    plan_member_removed: (f) => ({ title: 'குடும்பத் திட்டம் மாறியது', body: `${f.by_name ?? someone.ta} உங்களைக் குடும்பத் திட்டத்திலிருந்து நீக்கினார். உங்கள் மரமும் இலவச வசதிகளும் அப்படியே இருக்கும்.` }),
    order_paid: () => ({ title: 'உங்கள் ஆர்டருக்கு நன்றி', body: 'உங்கள் கட்டணம் கிடைத்தது. ஆர்டர் தயாரானதும் தெரிவிப்போம்.' }),
    order_update: (f) => ORDER_STEPS.ta[f.step ?? ''] ?? { title: 'உங்கள் ஆர்டர் மாறியது', body: 'உங்கள் ஆர்டரைப் பார்க்க AYWO-வைத் திறக்கவும்.' },
    order_refunded: () => ({ title: 'உங்கள் பணம் திருப்பப்படுகிறது', body: 'உங்கள் ஆர்டருக்கான பணத்தைத் திருப்பினோம். வங்கியில் தெரிய வழக்கமாக 5 முதல் 7 வேலை நாட்கள் ஆகும்.' }),
    ticket_reply: (f) => ({ title: 'AYWO உதவிக் குழு பதிலளித்தது', body: `தலைப்பு: ${f.title ?? 'உங்கள் கேள்வி'}. பதிலைப் படிக்க AYWO-வைத் திறக்கவும்.` }),
    report_decided: () => ({ title: 'உங்கள் புகாருக்கு நன்றி', body: 'நீங்கள் புகாரளித்ததைப் பார்த்தோம்; AYWO விதிகளை மீறிய இடத்தில் நடவடிக்கை எடுத்தோம்.' }),
    plus_gift: (f) => ({ title: 'AYWO Plus பரிசு', body: `${f.date ?? 'செயலியில் காட்டிய தேதி'} வரை உங்களுக்கு AYWO Plus இலவசம்.` }),
    referral_reward: () => ({ title: '30 நாள் AYWO Plus கிடைத்தது', body: 'குடும்பத்தை AYWO-க்கு அழைத்ததற்கு நன்றி. 30 இலவச Plus நாட்கள் சேர்க்கப்பட்டன.' }),
    birthdays_today: (f) => ({ title: 'இன்று பிறந்தநாள்', body: `${f.note ?? 'உங்கள் குடும்பத்தினர்'} அவர்களுக்கு வாழ்த்து அனுப்புங்கள்.` }),
    promo: (f) => ({ title: f.title ?? 'AYWO செய்தி', body: f.note ?? '' }),
    staff_assigned: (f) => ({ title: 'உங்களுக்குப் புதிய பணி', body: `${f.by_name ?? 'ஒரு சக ஊழியர்'} ஒதுக்கியது: ${f.title ?? 'ஒரு பணி'}.` }),
    staff_overdue: (f) => ({ title: 'பணி கெடு தாண்டியது', body: `${f.title ?? 'ஒரு பணி'} நீண்ட நேரமாகக் காத்திருக்கிறது.` }),
  },
};

const GENERIC: Record<Lang, NotificationText> = {
  en: { title: 'News from your family tree', body: 'There is something new for you in AYWO. Open the app to see it.' },
  ta: { title: 'உங்கள் குடும்ப மரத்திலிருந்து செய்தி', body: 'AYWO-வில் உங்களுக்காகப் புதிதாக ஒன்று உள்ளது. பார்க்க செயலியைத் திறக்கவும்.' },
};

const FOOTER: Record<Lang, { open: string; settings: string }> = {
  en: { open: 'Open AYWO', settings: 'You get this because of your AYWO notification settings. You can change them in the app under Me.' },
  ta: { open: 'AYWO-வைத் திற', settings: 'உங்கள் AYWO அறிவிப்பு அமைப்புகளால் இது வருகிறது. செயலியில் "நான்" பகுதியில் மாற்றலாம்.' },
};

/** Recipient's language where a template exists, English otherwise. Any kind works: unknown ones get the general words. */
export function notificationLang(language: string | null | undefined): Lang {
  return language?.toLowerCase().split('-')[0] === 'ta' ? 'ta' : 'en';
}

export function notificationText(kind: string, facts: NotificationFacts, language: string | null | undefined): NotificationText {
  const lang = notificationLang(language);
  const own = Object.prototype.hasOwnProperty.call(TEMPLATES[lang], kind) ? TEMPLATES[lang][kind] : undefined;
  if (own) return own(facts);
  return GENERIC[lang];
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** Names come from users, so all of it is escaped. Colours are the frozen logo colours (LLD L9). */
export function emailHtml(text: NotificationText, url: string, language: string | null | undefined): string {
  const footer = FOOTER[notificationLang(language)];
  return `<!doctype html>
<html><body style="margin:0;padding:24px;background:#FCFBFF;font-family:Manrope,Arial,sans-serif;color:#17153A">
<table role="presentation" width="100%" style="max-width:520px;margin:0 auto;background:#FFFFFF;border:1px solid #ECE9F7;border-radius:18px">
<tr><td style="padding:18px 24px;background:#2F3379;border-radius:18px 18px 0 0;color:#FDD623;font-weight:800;letter-spacing:1.5px;font-size:14px">AYWO</td></tr>
<tr><td style="padding:24px">
<h1 style="margin:0 0 12px;font-size:22px;line-height:1.25;font-weight:800">${escapeHtml(text.title)}</h1>
<p style="margin:0 0 22px;font-size:15px;line-height:1.5;color:#55516F">${escapeHtml(text.body)}</p>
<a href="${escapeHtml(url)}" style="display:inline-block;padding:14px 26px;background:#8E26E1;border-radius:28px;color:#FFFFFF;font-weight:800;font-size:15px;text-decoration:none">${escapeHtml(footer.open)}</a>
</td></tr>
<tr><td style="padding:0 24px 22px;font-size:12px;line-height:1.5;color:#55516F">${escapeHtml(footer.settings)}</td></tr>
</table></body></html>`;
}

const configured = !/dummy/i.test(config.SENDGRID_API_KEY);
if (configured) sgMail.setApiKey(config.SENDGRID_API_KEY);

/** False when SendGrid has no real key yet. Throws when SendGrid refuses or cannot be reached. */
export async function sendEmail(
  to: string,
  text: NotificationText,
  url: string,
  language: string | null | undefined,
): Promise<boolean> {
  if (!configured) return false;
  const footer = FOOTER[notificationLang(language)];
  await sgMail.send({
    to,
    from: { email: config.EMAIL_FROM, name: config.EMAIL_FROM_NAME },
    // A subject is one line, whatever a name contains.
    subject: text.title.replace(/[\r\n]+/g, ' '),
    text: `${text.body}\n\n${footer.open}: ${url}\n\n${footer.settings}`,
    html: emailHtml(text, url, language),
  });
  return true;
}
