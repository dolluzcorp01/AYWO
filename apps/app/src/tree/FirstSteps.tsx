// The first five minutes. Someone new saw the whole of Home at once (dates, memories, chat, offers) with an empty tree
// behind it, and no word on what to do first. This card says it: three steps, one lit at a time, each a single tap.
// Until the first one is done the rest of Home waits behind one line ("See everything else"), so nothing competes.
import { closeFamily, focusView, graphFromApi } from '@aywo/layout';
import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { CheckIcon, ChevronIcon } from '@/components/Icons';
import { Bouncy, Rise } from '@/components/Motion';
import { Text } from '@/components/Text';
import { TextButton } from '@/components/ui';
import { firstName, useMe } from '@/lib/account';
import type { TreeRow } from '@/lib/account';
import { deviceStore } from '@/lib/api';
import { useRouter } from '@/lib/router';
import { familyGaps } from '@/tree/familyGaps';
import { canShare } from '@/tree/roles';
import { useTreeView } from '@/tree/useTreeView';
import { colors, fonts, minTapSize, radius, shadows } from '@/theme/tokens';

const HIDDEN = 'aywo.firstStepsHidden';

interface Step {
  key: 'family' | 'invite' | 'photo';
  done: boolean;
  title: string;
  help: string;
  go: (() => void) | null;
}

/** The steps for this person in this tree, or null when the card is not for them (someone else's tree, still loading). */
function useSteps(tree: TreeRow): Step[] | null {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const me = useMe();
  const view = useTreeView(tree.id, 'mine', i18n.language, null);
  const data = view.data;
  const mine = data?.viewer_person_id;
  if (!data || !mine || !data.nodes.some((n) => n.id === mine) || !canShare(data.role)) return null;

  const gaps = familyGaps(data, mine);
  const named = data.nodes.filter((n) => !n.nameUnknown).length;
  const parentsIn = gaps.filter((s) => s.step === 'mother' || s.step === 'father').every((s) => s.done);
  const others = data.nodes.filter((n) => n.id !== mine);
  const toInvite = closeFamily(focusView(graphFromApi(data), mine))
    .map((id) => data.nodes.find((n) => n.id === id))
    .find((n) => !!n && !n.joined && !n.nameUnknown && n.living !== 'deceased');

  return [
    {
      key: 'family',
      // A tree brought in from a file has its people already, whoever the parents are.
      done: parentsIn || named >= 5,
      title: t('firstSteps.family'),
      help: t('firstSteps.familyHelp'),
      go: () => router.push({ pathname: '/guide/[treeId]', params: { treeId: tree.id } }),
    },
    {
      key: 'invite',
      done: others.some((n) => n.joined),
      title: toInvite ? t('firstSteps.inviteName', { name: firstName(toInvite.name) }) : t('firstSteps.invite'),
      help: toInvite ? t('firstSteps.inviteHelp') : t('firstSteps.inviteWait'),
      go: toInvite ? () => router.push({ pathname: '/share/[treeId]', params: { treeId: tree.id, personId: toInvite.id } }) : null,
    },
    {
      key: 'photo',
      done: !!me.data?.photo_url,
      title: t('firstSteps.photo'),
      help: t('firstSteps.photoHelp'),
      go: () => router.push('/profile'),
    },
  ];
}

function useHidden(): [boolean, () => void] {
  // Starts hidden until the saved choice has been read, so the card never flashes up for someone who closed it.
  const [hidden, setHidden] = useState(true);
  useEffect(() => {
    let live = true;
    Promise.resolve(deviceStore.get(HIDDEN))
      .then((value) => {
        if (live) setHidden(value === '1');
      })
      .catch(() => {
        if (live) setHidden(false);
      });
    return () => {
      live = false;
    };
  }, []);
  return [
    hidden,
    () => {
      setHidden(true);
      void deviceStore.set(HIDDEN, '1');
    },
  ];
}

/** True while this person has not yet added their close family: Home then keeps to the one thing. */
export function useJustStarted(tree: TreeRow): boolean {
  const steps = useSteps(tree);
  const [hidden] = useHidden();
  return !!steps && !hidden && !steps[0].done;
}

export function FirstSteps({ tree }: { tree: TreeRow }) {
  const { t } = useTranslation();
  const steps = useSteps(tree);
  const [hidden, hide] = useHidden();
  if (!steps || hidden) return null;
  const done = steps.filter((s) => s.done).length;
  if (done === steps.length) return null;
  const next = steps.find((s) => !s.done && s.go) ?? null;

  return (
    <Rise style={styles.card}>
      <View style={styles.head}>
        <Text accessibilityRole="header" style={styles.title}>{t('firstSteps.title')}</Text>
        <Text style={styles.progress}>{t('firstSteps.progress', { done, total: steps.length })}</Text>
      </View>
      <View style={styles.bar} accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: steps.length, now: done }}>
        <View style={[styles.barFill, { width: `${(done / steps.length) * 100}%` }]} />
      </View>
      {steps.map((step, i) => {
        const now = step === next;
        return (
          <Bouncy
            key={step.key}
            to={0.98}
            accessibilityRole="button"
            accessibilityLabel={`${step.title}. ${step.done ? t('firstSteps.doneWord') : step.help}`}
            accessibilityState={{ disabled: step.done || !step.go }}
            disabled={step.done || !step.go}
            onPress={() => step.go?.()}
            style={[styles.step, now && styles.stepNow]}
          >
            <View style={[styles.mark, step.done && styles.markDone, now && styles.markNow]}>
              {step.done ? <CheckIcon color={colors.white} size={16} width={3} /> : <Text style={[styles.markText, now && styles.markTextNow]}>{i + 1}</Text>}
            </View>
            <View style={styles.words}>
              <Text style={[styles.stepTitle, step.done && styles.stepTitleDone]}>{step.title}</Text>
              {step.done ? null : <Text style={styles.stepHelp}>{step.help}</Text>}
            </View>
            {!step.done && step.go ? <ChevronIcon color={now ? colors.logoPurple : colors.idleTab} size={18} /> : null}
          </Bouncy>
        );
      })}
      {/* Only once the family is in: before that the card is the whole point of Home. */}
      {steps[0].done ? <TextButton label={t('firstSteps.hide')} onPress={hide} /> : null}
    </Rise>
  );
}

/** The parts of Home that can wait. A brand-new person sees one line in their place and opens them when ready. */
export function AfterFirstSteps({ tree, children }: { tree: TreeRow; children: ReactNode }) {
  const { t } = useTranslation();
  const waiting = useJustStarted(tree);
  const [open, setOpen] = useState(false);
  if (!waiting || open) return <>{children}</>;
  return <TextButton label={t('firstSteps.more')} onPress={() => setOpen(true)} />;
}

const styles = StyleSheet.create({
  card: {
    gap: 10,
    padding: 16,
    borderRadius: radius.card,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    ...shadows.card,
  },
  head: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 10 },
  title: { flexShrink: 1, color: colors.text, fontFamily: fonts.extrabold, fontSize: 18, letterSpacing: -0.2 },
  progress: { color: colors.muted, fontFamily: fonts.bold, fontSize: 13 },
  bar: { height: 6, borderRadius: 3, backgroundColor: colors.tint, overflow: 'hidden' },
  barFill: { height: 6, borderRadius: 3, backgroundColor: colors.logoPurple },
  step: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: minTapSize + 8,
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  stepNow: { backgroundColor: colors.celebrationTint, borderColor: colors.logoPurple },
  mark: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.tint },
  markDone: { backgroundColor: colors.good },
  markNow: { backgroundColor: colors.logoPurple },
  markText: { color: colors.muted, fontFamily: fonts.extrabold, fontSize: 14 },
  markTextNow: { color: colors.white },
  words: { flex: 1, minWidth: 0, gap: 1 },
  stepTitle: { color: colors.text, fontFamily: fonts.bold, fontSize: 16, lineHeight: 21 },
  stepTitleDone: { color: colors.muted, textDecorationLine: 'line-through' },
  stepHelp: { color: colors.muted, fontFamily: fonts.medium, fontSize: 13, lineHeight: 18 },
});
