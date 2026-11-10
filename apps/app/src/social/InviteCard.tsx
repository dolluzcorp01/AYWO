// The look of an invite. Every design stays in the frozen logo colours.
import { LinearGradient } from 'expo-linear-gradient';
import { StyleSheet } from 'react-native';
import { Text } from '@/components/Text';
import type { Design } from '@/social/types';
import { colors, fonts, gradients } from '@/theme/tokens';

const LOOK: Record<Design, { colours: readonly [string, string, ...string[]]; text: string; soft: string }> = {
  classic: { colours: gradients.neon, text: colors.white, soft: colors.onNeon },
  marigold: { colours: gradients.highlight, text: colors.text, soft: colors.text },
  gold: { colours: gradients.neonOutline, text: colors.white, soft: colors.white },
  midnight: { colours: gradients.button, text: colors.logoYellow, soft: colors.white },
};

export function InviteCard({ design, title, kindLabel, lines }: { design: Design; title: string; kindLabel?: string; lines?: (string | null | undefined)[] }) {
  const look = LOOK[design];
  return (
    <LinearGradient colors={look.colours} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.card}>
      {kindLabel ? <Text style={[styles.kind, { color: look.soft }]}>{kindLabel}</Text> : null}
      <Text style={[styles.title, { color: look.text }]}>{title}</Text>
      {(lines ?? []).filter(Boolean).map((line) => (
        <Text key={line} style={[styles.line, { color: look.soft }]}>{line}</Text>
      ))}
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 22, padding: 22, gap: 6 },
  kind: { fontFamily: fonts.extrabold, fontSize: 13, letterSpacing: 1 },
  title: { fontFamily: fonts.extrabold, fontSize: 26, lineHeight: 32, letterSpacing: -0.5 },
  line: { fontFamily: fonts.semibold, fontSize: 15, lineHeight: 22 },
});
