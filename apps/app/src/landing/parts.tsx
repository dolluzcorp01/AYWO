// Small pieces of the front page: a store button, a ticked line, a question that opens, and the lists they come from.
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Linking, Pressable, StyleSheet, View } from 'react-native';
import { BellIcon, CalendarIcon, ChatIcon, CheckIcon, DownIcon, DownloadIcon, LinkedPeopleIcon, PhotoIcon, UpIcon } from '@/components/Icons';
import { Text } from '@/components/Text';
import { colors, fonts, radius } from '@/theme/tokens';

export const FEATURES = [
  { key: 'tree', icon: LinkedPeopleIcon },
  { key: 'memories', icon: PhotoIcon },
  { key: 'calendar', icon: CalendarIcon },
  { key: 'alerts', icon: BellIcon },
  { key: 'chat', icon: ChatIcon },
  { key: 'keep', icon: DownloadIcon },
] as const;

// Answers that need no price or contact detail filled in, so they read the same here as on the FAQ page.
export const QUESTIONS = [
  { group: 'start', id: 'free' },
  { group: 'tree', id: 'whoSees' },
  { group: 'start', id: 'signIn' },
  { group: 'safety', id: 'sell' },
] as const;

/** One of the two store buttons. With no link yet it is a quiet "Coming soon" tile, not a button that opens nothing. */
export function StoreButton({ platform, link, onDark }: { platform: 'android' | 'ios'; link: string; onDark?: boolean }) {
  const { t } = useTranslation();
  const name = t(`landing.store.${platform}`);
  if (!link) {
    return (
      <View accessibilityLabel={t('landing.store.soonLabel', { store: name })} style={[styles.store, styles.storeSoon, onDark && styles.storeSoonOnDark]}>
        <Text style={[styles.storeSmall, onDark && { color: colors.textOnDark }]}>{t('landing.store.soon')}</Text>
        <Text style={[styles.storeName, { color: onDark ? colors.white : colors.muted }]}>{name}</Text>
      </View>
    );
  }
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={t('landing.store.getLabel', { store: name })}
      onPress={() => void Linking.openURL(link).catch(() => undefined)}
      style={({ hovered }: { hovered?: boolean }) => [styles.store, onDark ? styles.storeLiveOnDark : styles.storeLive, hovered && styles.lift]}
    >
      <Text style={[styles.storeSmall, { color: onDark ? colors.muted : colors.textOnDark }]}>{t('landing.store.get')}</Text>
      <Text style={[styles.storeName, { color: onDark ? colors.text : colors.white }]}>{name}</Text>
    </Pressable>
  );
}

export function Tick({ text, onDark }: { text: string; onDark?: boolean }) {
  return (
    <View style={styles.tick}>
      <View style={[styles.tickMark, onDark && { backgroundColor: colors.glass }]}>
        <CheckIcon color={onDark ? colors.logoYellow : colors.good} size={16} width={2.6} />
      </View>
      <Text style={[styles.tickText, onDark && { color: colors.white }]}>{text}</Text>
    </View>
  );
}

export function Question({ group, id }: { group: string; id: string }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  return (
    <View style={styles.question}>
      <Pressable accessibilityRole="button" accessibilityState={{ expanded: open }} onPress={() => setOpen((was) => !was)} style={styles.questionRow}>
        <Text style={styles.questionText}>{t(`legal.faq.${group}.${id}Q`)}</Text>
        {open ? <UpIcon color={colors.relation} size={20} /> : <DownIcon color={colors.relation} size={20} />}
      </Pressable>
      {open ? <Text style={styles.answer}>{t(`legal.faq.${group}.${id}A`)}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  lift: { opacity: 0.9, transform: [{ translateY: -1 }] },
  store: { minHeight: 60, minWidth: 168, paddingHorizontal: 20, paddingVertical: 9, borderRadius: radius.button, justifyContent: 'center' },
  storeLive: { backgroundColor: colors.text, cursor: 'pointer' },
  storeLiveOnDark: { backgroundColor: colors.white, cursor: 'pointer' },
  storeSoon: { borderWidth: 1.5, borderStyle: 'dashed', borderColor: colors.line, backgroundColor: colors.card },
  storeSoonOnDark: { borderColor: colors.glass, backgroundColor: colors.glass },
  storeSmall: { color: colors.muted, fontFamily: fonts.semibold, fontSize: 12 },
  storeName: { fontFamily: fonts.extrabold, fontSize: 18, lineHeight: 24 },
  tick: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  tickMark: { width: 24, height: 24, borderRadius: 12, backgroundColor: colors.tint, alignItems: 'center', justifyContent: 'center' },
  tickText: { flex: 1, color: colors.text, fontFamily: fonts.semibold, fontSize: 15, lineHeight: 23 },
  question: { backgroundColor: colors.card, borderRadius: radius.card, borderWidth: 1, borderColor: colors.cardBorder, paddingHorizontal: 18 },
  questionRow: { minHeight: 60, flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, cursor: 'pointer' },
  questionText: { flex: 1, color: colors.text, fontFamily: fonts.bold, fontSize: 16, lineHeight: 23 },
  answer: { color: colors.muted, fontFamily: fonts.medium, fontSize: 15, lineHeight: 24, paddingBottom: 18 },
});
