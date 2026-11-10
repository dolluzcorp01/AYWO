import { LinearGradient } from 'expo-linear-gradient';
import { Image, StyleSheet, Text, View } from 'react-native';
import { colors, fonts } from '@/theme/tokens';

// Warm Daylight face colours: soft two-tone blends, so a family without photos still looks like people, not icons.
const TONES: [string, string][] = [
  ['#E255C9', '#8E26E1'],
  ['#8B6CF0', '#2F3379'],
  ['#FDB24A', '#E8663A'],
  ['#3FBFA8', '#2D6FA8'],
  ['#C77DFF', '#5B3DC8'],
  ['#F2789A', '#B23A7A'],
];

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = parts[0]?.[0] ?? '';
  const last = parts.length > 1 ? parts[parts.length - 1][0] : (parts[0]?.[1] ?? '');
  return (first + last).toUpperCase();
}

function toneFor(id: string): [string, string] {
  let total = 0;
  for (let i = 0; i < id.length; i++) total += id.charCodeAt(i);
  return TONES[total % TONES.length];
}

interface Props {
  personId: string;
  size: number;
  photoUrl?: string | null;
  nameUnknown?: boolean;
  /** Stand-in for a person whose real card is elsewhere in the tree. */
  ghost?: boolean;
  ring?: boolean;
  /** With no photo, shows the person's initials instead of a figure. */
  name?: string;
}

export function Avatar({ personId, size, photoUrl, nameUnknown, ghost, ring, name }: Props) {
  // A ring sits outside the face, so the picture keeps its size.
  const round = { width: size, height: size, borderRadius: size / 2 };
  const outer = ring ? { width: size + 10, height: size + 10, borderRadius: (size + 10) / 2 } : round;

  if (nameUnknown) {
    return (
      <View style={[styles.unknown, round]}>
        <Text style={[styles.unknownMark, { fontSize: size * 0.4 }]}>?</Text>
      </View>
    );
  }
  return (
    <View style={[outer, ring && styles.ring, ghost && styles.ghost]}>
      {photoUrl ? (
        <Image source={{ uri: photoUrl }} style={round} accessibilityIgnoresInvertColors />
      ) : name && initialsOf(name) ? (
        <LinearGradient colors={toneFor(personId)} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[round, styles.initials]}>
          <Text style={[styles.initialsText, { fontSize: Math.round(size * 0.36) }]}>{initialsOf(name)}</Text>
        </LinearGradient>
      ) : (
        <LinearGradient colors={toneFor(personId)} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[round, styles.clip]}>
          <View
            style={{
              position: 'absolute',
              left: size * 0.32,
              top: size * 0.2,
              width: size * 0.36,
              height: size * 0.36,
              borderRadius: size * 0.18,
              backgroundColor: colors.white,
            }}
          />
          <View
            style={{
              position: 'absolute',
              left: size * 0.12,
              top: size * 0.62,
              width: size * 0.76,
              height: size * 0.7,
              borderRadius: size * 0.38,
              backgroundColor: colors.white,
            }}
          />
        </LinearGradient>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  clip: { overflow: 'hidden' },
  ring: { borderWidth: 3, borderColor: colors.logoOrange, padding: 2 },
  initials: { alignItems: 'center', justifyContent: 'center' },
  initialsText: { color: colors.white, fontFamily: fonts.bold, letterSpacing: 0.3 },
  ghost: { opacity: 0.45 },
  unknown: {
    borderWidth: 2,
    borderStyle: 'dashed',
    borderColor: colors.cardBorder,
    backgroundColor: colors.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  unknownMark: { color: colors.muted, fontFamily: fonts.extrabold },
});
