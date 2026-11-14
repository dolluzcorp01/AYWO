// A row of photos you can manage: each has Remove (x) and, when allowed, move left / move right. Used while making a
// memory (nothing saved yet) and on a posted memory (each change saves). Plain buttons, not dragging, so it works
// the same with a mouse, a finger and a screen reader.
import { useTranslation } from 'react-i18next';
import { Image, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Text } from '@/components/Text';
import { colors, fonts } from '@/theme/tokens';

export interface StripPhoto {
  key: string;
  uri: string | null;
  canRemove?: boolean;
}

function RoundButton({ label, icon, onPress, disabled }: { label: string; icon: string; onPress: () => void; disabled?: boolean }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [styles.round, disabled && styles.roundOff, pressed && styles.roundPressed]}
    >
      <Text style={styles.roundText}>{icon}</Text>
    </Pressable>
  );
}

export function PhotoStrip({
  photos,
  size = 120,
  onRemove,
  onMove,
  busy,
}: {
  photos: StripPhoto[];
  size?: number;
  /** Leave out to show photos without a remove button. */
  onRemove?: (key: string) => void;
  /** Leave out to hide the move buttons. */
  onMove?: (from: number, to: number) => void;
  busy?: boolean;
}) {
  const { t } = useTranslation();
  if (photos.length === 0) return null;
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator contentContainerStyle={styles.strip}>
      {photos.map((p, i) => (
        <View key={p.key} style={styles.item}>
          {p.uri ? (
            <Image source={{ uri: p.uri }} style={[styles.photo, { width: size, height: size }]} accessibilityLabel={t('social.photos.photoN', { n: i + 1 })} />
          ) : (
            <View style={[styles.photo, styles.missing, { width: size, height: size }]} />
          )}
          {onRemove && p.canRemove !== false ? (
            <View style={styles.removeSpot}>
              <RoundButton label={t('social.photos.remove', { n: i + 1 })} icon="✕" disabled={busy} onPress={() => onRemove(p.key)} />
            </View>
          ) : null}
          {onMove && photos.length > 1 ? (
            <View style={styles.moves}>
              <RoundButton label={t('social.photos.moveLeft', { n: i + 1 })} icon="‹" disabled={busy || i === 0} onPress={() => onMove(i, i - 1)} />
              <Text style={styles.number}>{i + 1}</Text>
              <RoundButton label={t('social.photos.moveRight', { n: i + 1 })} icon="›" disabled={busy || i === photos.length - 1} onPress={() => onMove(i, i + 1)} />
            </View>
          ) : null}
        </View>
      ))}
    </ScrollView>
  );
}

/** The list with one item moved, for the local (not yet saved) strip and for building the new saved order. */
export function moveItem<T>(list: T[], from: number, to: number): T[] {
  if (to < 0 || to >= list.length || from === to) return list;
  const next = list.slice();
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

const styles = StyleSheet.create({
  strip: { gap: 10, paddingVertical: 4 },
  item: { gap: 6, alignItems: 'center' },
  photo: { borderRadius: 14 },
  missing: { backgroundColor: colors.cardBorder },
  removeSpot: { position: 'absolute', top: 6, right: 6 },
  moves: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  number: { color: colors.muted, fontFamily: fonts.bold, fontSize: 13, minWidth: 14, textAlign: 'center' },
  round: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    alignItems: 'center',
    justifyContent: 'center',
  },
  roundOff: { opacity: 0.35 },
  roundPressed: { backgroundColor: colors.tint },
  roundText: { color: colors.text, fontFamily: fonts.extrabold, fontSize: 16, lineHeight: 18 },
});
