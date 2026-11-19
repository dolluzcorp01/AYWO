// The picture beside the front page's headline: a phone showing a small family tree, drawn with the app's own faces
// and colours. It is an illustration, not a screenshot, so it never goes out of date and holds no real family.
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { Avatar } from '@/components/Avatar';
import { CalendarIcon, PhotoIcon } from '@/components/Icons';
import { Text } from '@/components/Text';
import { colors, fonts, shadows } from '@/theme/tokens';

const SCREEN = 252;
const TREE_HEIGHT = 292;
const NODE = 76;
const FACE = 44;

// Where each person sits on the little tree (x is the middle of the face, y its top).
const PEOPLE = [
  { key: 'grandfather', x: 74, y: 8 },
  { key: 'grandmother', x: 178, y: 8 },
  { key: 'father', x: 86, y: 104 },
  { key: 'mother', x: 166, y: 104 },
  { key: 'sister', x: 58, y: 216 },
  { key: 'you', x: 126, y: 216 },
  { key: 'brother', x: 194, y: 216 },
] as const;

// Couples joined side by side, a line down to their children, a bar across the children.
const LINES =
  'M74 30 H178 M126 30 V94 M126 94 H86 V104 ' +
  'M86 126 H166 M126 126 V206 M58 206 H194 M58 206 V216 M126 206 V216 M194 206 V216';

export function PhoneMock() {
  const { t } = useTranslation();
  return (
    <View style={styles.phone}>
      <View style={styles.screen}>
        <View style={styles.notch} />
        <Text style={styles.family} numberOfLines={1}>{t('landing.art.family')}</Text>
        <View style={styles.tree}>
          <Svg width={SCREEN} height={TREE_HEIGHT} style={StyleSheet.absoluteFill}>
            <Path d={LINES} stroke={colors.line} strokeWidth={2} fill="none" strokeLinecap="round" strokeLinejoin="round" />
          </Svg>
          {PEOPLE.map((p) => (
            <View key={p.key} style={[styles.node, { left: p.x - NODE / 2, top: p.y - (p.key === 'you' ? 5 : 0) }]}>
              <Avatar personId={`landing-${p.key}`} size={FACE} ring={p.key === 'you'} />
              <Text style={styles.name} numberOfLines={1}>{t(`landing.art.names.${p.key}`)}</Text>
              <Text style={[styles.kin, p.key === 'you' && styles.kinYou]} numberOfLines={1}>{t(`landing.art.kin.${p.key}`)}</Text>
            </View>
          ))}
        </View>
        <View style={styles.wordCard}>
          <Text style={styles.wordHow} numberOfLines={1}>{t('landing.art.cardHow')}</Text>
          <Text style={styles.wordIs} numberOfLines={1}>{t('landing.art.cardWord')}</Text>
        </View>
      </View>
    </View>
  );
}

/** A small card that floats beside the phone, like a notification. */
export function FloatingNote({ icon, title, text, style }: { icon: 'calendar' | 'photo'; title: string; text: string; style?: StyleProp<ViewStyle> }) {
  const NoteIcon = icon === 'calendar' ? CalendarIcon : PhotoIcon;
  return (
    <View style={[styles.note, style]}>
      <View style={[styles.noteIcon, icon === 'photo' && { backgroundColor: colors.celebrationTint }]}>
        <NoteIcon color={icon === 'photo' ? colors.ask : colors.relation} size={18} />
      </View>
      <View style={styles.noteWords}>
        <Text style={styles.noteTitle} numberOfLines={1}>{title}</Text>
        <Text style={styles.noteText} numberOfLines={1}>{text}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  phone: { width: SCREEN + 20, borderRadius: 44, padding: 10, backgroundColor: colors.text, ...shadows.raised },
  screen: { borderRadius: 34, backgroundColor: colors.background, overflow: 'hidden', paddingBottom: 16, alignItems: 'center' },
  notch: { width: 84, height: 20, borderBottomLeftRadius: 14, borderBottomRightRadius: 14, backgroundColor: colors.text },
  family: { marginTop: 12, marginBottom: 6, color: colors.text, fontFamily: fonts.extrabold, fontSize: 15 },
  tree: { width: SCREEN, height: TREE_HEIGHT },
  node: { position: 'absolute', width: NODE, alignItems: 'center' },
  name: { marginTop: 3, color: colors.text, fontFamily: fonts.bold, fontSize: 11, lineHeight: 15, backgroundColor: colors.background, paddingHorizontal: 3 },
  kin: { color: colors.relation, fontFamily: fonts.semibold, fontSize: 10, lineHeight: 14, backgroundColor: colors.background, paddingHorizontal: 3 },
  kinYou: { color: colors.white, backgroundColor: colors.logoIndigo, borderRadius: 7, paddingHorizontal: 7, overflow: 'hidden' },
  wordCard: { width: SCREEN - 28, marginTop: 8, backgroundColor: colors.card, borderRadius: 16, borderWidth: 1, borderColor: colors.cardBorder, paddingVertical: 10, paddingHorizontal: 14, ...shadows.card },
  wordHow: { color: colors.muted, fontFamily: fonts.semibold, fontSize: 11 },
  wordIs: { color: colors.relation, fontFamily: fonts.extrabold, fontSize: 17, lineHeight: 23 },
  note: { flexDirection: 'row', alignItems: 'center', gap: 10, maxWidth: 210, backgroundColor: colors.card, borderRadius: 16, borderWidth: 1, borderColor: colors.cardBorder, paddingVertical: 10, paddingHorizontal: 12, ...shadows.raised },
  noteIcon: { width: 34, height: 34, borderRadius: 12, backgroundColor: colors.tint, alignItems: 'center', justifyContent: 'center' },
  noteWords: { flexShrink: 1 },
  noteTitle: { color: colors.text, fontFamily: fonts.bold, fontSize: 13 },
  noteText: { color: colors.muted, fontFamily: fonts.medium, fontSize: 12 },
});
