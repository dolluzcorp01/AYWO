// Admin > App settings > Content: what people read that staff must be able to change without a new release.
// Company details (Contact, Terms, Privacy, Refunds), the emergency numbers on the SOS screens, and the FAQ.
// Each panel hands its whole value to onSave; the settings page asks for a reason and saves it (0050).
import { useState } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Text, View } from 'react-native';
import { Actions, adminStyles, Checkbox, Field, FilterChips, Message, Panel, SecondaryButton } from '@/admin/ui';
import { FAQ_GROUPS } from '@/legal/faqGroups';
import { PUBLISHER } from '@/legal/publisher';
import type { FaqItem } from '@/ops/appConfig';

type Value = Record<string, unknown>;
type Save = ((value: Value) => void) | null;
const text = (value: unknown) => (typeof value === 'string' ? value : '');

const PUBLISHER_FIELDS = [
  'company', 'address', 'email', 'phone', 'supportHours', 'cin', 'gstin', 'grievanceOfficer', 'grievanceEmail',
  'courtCity', 'deliveryDays', 'refundDays', 'damageDays', 'refundWorkingDays',
] as const;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** The company and contact details on the public pages. An empty box keeps what the app was built with. */
export function PublisherPanel({ value, onSave, footer }: { value: Value; onSave: Save; footer: ReactNode }) {
  const { t } = useTranslation();
  const [fields, setFields] = useState<Record<string, string>>(() => Object.fromEntries(PUBLISHER_FIELDS.map((key) => [key, text(value[key])])));
  const [draft, setDraft] = useState(value.draft !== false);
  const bad = (key: string) => (key.toLowerCase().includes('email') && fields[key].trim() && !EMAIL.test(fields[key].trim()) ? t('admin.settings.supportEmailBad') : null);
  const anyBad = PUBLISHER_FIELDS.some((key) => bad(key));
  // What the pages show now for a box left empty: "XXX" there means that line is still hidden from the public.
  const builtIn = PUBLISHER as Record<string, string>;
  const missing = PUBLISHER_FIELDS.filter((key) => !fields[key].trim() && builtIn[key] === 'XXX');
  return (
    <Panel title={t('admin.content.publisher')}>
      <Text style={adminStyles.cellMuted}>{t('admin.content.publisherHelp')}</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
        {PUBLISHER_FIELDS.map((key) => (
          <View key={key} style={{ flexBasis: key === 'address' ? 500 : 240, flexGrow: 1 }}>
            <Field
              label={t(`admin.content.fields.${key}`)}
              value={fields[key]}
              onChange={(v) => setFields((now) => ({ ...now, [key]: v }))}
              maxLength={300}
              multiline={key === 'address'}
              placeholder={builtIn[key] === 'XXX' ? t('admin.content.notSet') : builtIn[key]}
              error={bad(key)}
            />
          </View>
        ))}
      </View>
      {missing.length > 0 ? <Message alert text={t('admin.content.publisherMissing', { list: missing.map((key) => t(`admin.content.fields.${key}`)).join(', ') })} /> : null}
      <Checkbox label={t('admin.content.draft')} checked={draft} onChange={setDraft} />
      {footer}
      <Actions>
        <SecondaryButton
          main
          label={t('admin.common.save')}
          disabled={!onSave || anyBad}
          onPress={() => onSave?.({ ...Object.fromEntries(PUBLISHER_FIELDS.map((key) => [key, fields[key].trim()]).filter(([, v]) => v)), draft })}
        />
      </Actions>
    </Panel>
  );
}

/** One country per line: "IN 112". India must stay, because most people using AYWO are there. */
export function EmergencyPanel({ value, onSave, footer }: { value: Value; onSave: Save; footer: ReactNode }) {
  const { t } = useTranslation();
  const [lines, setLines] = useState(() =>
    Object.entries(value)
      .sort(([a], [b]) => (a === 'IN' ? -1 : b === 'IN' ? 1 : a.localeCompare(b)))
      .map(([country, number]) => `${country} ${text(number)}`)
      .join('\n'),
  );
  const rows = lines.split('\n').map((line) => line.trim()).filter(Boolean);
  const wrong = rows.filter((row) => !/^[A-Za-z]{2}\s+[0-9]{2,6}$/.test(row));
  const parsed = Object.fromEntries(rows.filter((row) => !wrong.includes(row)).map((row) => [row.slice(0, 2).toUpperCase(), row.slice(2).trim()]));
  const problem = wrong.length > 0 ? t('admin.content.emergencyBad', { line: wrong[0] }) : !parsed.IN ? t('admin.content.emergencyNeedsIndia') : null;
  return (
    <Panel title={t('admin.content.emergency')}>
      <Text style={adminStyles.cellMuted}>{t('admin.content.emergencyHelp')}</Text>
      <Field label={t('admin.content.emergencyLines')} value={lines} onChange={setLines} multiline maxLength={2000} error={problem} />
      {footer}
      <Actions>
        <SecondaryButton main danger label={t('admin.common.save')} disabled={!onSave || !!problem} onPress={() => onSave?.(parsed)} />
      </Actions>
    </Panel>
  );
}

const EMPTY: FaqItem = { id: '', group: 'start', q: { en: '', ta: '' }, a: { en: '', ta: '' } };
const newId = () => `q${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;

/** Questions staff add (English, and Tamil when they have it), and built-in questions they hide. */
export function FaqPanel({ value, onSave, footer }: { value: Value; onSave: Save; footer: ReactNode }) {
  const { t } = useTranslation();
  const [items, setItems] = useState<FaqItem[]>(() => (Array.isArray(value.items) ? (value.items as FaqItem[]) : []));
  const [hidden, setHidden] = useState<string[]>(() => (Array.isArray(value.hidden) ? (value.hidden as string[]) : []));
  // The question being written or changed. Null when the form is closed.
  const [editing, setEditing] = useState<FaqItem | null>(null);
  const [changed, setChanged] = useState(false);

  const questionBad = editing && editing.q.en.trim().length < 3 ? t('admin.content.faqNeedsQuestion') : null;
  const answerBad = editing && editing.a.en.trim().length < 3 ? t('admin.content.faqNeedsAnswer') : null;

  function keep() {
    if (!editing) return;
    const clean: FaqItem = {
      id: editing.id || newId(),
      group: editing.group,
      q: { en: editing.q.en.trim(), ta: editing.q.ta?.trim() ?? '' },
      a: { en: editing.a.en.trim(), ta: editing.a.ta?.trim() ?? '' },
    };
    setItems((now) => (now.some((item) => item.id === clean.id) ? now.map((item) => (item.id === clean.id ? clean : item)) : [...now, clean]));
    setEditing(null);
    setChanged(true);
  }

  return (
    <Panel title={t('admin.content.faq')}>
      <Text style={adminStyles.cellMuted}>{t('admin.content.faqHelp')}</Text>

      <Text style={adminStyles.cellStrong}>{t('admin.content.faqAdded')}</Text>
      {items.length === 0 ? <Text style={adminStyles.cellMuted}>{t('admin.content.faqNone')}</Text> : null}
      {items.map((item) => (
        <View key={item.id} style={{ gap: 4, paddingVertical: 6 }}>
          <Text style={adminStyles.cellStrong}>{item.q.en}</Text>
          <Text style={adminStyles.cellMuted}>
            {t(`legal.faq.${item.group}.title`)} · {item.q.ta?.trim() ? t('admin.content.faqBoth') : t('admin.content.faqEnglishOnly')}
          </Text>
          <Actions>
            <SecondaryButton label={t('admin.content.faqEdit')} onPress={() => setEditing(item)} />
            <SecondaryButton
              danger
              label={t('admin.content.faqRemove')}
              onPress={() => {
                setItems((now) => now.filter((other) => other.id !== item.id));
                setChanged(true);
              }}
            />
          </Actions>
        </View>
      ))}

      {editing ? (
        <View style={{ gap: 8 }}>
          <Text style={adminStyles.cellStrong}>{t(editing.id ? 'admin.content.faqChange' : 'admin.content.faqNew')}</Text>
          <FilterChips
            value={editing.group}
            onChange={(group) => setEditing({ ...editing, group })}
            options={FAQ_GROUPS.map((group) => ({ value: group.id, label: t(`legal.faq.${group.id}.title`) }))}
          />
          <Field label={t('admin.content.faqQuestionEn')} value={editing.q.en} onChange={(v) => setEditing({ ...editing, q: { ...editing.q, en: v } })} maxLength={300} error={questionBad} />
          <Field label={t('admin.content.faqAnswerEn')} value={editing.a.en} onChange={(v) => setEditing({ ...editing, a: { ...editing.a, en: v } })} multiline maxLength={3000} error={answerBad} />
          <Field label={t('admin.content.faqQuestionTa')} value={editing.q.ta ?? ''} onChange={(v) => setEditing({ ...editing, q: { ...editing.q, ta: v } })} maxLength={300} />
          <Field label={t('admin.content.faqAnswerTa')} value={editing.a.ta ?? ''} onChange={(v) => setEditing({ ...editing, a: { ...editing.a, ta: v } })} multiline maxLength={3000} />
          <Actions>
            <SecondaryButton main label={t('admin.content.faqKeep')} disabled={!!questionBad || !!answerBad} onPress={keep} />
            <SecondaryButton label={t('admin.common.cancel')} onPress={() => setEditing(null)} />
          </Actions>
        </View>
      ) : (
        <Actions>
          <SecondaryButton label={t('admin.content.faqAdd')} disabled={items.length >= 100} onPress={() => setEditing({ ...EMPTY, q: { ...EMPTY.q }, a: { ...EMPTY.a } })} />
        </Actions>
      )}

      <Text style={adminStyles.cellStrong}>{t('admin.content.faqBuiltIn')}</Text>
      <Text style={adminStyles.cellMuted}>{t('admin.content.faqBuiltInHelp')}</Text>
      {FAQ_GROUPS.map((group) => (
        <View key={group.id} style={{ gap: 2 }}>
          <Text style={adminStyles.cellMuted}>{t(`legal.faq.${group.id}.title`)}</Text>
          {group.questions.map((id) => {
            const key = `${group.id}.${id}`;
            return (
              <Checkbox
                key={key}
                label={t(`legal.faq.${group.id}.${id}Q`, PUBLISHER)}
                checked={!hidden.includes(key)}
                onChange={(shown) => {
                  setHidden((now) => (shown ? now.filter((other) => other !== key) : [...now, key]));
                  setChanged(true);
                }}
              />
            );
          })}
        </View>
      ))}

      {changed ? <Message alert text={t('admin.content.faqNotSaved')} /> : null}
      {footer}
      <Actions>
        <SecondaryButton
          main
          label={t('admin.common.save')}
          disabled={!onSave || !!editing || !changed}
          onPress={() => {
            onSave?.({ items, hidden });
            setChanged(false);
          }}
        />
      </Actions>
    </Panel>
  );
}

const SHOP_PRODUCTS = ['tree_poster', 'family_book', 'premium_invite'] as const;
type Words = { en?: string; ta?: string };
type ProductText = { name?: Words; about?: Words };

/** What each shop product is called and how it is described. An empty box keeps the app's own words, shown as the hint. */
export function ShopTextPanel({ value, onSave, footer }: { value: Value; onSave: Save; footer: ReactNode }) {
  const { t, i18n } = useTranslation();
  const [words, setWords] = useState<Record<string, ProductText>>(() => value as Record<string, ProductText>);
  const set = (product: string, part: 'name' | 'about', lang: 'en' | 'ta', v: string) =>
    setWords((now) => ({ ...now, [product]: { ...now[product], [part]: { ...now[product]?.[part], [lang]: v } } }));
  // Only what was typed is saved: an empty box must fall back to the app's words, not blank the name.
  const cleaned = () => {
    const out: Record<string, ProductText> = {};
    for (const product of SHOP_PRODUCTS) {
      for (const part of ['name', 'about'] as const) {
        for (const lang of ['en', 'ta'] as const) {
          const typed = words[product]?.[part]?.[lang]?.trim();
          if (typed) out[product] = { ...out[product], [part]: { ...out[product]?.[part], [lang]: typed } };
        }
      }
    }
    return out;
  };
  const builtIn = (key: string, lng: string) => i18n.t(key, { lng, defaultValue: '' });
  return (
    <Panel title={t('admin.content.shop')}>
      <Text style={adminStyles.cellMuted}>{t('admin.content.shopHelp')}</Text>
      {SHOP_PRODUCTS.map((product) => (
        <View key={product} style={{ gap: 8 }}>
          <Text style={adminStyles.cellStrong}>{builtIn(`ops.shop.products.${product}`, 'en-US')}</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
            <View style={{ flexBasis: 240, flexGrow: 1 }}>
              <Field label={t('admin.content.shopNameEn')} value={words[product]?.name?.en ?? ''} onChange={(v) => set(product, 'name', 'en', v)} maxLength={60} placeholder={builtIn(`ops.shop.products.${product}`, 'en-US')} />
            </View>
            <View style={{ flexBasis: 240, flexGrow: 1 }}>
              <Field label={t('admin.content.shopNameTa')} value={words[product]?.name?.ta ?? ''} onChange={(v) => set(product, 'name', 'ta', v)} maxLength={60} placeholder={builtIn(`ops.shop.products.${product}`, 'ta')} />
            </View>
          </View>
          <Field label={t('admin.content.shopAboutEn')} value={words[product]?.about?.en ?? ''} onChange={(v) => set(product, 'about', 'en', v)} multiline maxLength={300} placeholder={builtIn(`ops.shop.about.${product}`, 'en-US')} />
          <Field label={t('admin.content.shopAboutTa')} value={words[product]?.about?.ta ?? ''} onChange={(v) => set(product, 'about', 'ta', v)} multiline maxLength={300} placeholder={builtIn(`ops.shop.about.${product}`, 'ta')} />
        </View>
      ))}
      {footer}
      <Actions>
        <SecondaryButton main label={t('admin.common.save')} disabled={!onSave} onPress={() => onSave?.(cleaned())} />
      </Actions>
    </Panel>
  );
}
