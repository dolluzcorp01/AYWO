// Building blocks shared by the social screens, on top of the frozen components.
import type { UseQueryResult } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { ChevronIcon } from '@/components/Icons';
import { Screen } from '@/components/Screen';
import { Text } from '@/components/Text';
import { Card, ErrorText, LoadFailed, Loading, Muted, SmallButton, TopBar } from '@/components/ui';
import { errorCode, useErrorText } from '@/lib/errors';
import { colors, fonts, minTapSize } from '@/theme/tokens';

/** Goes back, or Home when the screen was opened straight from a notification. */
export function useGoBack() {
  const router = useRouter();
  return () => (router.canGoBack() ? router.back() : router.replace('/home'));
}

export function Page({ title, subtitle, children, footer }: { title: string; subtitle?: string; children: ReactNode; footer?: ReactNode }) {
  const goBack = useGoBack();
  return (
    <Screen>
      <TopBar title={title} subtitle={subtitle} onBack={goBack} />
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
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
  return <>{children(query.data)}</>;
}

/** A failed action. When the reason is Plus, the way to get it is right there. */
export function ActionError({ error }: { error: unknown }) {
  const errorText = useErrorText();
  if (!error) return null;
  if (errorCode(error) === 'plus_required') return <PlusCard />;
  return <ErrorText>{errorText(error)}</ErrorText>;
}

export function Row({ title, subtitle, badge, onPress, urgent }: { title: string; subtitle?: string | null; badge?: number; onPress?: () => void; urgent?: boolean }) {
  const body = (
    <>
      <View style={styles.rowText}>
        <Text style={[styles.rowTitle, urgent && styles.urgent]} numberOfLines={1}>{title}</Text>
        {subtitle ? <Text style={styles.rowSub} numberOfLines={2}>{subtitle}</Text> : null}
      </View>
      {badge ? <Badge count={badge} /> : null}
      {onPress ? <ChevronIcon color={colors.muted} size={18} /> : null}
    </>
  );
  if (!onPress) return <View style={styles.row}>{body}</View>;
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={styles.row}>
      {body}
    </Pressable>
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
    const value = new Date(iso);
    if (Number.isNaN(value.getTime())) return '';
    return dateOnly
      ? value.toLocaleDateString(i18n.language)
      : value.toLocaleString(i18n.language, { dateStyle: 'medium', timeStyle: 'short' });
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
    gap: 10,
    minHeight: minTapSize + 12,
    padding: 14,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    backgroundColor: colors.card,
  },
  rowText: { flex: 1, minWidth: 0 },
  rowTitle: { color: colors.text, fontFamily: fonts.extrabold, fontSize: 15 },
  urgent: { color: colors.alert },
  rowSub: { color: colors.muted, fontFamily: fonts.medium, fontSize: 13, lineHeight: 18, marginTop: 2 },
  badge: { minWidth: 24, height: 24, borderRadius: 12, paddingHorizontal: 7, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.alert },
  badgeText: { color: colors.white, fontFamily: fonts.extrabold, fontSize: 12 },
  note: { color: colors.muted, fontFamily: fonts.medium, fontSize: 13, lineHeight: 19 },
});
