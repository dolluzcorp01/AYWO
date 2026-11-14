// "Add your family": the close relatives still missing, one tap each, until the tree has 5 people.
// Shown under the tree and on Home. Each button opens the add form already set (relation, and gender for parents).
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, View } from 'react-native';
import { PlusIcon } from '@/components/Icons';
import { Text } from '@/components/Text';
import { FAMILY_STEPS, familyGaps, showFamilyGuide, stepRoute } from '@/tree/familyGaps';
import type { TreeViewAnswer } from '@/tree/useTreeView';
import { colors, fonts, minTapSize, radius, shadows } from '@/theme/tokens';

type Tree = Pick<TreeViewAnswer, 'nodes' | 'links' | 'unions'>;

/** `full`: as wide as the column it sits in (Home, under the family card), not a centred narrow card. */
export function FamilyGuideCard({ treeId, tree, me, full }: { treeId: string; tree: Tree; me: string | null; full?: boolean }) {
  const { t } = useTranslation();
  const router = useRouter();
  if (!me || !showFamilyGuide(tree, me)) return null;
  const steps = familyGaps(tree, me);
  const done = steps.filter((s) => s.done).length;

  return (
    <View style={[styles.card, full && styles.full]} accessibilityRole="summary">
      <View style={styles.head}>
        <Text accessibilityRole="header" style={styles.title}>{t('guide.cardTitle')}</Text>
        <Text style={styles.progressText}>{t('guide.cardProgress', { done })}</Text>
      </View>
      <View style={styles.bar} accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: FAMILY_STEPS.length, now: done }}>
        <View style={[styles.barFill, { width: `${(done / FAMILY_STEPS.length) * 100}%` }]} />
      </View>
      <View style={styles.row}>
        {steps
          .filter((s) => !s.done)
          .map((s) => (
            <Pressable
              key={s.step}
              accessibilityRole="button"
              accessibilityLabel={t(`guide.steps.${s.step}.title`)}
              onPress={() => router.push(stepRoute(treeId, me, s))}
              style={styles.chip}
            >
              <PlusIcon color={colors.logoIndigo} size={16} width={2.4} />
              <Text style={styles.chipText}>{t(`guide.${s.step}`)}</Text>
            </Pressable>
          ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  full: { maxWidth: '100%', alignSelf: 'stretch' },
  card: {
    width: '100%',
    maxWidth: 520,
    alignSelf: 'center',
    gap: 10,
    padding: 16,
    borderRadius: radius.card,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    ...shadows.card,
  },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  title: { flexShrink: 1, color: colors.text, fontFamily: fonts.extrabold, fontSize: 17 },
  progressText: { color: colors.muted, fontFamily: fonts.semibold, fontSize: 13 },
  bar: { height: 8, borderRadius: 4, backgroundColor: colors.tint, overflow: 'hidden' },
  barFill: { height: 8, borderRadius: 4, backgroundColor: colors.logoPurple },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    minHeight: minTapSize,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 16,
    borderRadius: 999,
    backgroundColor: colors.tint,
    borderWidth: 1,
    borderColor: colors.dashed,
  },
  chipText: { color: colors.logoIndigo, fontFamily: fonts.bold, fontSize: 15 },
});
