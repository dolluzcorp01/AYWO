// The family guide, right after "Start from me": mother, father, partner, children, one question at a time.
// Each "Add" opens the usual add form already set up and comes back here; "Skip" moves on. Steps already in the tree
// are passed over. Afterwards the "Add your family" card on the tree keeps the rest one tap away.
import { useLocalSearchParams } from 'expo-router';
import { useRouter } from '@/lib/router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { PageLoader } from '@/components/Loaders';
import { Screen } from '@/components/Screen';
import { Text } from '@/components/Text';
import { Heading, LoadFailed, Muted, PrimaryButton, SecondaryButton, TextButton } from '@/components/ui';
import { useErrorText } from '@/lib/errors';
import { FAMILY_STEPS, familyGaps, stepRoute } from '@/tree/familyGaps';
import type { FamilyStep } from '@/tree/familyGaps';
import { useTreeView } from '@/tree/useTreeView';
import { colors, fonts, radius } from '@/theme/tokens';

export default function FamilyGuide() {
  const { treeId } = useLocalSearchParams<{ treeId: string }>();
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const errorText = useErrorText();
  const tree = useTreeView(treeId, 'mine', i18n.language, null);
  const [skipped, setSkipped] = useState<Set<FamilyStep>>(new Set());

  const openTree = () => router.replace({ pathname: '/tree/[id]', params: { id: treeId } });
  // The card must really be in the tree that came back: a card that has since been removed is no place to add from.
  const mine = tree.data?.viewer_person_id ?? null;
  const me = mine && tree.data?.nodes.some((n) => n.id === mine) ? mine : null;

  if (tree.isError) {
    return (
      <Screen>
        <LoadFailed message={errorText(tree.error)} onRetry={() => tree.refetch()} />
        <SecondaryButton label={t('guide.openTree')} onPress={openTree} />
      </Screen>
    );
  }
  if (!tree.data) {
    return (
      <Screen>
        <View style={styles.centre}>
          <PageLoader label={t('tree.loading')} />
        </View>
      </Screen>
    );
  }
  // The tree is here, but this person has no card of their own in it (looking at a relative's tree, say).
  // The guide adds family around "me", so there is nothing to ask: say so and give the way to the tree.
  if (!me) {
    return (
      <Screen>
        <View style={styles.centre}>
          <Text accessibilityRole="alert" style={styles.note}>{t('guide.notInTree')}</Text>
        </View>
        <PrimaryButton label={t('guide.openTree')} onPress={openTree} />
      </Screen>
    );
  }

  const steps = familyGaps(tree.data, me);
  const current = steps.find((s) => !s.done && !skipped.has(s.step));
  const people = tree.data.nodes.filter((n) => !n.nameUnknown).length;

  if (!current) {
    return (
      <Screen>
        <View style={styles.centre}>
          <Text style={styles.celebrate}>🎉</Text>
          <Heading>{t('guide.doneTitle')}</Heading>
          <Muted>{t('guide.doneBody', { count: people })}</Muted>
        </View>
        <PrimaryButton label={t('guide.openTree')} onPress={openTree} />
      </Screen>
    );
  }

  const number = FAMILY_STEPS.indexOf(current.step) + 1;
  return (
    <Screen>
      <View style={styles.top}>
        <View style={styles.headRow}>
          <Text style={styles.eyebrow}>{t('guide.intro')}</Text>
          <TextButton label={t('guide.later')} onPress={openTree} />
        </View>
        <View style={styles.dots} accessibilityRole="progressbar" accessibilityValue={{ min: 1, max: FAMILY_STEPS.length, now: number }}>
          {FAMILY_STEPS.map((step) => {
            const state = steps.find((s) => s.step === step);
            return <View key={step} style={[styles.dot, state?.done && styles.dotDone, step === current.step && styles.dotNow]} />;
          })}
        </View>
        <Text style={styles.stepOf}>{t('guide.stepOf', { n: number })}</Text>
        <Heading>{t(`guide.steps.${current.step}.title`)}</Heading>
        <Muted>{t(`guide.steps.${current.step}.help`)}</Muted>
      </View>
      <View style={styles.actions}>
        <PrimaryButton label={t(`guide.steps.${current.step}.add`)} onPress={() => router.push(stepRoute(treeId, me, current, 'guide'))} />
        <SecondaryButton label={t('guide.skip')} onPress={() => setSkipped((now) => new Set(now).add(current.step))} />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  centre: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, paddingHorizontal: 8 },
  note: { color: colors.text, fontFamily: fonts.semibold, fontSize: 16, lineHeight: 24, textAlign: 'center' },
  celebrate: { fontSize: 56 },
  top: { flex: 1, gap: 12, paddingTop: 24 },
  headRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  eyebrow: { flexShrink: 1, color: colors.muted, fontFamily: fonts.bold, fontSize: 12, letterSpacing: 1, textTransform: 'uppercase' },
  dots: { flexDirection: 'row', gap: 6, marginTop: 8 },
  dot: { flex: 1, height: 6, borderRadius: radius.button, backgroundColor: colors.tint },
  dotDone: { backgroundColor: colors.logoPurple },
  dotNow: { backgroundColor: colors.logoIndigo },
  stepOf: { color: colors.muted, fontFamily: fonts.semibold, fontSize: 13, marginTop: 8 },
  actions: { gap: 10, paddingBottom: 8 },
});
