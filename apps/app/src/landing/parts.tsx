// Small pieces of the front page: a store button, a ticked line, a question that opens, and the lists they come from.
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Linking, Pressable, StyleSheet, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
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

// The two stores' own marks, in their own colours, so the buttons are the ones people know from every other app.
// These are the only colours on the page that do not come from the theme: they belong to Google and Apple.
const PLAY = { blue: '#4285F4', red: '#EA4335', yellow: '#FBBC04', green: '#34A853' };

function StoreMark({ platform }: { platform: 'android' | 'ios' }) {
  if (platform === 'android') {
    return (
      <Svg width={28} height={28} viewBox="0 0 512 512">
        <Path d="M48 59.49v393a4.33 4.33 0 0 0 7.37 3.07L260 256 55.37 56.42A4.33 4.33 0 0 0 48 59.49z" fill={PLAY.blue} />
        <Path d="M345.8 174L89.22 32.64l-.16-.09c-4.42-2.4-8.62 3.58-5 7.06l201.13 192.32z" fill={PLAY.red} />
        <Path d="M84.08 472.39c-3.64 3.48.56 9.46 5 7.06l.16-.09L345.8 338l-60.61-57.95z" fill={PLAY.green} />
        <Path d="M449.38 231l-71.65-39.46L310.36 256l67.37 64.43L449.38 281c19.49-10.77 19.49-39.23 0-50z" fill={PLAY.yellow} />
      </Svg>
    );
  }
  return (
    <Svg width={28} height={28} viewBox="0 0 24 24">
      <Path
        d="M12.152 6.896c-.948 0-2.415-1.078-3.96-1.04-2.04.027-3.91 1.183-4.961 3.014-2.117 3.675-.546 9.103 1.519 12.09 1.013 1.454 2.208 3.09 3.792 3.039 1.52-.065 2.09-.987 3.935-.987 1.831 0 2.35.987 3.96.948 1.637-.026 2.676-1.48 3.676-2.948 1.156-1.688 1.636-3.325 1.662-3.415-.039-.013-3.182-1.221-3.22-4.857-.026-3.04 2.48-4.494 2.597-4.559-1.429-2.09-3.623-2.324-4.39-2.376-2-.156-3.675 1.09-4.61 1.09zM15.53 3.83c.843-1.012 1.4-2.427 1.245-3.83-1.207.052-2.662.805-3.532 1.818-.78.896-1.454 2.338-1.273 3.714 1.338.104 2.715-.688 3.559-1.701"
        fill={colors.white}
      />
    </Svg>
  );
}

/**
 * One of the two store buttons: dark, like the buttons people know from other apps. With no link yet it carries a
 * "Soon" tag and is not a button, so nothing opens an empty page. `onDark` gives it an edge on the indigo bands.
 */
export function StoreButton({ platform, link, onDark }: { platform: 'android' | 'ios'; link: string; onDark?: boolean }) {
  const { t } = useTranslation();
  const name = t(`landing.store.${platform}`);
  const inside = (
    <>
      <StoreMark platform={platform} />
      <View>
        <Text style={styles.storeSmall}>{t(`landing.store.${platform}Get`)}</Text>
        <Text style={styles.storeName}>{name}</Text>
      </View>
    </>
  );
  if (!link) {
    return (
      <View accessibilityLabel={t('landing.store.soonLabel', { store: name })} style={[styles.store, onDark && styles.storeOnDark]}>
        {inside}
        <View style={styles.soonTag}><Text style={styles.soonTagText}>{t('landing.store.soonTag')}</Text></View>
      </View>
    );
  }
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={t('landing.store.getLabel', { store: name })}
      onPress={() => void Linking.openURL(link).catch(() => undefined)}
      style={({ hovered }: { hovered?: boolean }) => [styles.store, styles.storeLive, onDark && styles.storeOnDark, hovered && styles.lift]}
    >
      {inside}
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
  store: { minHeight: 60, minWidth: 176, paddingHorizontal: 18, paddingVertical: 9, borderRadius: radius.button, flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: colors.text, borderWidth: 1, borderColor: colors.text },
  storeLive: { cursor: 'pointer' },
  storeOnDark: { borderColor: colors.glass },
  storeSmall: { color: colors.textOnDark, fontFamily: fonts.semibold, fontSize: 11, letterSpacing: 0.4, textTransform: 'uppercase' },
  storeName: { color: colors.white, fontFamily: fonts.extrabold, fontSize: 18, lineHeight: 24 },
  soonTag: { position: 'absolute', top: -10, right: 10, paddingHorizontal: 10, paddingVertical: 2, borderRadius: 12, backgroundColor: colors.logoYellow },
  soonTagText: { color: colors.text, fontFamily: fonts.extrabold, fontSize: 12 },
  tick: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  tickMark: { width: 24, height: 24, borderRadius: 12, backgroundColor: colors.tint, alignItems: 'center', justifyContent: 'center' },
  tickText: { flex: 1, color: colors.text, fontFamily: fonts.semibold, fontSize: 15, lineHeight: 23 },
  question: { backgroundColor: colors.card, borderRadius: radius.card, borderWidth: 1, borderColor: colors.cardBorder, paddingHorizontal: 18 },
  questionRow: { minHeight: 60, flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, cursor: 'pointer' },
  questionText: { flex: 1, color: colors.text, fontFamily: fonts.bold, fontSize: 16, lineHeight: 23 },
  answer: { color: colors.muted, fontFamily: fonts.medium, fontSize: 15, lineHeight: 24, paddingBottom: 18 },
});
