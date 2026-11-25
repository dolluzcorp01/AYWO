// Building blocks shared by the social screens, on top of the frozen components.
import type { UseQueryResult } from '@tanstack/react-query';
import { useRouter } from '@/lib/router';
import { useRef, useState } from 'react';
import type { ComponentRef } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { ChevronIcon } from '@/components/Icons';
import { Bouncy, Rise } from '@/components/Motion';
import { useButtonInReach } from '@/components/keyboardRoom';
import { Screen } from '@/components/Screen';
import { Text } from '@/components/Text';
import { Card, ErrorText, Field, LoadFailed, Loading, Muted, SmallButton, TopBar } from '@/components/ui';
import { errorCode, useErrorText } from '@/lib/errors';
import { colors, fonts, minTapSize, shadows } from '@/theme/tokens';

/**
 * A search box for a list that has grown long (more than 8 lines): `box(list)` draws it, `filter(list)` keeps the
 * lines whose words contain what was typed. Short lists get no box.
 */
export function useListSearch<T>(words: (item: T) => string) {
  const { t } = useTranslation();
  const [typed, setTyped] = useState('');
  const needle = typed.trim().toLowerCase();
  return {
    box: (list: T[]) =>
      list.length > 8 ? <Field value={typed} onChangeText={setTyped} placeholder={t('search.placeholder')} accessibilityLabel={t('search.placeholder')} autoCorrect={false} /> : null,
    filter: (list: T[]) => (needle ? list.filter((item) => words(item).toLowerCase().includes(needle)) : list),
    nothing: (list: T[]) => !!needle && list.length > 0 && !list.some((item) => words(item).toLowerCase().includes(needle)),
  };
}

/** Goes back, or Home when the screen was opened straight from a notification. */
export function useGoBack() {
  const router = useRouter();
  return () => (router.canGoBack() ? router.back() : router.replace('/home'));
}

export function Page({ title, subtitle, children, footer }: { title: string; subtitle?: string; children: ReactNode; footer?: ReactNode }) {
  const goBack = useGoBack();
  const scroller = useRef<ComponentRef<typeof ScrollView>>(null);
  const onScroll = useButtonInReach(scroller);
  return (
    <Screen>
      <TopBar title={title} subtitle={subtitle} onBack={goBack} />
      <ScrollView ref={scroller} onScroll={onScroll} scrollEventThrottle={32} contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        {children}
      </ScrollView>
      {footer}
    </Screen>
  );
}

/** Explains AYWO Plus and links to it. */
export function PlusCard({ message }: { message?: string }) {
  const { t } = useTranslation();
  const router = useRouter();
  return (
    <Card style={styles.gap}>
      <Text style={styles.plusTitle}>{t('social.plus.title')}</Text>
      <Muted>{message ?? t('social.plus.body')}</Muted>
      <View style={styles.start}>
        <SmallButton label={t('social.plus.action')} kind="yellow" onPress={() => router.push('/plus')} />
      </View>
    </Card>
  );
}

/** Loading, failed and 'needs Plus' states for one query; children only run with data. */
export function Gate<T>({ query, plusMessage, children }: { query: UseQueryResult<T>; plusMessage?: string; children: (data: T) => ReactNode }) {
  const { t } = useTranslation();
  const errorText = useErrorText();
  if (query.isError && query.data === undefined) {
    if (errorCode(query.error) === 'plus_required') return <PlusCard message={plusMessage} />;
    return <LoadFailed message={errorText(query.error)} onRetry={() => query.refetch()} />;
  }
  if (query.data === undefined) return <Loading label={t('social.loading')} />;
  // What was waited for eases in, in place of appearing all at once. Same spacing as the page gives its parts.
  return <Rise style={styles.loaded}>{children(query.data)}</Rise>;
}

/** A failed action. When the reason is Plus, the way to get it is right there. */
export function ActionError({ error }: { error: unknown }) {
  const errorText = useErrorText();
  if (!error) return null;
  if (errorCode(error) === 'plus_required') return <PlusCard />;
  return <ErrorText>{errorText(error)}</ErrorText>;
}

/**
 * One line of a list. `lead` is what stands at its start (a face, a sign in a coloured circle); `meta` is the small
 * word at its end (how long ago). `second` is a line of its own under the subtitle, kept whole: a date and time.
 * `fresh` marks a line with something new on it. `index` brings the first lines of a list in one after another.
 */
export function Row({ title, subtitle, second, badge, onPress, urgent, lead, meta, fresh, index }: {
  title: string;
  subtitle?: string | null;
  second?: string | null;
  badge?: number;
  onPress?: () => void;
  urgent?: boolean;
  lead?: ReactNode;
  meta?: string | null;
  fresh?: boolean;
  index?: number;
}) {
  const body = (
    <>
      {lead}
      <View style={styles.rowText}>
        <View style={styles.rowTop}>
          <Text style={[styles.rowTitle, urgent && styles.urgent]} numberOfLines={1}>{title}</Text>
          {meta ? <Text style={[styles.rowMeta, fresh && styles.rowMetaFresh]}>{meta}</Text> : null}
        </View>
        {subtitle ? <Text style={[styles.rowSub, fresh && styles.rowSubFresh]} numberOfLines={2}>{subtitle}</Text> : null}
        {second ? <Text style={styles.rowSecond} numberOfLines={1}>{second}</Text> : null}
      </View>
      {badge ? <Badge count={badge} /> : null}
      {onPress && !lead ? <ChevronIcon color={colors.muted} size={18} /> : null}
    </>
  );
  const line = !onPress ? (
    <View style={styles.row}>{body}</View>
  ) : (
    <Bouncy accessibilityRole="button" onPress={onPress} to={0.985} hoverStyle={styles.rowHover} style={[styles.row, fresh && styles.rowFresh]}>
      {body}
    </Bouncy>
  );
  return index === undefined ? line : <Rise delay={Math.min(index, 8) * 40}>{line}</Rise>;
}

/** A sign in a soft coloured circle, for the start of a line that has no face. */
export function RowSign({ icon: Sign, ink = colors.logoPurple, back = colors.tint }: { icon: (p: { color: string; size?: number; width?: number }) => ReactNode; ink?: string; back?: string }) {
  return (
    <View style={[styles.rowSign, { backgroundColor: back }]}>
      <Sign color={ink} size={22} width={1.8} />
    </View>
  );
}

export function Badge({ count }: { count: number }) {
  const { t } = useTranslation();
  return (
    <View style={styles.badge} accessibilityLabel={t('social.unreadCount', { count })}>
      <Text style={styles.badgeText}>{count > 99 ? '99+' : count}</Text>
    </View>
  );
}

/** A quiet line of reassurance or explanation. */
export function Note({ children }: { children: ReactNode }) {
  return <Text style={styles.note}>{children}</Text>;
}

/** 'Meera' when a name is known, otherwise 'Someone'. Never a he or she. */
export function useName() {
  const { t } = useTranslation();
  return (name: string | null | undefined) => (name && name.trim() ? name : t('social.someone'));
}

/** A date and time in the reader's language. */
export function useWhen() {
  const { i18n } = useTranslation();
  return (iso: string | null | undefined, dateOnly?: boolean) => {
    if (!iso) return '';
    // A date with no time ('2026-11-02') is that day wherever the reader is. new Date() would read it as midnight in
    // London, which is still the day before in the Americas.
    const day = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    const value = day ? new Date(Number(day[1]), Number(day[2]) - 1, Number(day[3])) : new Date(iso);
    if (Number.isNaN(value.getTime())) return '';
    return dateOnly || day
      ? value.toLocaleDateString(i18n.language, { day: 'numeric', month: 'short', year: 'numeric' })
      : value.toLocaleString(i18n.language, { dateStyle: 'medium', timeStyle: 'short', hour12: true });
  };
}

/** Reads '2026-11-02' and '18:30' typed by hand. Null when either is not a real date or time. */
export function parseDateTime(date: string, time: string): Date | null {
  const d = date.trim().match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  const c = time.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!d || !c) return null;
  const value = new Date(Number(d[1]), Number(d[2]) - 1, Number(d[3]), Number(c[1]), Number(c[2]));
  if (Number.isNaN(value.getTime()) || value.getMonth() !== Number(d[2]) - 1 || Number(c[1]) > 23 || Number(c[2]) > 59) return null;
  return value;
}

/**
 * A Pop Party date choice picked from the calendar is stored as '2026-12-25' or '2026-12-25 18:30'. That way every
 * reader sees it in their own language, and the host's "settle" boxes can be filled from the leading choice.
 * Null for anything else: older parties have choices typed as words ("Saturday evening").
 */
export function readDateOption(label: string): { date: string; time: string } | null {
  const m = label.trim().match(/^(\d{4}-\d{2}-\d{2})(?: (\d{2}:\d{2}))?$/);
  if (!m) return null;
  return { date: m[1], time: m[2] ?? '' };
}

/** How a Pop Party date choice reads on screen. Words typed by hand are shown as they are. */
export function useDateOption() {
  const when = useWhen();
  return (label: string) => {
    const read = readDateOption(label);
    if (!read) return label;
    const shown = read.time ? when(parseDateTime(read.date, read.time)?.toISOString()) : when(read.date);
    return shown || label;
  };
}

// Today as "2026-12-25": the earliest day an event can be planned for.
export { todayIso } from '@/lib/time';

/** Every line that has words on it. */
export function lines(text: string): string[] {
  return text.split('\n').map((l) => l.trim()).filter(Boolean);
}

/** Good enough to tell one send from another; not used for anything secret. */
export function newClientId(): string {
  return 'xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx'.replace(/x/g, () => Math.floor(Math.random() * 16).toString(16));
}

const styles = StyleSheet.create({
  scroll: { gap: 12, paddingTop: 14, paddingBottom: 24, flexGrow: 1 },
  gap: { gap: 10 },
  start: { alignSelf: 'flex-start' },
  plusTitle: { color: colors.text, fontFamily: fonts.extrabold, fontSize: 17 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: minTapSize + 16,
    padding: 14,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    backgroundColor: colors.card,
    ...shadows.card,
  },
  loaded: { gap: 12, flexGrow: 1 },
  rowHover: { backgroundColor: colors.tint, borderColor: colors.line },
  rowFresh: { borderColor: colors.dashed, backgroundColor: '#FCFAFF' },
  rowText: { flex: 1, minWidth: 0 },
  rowTop: { flexDirection: 'row', alignItems: 'baseline', gap: 8 },
  rowTitle: { flex: 1, minWidth: 0, color: colors.text, fontFamily: fonts.extrabold, fontSize: 16 },
  rowMeta: { color: colors.muted, fontFamily: fonts.semibold, fontSize: 12 },
  rowMetaFresh: { color: colors.relation, fontFamily: fonts.bold },
  rowSubFresh: { color: colors.text, fontFamily: fonts.semibold },
  rowSign: { width: 46, height: 46, borderRadius: 23, alignItems: 'center', justifyContent: 'center' },
  urgent: { color: colors.alert },
  rowSub: { color: colors.muted, fontFamily: fonts.medium, fontSize: 13, lineHeight: 18, marginTop: 2 },
  rowSecond: { color: colors.text, fontFamily: fonts.semibold, fontSize: 13, lineHeight: 18, marginTop: 2 },
  badge: { minWidth: 24, height: 24, borderRadius: 12, paddingHorizontal: 7, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.alert },
  badgeText: { color: colors.white, fontFamily: fonts.extrabold, fontSize: 12 },
  note: { color: colors.muted, fontFamily: fonts.medium, fontSize: 13, lineHeight: 19 },
});
