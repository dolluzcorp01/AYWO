import { describe, expect, it } from 'vitest';
import enUS from '../../../../locales/en-US.p1.json';
import ta from '../../../../locales/ta.p1.json';
import { type FaqEntry, searchFaq, words } from './faqSearch';

type Faq = Record<string, unknown>;

function entriesOf(faq: Faq): FaqEntry[] {
  const out: FaqEntry[] = [];
  for (const [group, value] of Object.entries(faq)) {
    if (typeof value !== 'object' || value === null) continue;
    const texts = value as Record<string, string>;
    for (const name of Object.keys(texts)) {
      if (!name.endsWith('Q')) continue;
      const id = name.slice(0, -1);
      out.push({ key: `${group}.${id}`, question: texts[name], answer: texts[`${id}A`], keywords: texts[`${id}K`] ?? '' });
    }
  }
  return out;
}

const english = entriesOf(enUS.legal.faq as Faq);
const tamil = entriesOf(ta.legal.faq as Faq);
const first = (list: FaqEntry[], search: string) => searchFaq(list, search)[0]?.key;
const keys = (list: FaqEntry[], search: string) => searchFaq(list, search).map((e) => e.key);

describe('FAQ search', () => {
  it('every question has search words in English and Tamil', () => {
    expect(english.length).toBe(30);
    expect(tamil.length).toBe(30);
    for (const e of [...english, ...tamil]) expect(e.keywords, e.key).not.toBe('');
  });

  it('finds a question by a word in it', () => {
    expect(first(english, 'refund')).toBe('plus.refund');
    expect(first(english, 'delete account')).toBe('account.delete');
    expect(first(english, 'sos')).toBe('safety.sos');
  });

  it('finds a question by the words people really use', () => {
    expect(first(english, 'money back')).toBe('plus.refund');
    expect(first(english, 'otp')).toBe('start.signIn');
    expect(first(english, 'login')).toBe('start.signIn');
    expect(first(english, 'upi')).toBe('plus.pay');
    expect(first(english, 'courier')).toBe('orders.delivery');
    expect(first(english, 'gedcom')).toBe('start.importing');
    expect(first(english, 'customer care')).toBe('account.help');
  });

  it('reads a whole sentence, not just one word', () => {
    expect(first(english, 'how do i cancel my subscription')).toBe('plus.cancel');
    expect(first(english, 'I paid but plus is not showing')).toBe('plus.failed');
    expect(first(english, 'will others see my phone number?')).toBe('safety.number');
  });

  it('forgives a typing mistake and a half-typed word', () => {
    expect(first(english, 'refnud')).toBe('plus.refund');
    expect(first(english, 'delivry')).toBe('orders.delivery');
    expect(first(english, 'refu')).toBe('plus.refund');
    expect(first(english, 'REFUND')).toBe('plus.refund');
  });

  it('gives nothing for nonsense or an empty box', () => {
    expect(keys(english, 'xqzzk')).toEqual([]);
    expect(keys(english, '   ')).toEqual([]);
    expect(keys(english, '??')).toEqual([]);
  });

  it('never gives more than the limit', () => {
    expect(searchFaq(english, 'tree').length).toBeLessThanOrEqual(8);
    expect(searchFaq(english, 'tree', 3).length).toBe(3);
  });

  it('works in Tamil, and for English words typed on the Tamil screen', () => {
    expect(first(tamil, 'கணக்கை நீக்குவது')).toBe('account.delete');
    expect(first(tamil, 'ரத்து')).toBe('plus.cancel');
    expect(first(tamil, 'refund')).toBe('plus.refund');
    expect(first(tamil, 'otp')).toBe('start.signIn');
  });

  it('keeps Tamil letters whole when it splits words', () => {
    expect(words('என் கணக்கை, நீக்குவது?')).toEqual(['என்', 'கணக்கை', 'நீக்குவது']);
  });
});
