// S-16 Family plan (wireframe F4). The database decides everything here: up to 6 including the payer.
//
// Cancelling a Razorpay plan. Free months end at once, and Razorpay's webhook changes the plan within seconds, so the
// screen keeps asking until it does. A paid plan is cancelled "at the end of the period", and Razorpay sends nothing
// until that day, so the server goes on saying "renews". This device remembers that the cancellation was accepted
// (for this exact period) and shows "Ends on" instead. NEEDS A SERVER CHANGE to be right on other devices too:
// POST /pay/razorpay/cancel should set will_renew = false itself.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from '@/lib/router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Linking, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { relationText } from '@aywo/layout';
import { Spinner } from '@/components/Loaders';
import Svg, { Path } from 'react-native-svg';
import { Avatar } from '@/components/Avatar';
import { PhoneField } from '@/components/PhoneField';
import { Screen } from '@/components/Screen';
import { Text } from '@/components/Text';
import { Field, Loading, LoadFailed, NeonPanel, Pills, PrimaryButton, SmallButton, TextButton, TopBar } from '@/components/ui';
import { api, deviceStore } from '@/lib/api';
import { toE164 } from '@/lib/phone';
import type { TreeViewAnswer } from '@/tree/useTreeView';
import { FAMILY_PLAN_MAX, onBonusOnly, PLAN_KEY, payErrorText, usePlan } from '@/pay/usePlan';
import type { PlanInfo, PlanMember } from '@/pay/usePlan';
import { colors, fonts, gradients, minTapSize } from '@/theme/tokens';

const APPLE_SUBSCRIPTIONS = 'https://apps.apple.com/account/subscriptions';
const GOOGLE_SUBSCRIPTIONS = 'https://play.google.com/store/account/subscriptions';
const CANCEL_MARK = 'aywo.planCancelled';

interface CancelMark {
  profile: string;
  renews_at: string | null;
}

interface TreeRow {
  id: string;
  name: string;
}
interface SearchRow {
  id: string;
  name: string;
}
/** One person offered in "From my tree": the tree and the relation word tell two people of the same name apart. */
interface FoundPerson extends SearchRow {
  treeName: string;
  relation: string | null;
}

export default function FamilyPlan() {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const queryClient = useQueryClient();
  // After asking to cancel, the plan changes only when Razorpay's webhook arrives: keep asking for a while.
  const [trialCancelSent, setTrialCancelSent] = useState(false);
  const [cancelMark, setCancelMark] = useState<CancelMark | null>(null);
  useEffect(() => {
    void deviceStore
      .get(CANCEL_MARK)
      .then((saved) => (saved ? setCancelMark(JSON.parse(saved) as CancelMark) : undefined))
      .catch(() => undefined);
  }, []);
  const plan = usePlan();
  const [adding, setAdding] = useState(false);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [cancelAsked, setCancelAsked] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const refresh = () => queryClient.invalidateQueries({ queryKey: PLAN_KEY });

  const remove = useMutation({
    mutationFn: (profileId: string) => api.del(`/plan/members/${profileId}`),
    onMutate: () => setProblem(null),
    onSuccess: refresh,
    onError: (e) => setProblem(payErrorText(t, e)),
    onSettled: () => setConfirming(null),
  });

  const manage = useMutation({
    mutationFn: async (store: PlanInfo['store']) => {
      if (store === 'apple') await Linking.openURL(APPLE_SUBSCRIPTIONS);
      else if (store === 'google') await Linking.openURL(GOOGLE_SUBSCRIPTIONS);
      else if (store === 'stripe') {
        const { url } = await api.post<{ url: string }>('/pay/stripe/portal');
        await Linking.openURL(url);
      } else if (store === 'razorpay') {
        const before = plan.data;
        await api.post('/pay/razorpay/cancel');
        if (before?.status === 'trial') {
          setTrialCancelSent(true);
        } else if (before) {
          const mark = { profile: before.profile_id, renews_at: before.renews_at };
          setCancelMark(mark);
          await deviceStore.set(CANCEL_MARK, JSON.stringify(mark)).catch(() => undefined);
        }
        await refresh();
      }
    },
    onMutate: () => {
      setProblem(null);
      setNote(null);
    },
    onError: (e) => setProblem(payErrorText(t, e)),
    onSettled: () => setCancelAsked(false),
  });

  // Free months: the cancellation has landed once the plan is no longer in its free months.
  const planNow = plan.data;
  const cancelPending = trialCancelSent && planNow?.status === 'trial';
  // Paid: accepted for this very period (a later period means the person subscribed again).
  const cancelledHere =
    !!cancelMark && !!planNow && planNow.store === 'razorpay' && planNow.status !== 'trial' &&
    cancelMark.profile === planNow.profile_id && cancelMark.renews_at === planNow.renews_at;
  const refetchPlan = plan.refetch;
  useEffect(() => {
    if (!cancelPending) return;
    void refetchPlan();
    const every = setInterval(() => void refetchPlan(), 3000);
    // Webhooks are usually seconds away. After two minutes stop asking; the note stays and says what to do.
    const stop = setTimeout(() => clearInterval(every), 120_000);
    return () => {
      clearInterval(every);
      clearTimeout(stop);
    };
  }, [cancelPending, refetchPlan]);

  function back() {
    if (router.canGoBack()) router.back();
    else router.replace('/home');
  }

  // The same top bar as every other page. Screen (below) also brings the "no internet" bar.
  const header = <TopBar title={t('pay.family.title')} onBack={back} />;

  const data = plan.data;
  if (plan.isError && !data) {
    return (
      <Screen>
        {header}
        <LoadFailed message={payErrorText(t, plan.error)} onRetry={() => plan.refetch()} />
      </Screen>
    );
  }
  if (!data) {
    return (
      <Screen>
        {header}
        <Loading label={t('pay.loading')} />
      </Screen>
    );
  }

  // Nothing yet, or a plan that has ended: the way forward is the plans screen.
  const dateText = (value: string | null) =>
    value ? new Date(value).toLocaleDateString(i18n.language, { day: 'numeric', month: 'short', year: 'numeric' }) : '';

  // Free Plus days with no plan behind them: Plus is on, but there is no family plan to manage.
  if (onBonusOnly(data)) {
    return (
      <Screen>
        {header}
        <View style={styles.pad}>
          <NeonPanel style={styles.panel}>
            <Text style={styles.kicker}>{t('pay.kicker')}</Text>
            <Text style={styles.panelTitle}>{t('pay.bonus.title', { date: dateText(data.bonus_until) })}</Text>
            <Text style={styles.panelSub}>{t('pay.bonus.why')}</Text>
          </NeonPanel>
          <Text style={styles.note}>{t('pay.bonus.noFamily', { date: dateText(data.bonus_until) })}</Text>
          {trialCancelSent ? <Text style={styles.note} accessibilityLiveRegion="polite">{t('pay.family.cancelDoneTrial')}</Text> : null}
        </View>
      </Screen>
    );
  }

  // Nothing yet, or a plan that has ended: the way forward is the plans screen.
  if (!data.plus) {
    return (
      <Screen>
        {header}
        <View style={styles.pad}>
          <NeonPanel style={styles.panel}>
            <Text style={styles.kicker}>{t('pay.kicker')}</Text>
            <Text style={styles.panelTitle}>{data.status ? t('pay.family.ended') : t('pay.family.none')}</Text>
            <Text style={styles.panelSub}>{t('pay.alwaysFree')}</Text>
          </NeonPanel>
          {trialCancelSent ? <Text style={styles.note} accessibilityLiveRegion="polite">{t('pay.family.cancelDoneTrial')}</Text> : null}
          <PrimaryButton label={t('pay.family.seePlans')} onPress={() => router.push('/plus')} />
        </View>
      </Screen>
    );
  }

  const willRenew = data.will_renew && !cancelledHere;
  // Cancelled, with paid days still to run. Plus stays on until the date, and nothing can be bought before it
  // (the plans page would only say "You already have Plus"), so this state says so plainly and offers no link there.
  const endingOn = !willRenew && data.status !== 'trial' && data.status !== 'grace' ? dateText(data.renews_at) : null;
  const used = data.members.length;
  const left = Math.max(0, FAMILY_PLAN_MAX - used);
  const yearly = data.product_id === 'aywo_plus_yearly';
  const price = yearly ? data.prices.yearly.display : data.prices.monthly.display;

  const statusLine = t(`pay.family.status.${data.status ?? 'active'}`);
  const headline =
    data.status === 'trial'
      ? t('pay.family.freeUntil', { date: dateText(data.trial_ends_at) })
      : data.status === 'grace'
        ? t('pay.family.paymentProblem')
        : willRenew
          ? t('pay.family.renewsOn', { date: dateText(data.renews_at) })
          : t('pay.family.endsOn', { date: dateText(data.renews_at) });
  const places = t('pay.family.places', { used, max: FAMILY_PLAN_MAX });
  const subline = data.status === 'trial' && willRenew ? `${t(yearly ? 'pay.family.thenYearly' : 'pay.family.thenMonthly', { price })} · ${places}` : places;

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        {header}

        <NeonPanel style={styles.panel}>
          <Text style={styles.kicker}>{`${t('pay.kicker')} · ${statusLine}`}</Text>
          <Text style={styles.panelTitle}>{headline}</Text>
          <Text style={styles.panelSub}>{subline}</Text>
        </NeonPanel>

        <Text style={styles.sectionTitle}>{t('pay.family.members')}</Text>

        {data.members.map((member) => (
          <MemberRow
            key={member.profile_id}
            member={member}
            mine={member.profile_id === data.profile_id}
            viewerPays={data.is_payer}
            confirming={confirming === member.profile_id}
            busy={remove.isPending}
            onAsk={() => setConfirming(member.profile_id)}
            onCancel={() => setConfirming(null)}
            onConfirm={() => remove.mutate(member.profile_id)}
          />
        ))}

        {data.is_payer && left > 0 ? (
          adding ? (
            <AddMember onDone={() => { setAdding(false); refresh(); }} onClose={() => setAdding(false)} />
          ) : (
            <Pressable accessibilityRole="button" onPress={() => setAdding(true)} style={styles.addRow}>
              <LinearGradient colors={gradients.button} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.addIcon}>
                <Svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke={colors.white} strokeWidth={2.6}>
                  <Path d="M12 5v14M5 12h14" />
                </Svg>
              </LinearGradient>
              <Text style={styles.addText}>{t('pay.family.add', { count: left })}</Text>
            </Pressable>
          )
        ) : null}

        {problem ? <Text style={styles.problem} accessibilityLiveRegion="polite">{problem}</Text> : null}
        {note ? <Text style={styles.note} accessibilityLiveRegion="polite">{note}</Text> : null}
        {cancelPending ? (
          <Text style={styles.note} accessibilityLiveRegion="polite">{t('pay.family.cancelAskedTrial')}</Text>
        ) : null}
        {endingOn ? (
          <Text style={styles.ending} accessibilityLiveRegion="polite">
            {t(!data.is_payer ? 'pay.family.endingMember' : data.store === 'razorpay' ? 'pay.family.endingPayer' : 'pay.family.endingPayerStore', { date: endingOn })}
          </Text>
        ) : null}

        <View style={styles.footer}>
          {/* Not while a cancelled plan runs out: nothing can be bought until it ends, so the link led nowhere. */}
          {endingOn ? null : <TextButton label={t('pay.family.seePlans')} onPress={() => router.push('/plus')} />}
          {data.is_payer && data.store === 'razorpay' && (!willRenew || cancelPending) ? null : data.is_payer && data.store ? (
            data.store === 'razorpay' && cancelAsked ? (
              <View style={styles.confirmRow}>
                <Text style={styles.note}>{data.status === 'trial' ? t('pay.family.cancelTrialConfirm') : t('pay.family.cancelConfirm')}</Text>
                <View style={styles.confirmButtons}>
                  <SmallButton label={t('pay.family.cancelNo')} onPress={() => setCancelAsked(false)} />
                  <SmallButton label={manage.isPending ? t('pay.pleaseWait') : t('pay.family.cancelYes')} kind="plain" onPress={() => manage.mutate('razorpay')} disabled={manage.isPending} />
                </View>
              </View>
            ) : (
              <TextButton
                label={data.store === 'razorpay' ? t('pay.family.cancel') : t('pay.family.manage')}
                danger={data.store === 'razorpay'}
                onPress={() => (data.store === 'razorpay' ? setCancelAsked(true) : manage.mutate(data.store))}
                disabled={manage.isPending}
              />
            )
          ) : null}
          {data.store ? <Text style={styles.billed}>{t(`pay.family.billedBy.${data.store}`)}</Text> : null}
        </View>
      </ScrollView>
    </Screen>
  );
}

function MemberRow(props: {
  member: PlanMember;
  mine: boolean;
  viewerPays: boolean;
  confirming: boolean;
  busy: boolean;
  onAsk: () => void;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const { t } = useTranslation();
  const { member, mine, viewerPays } = props;
  const canAct = member.is_payer ? false : viewerPays || mine;
  const actionWord = mine ? t('pay.family.leave') : t('pay.family.remove');
  // The server hides a stranger's name, so it can be blank.
  const shownName = member.display_name || t('pay.family.unnamed');
  return (
    <View style={styles.member}>
      <Avatar personId={member.profile_id} size={44} photoUrl={member.photo_url} />
      <Text style={styles.memberName} numberOfLines={2}>{shownName}</Text>
      {member.is_payer ? (
        <LinearGradient colors={gradients.neon} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.pays}>
          <Text style={styles.paysText}>{t('pay.family.pays')}</Text>
        </LinearGradient>
      ) : null}
      {canAct && !props.confirming ? (
        <SmallButton label={actionWord} kind="plain" accessibilityLabel={mine ? actionWord : t('pay.family.removeNamed', { name: shownName })} onPress={props.onAsk} />
      ) : null}
      {canAct && props.confirming ? (
        <View style={styles.confirmInline}>
          <SmallButton
            label={t('pay.family.yes')}
            kind="plain"
            accessibilityLabel={t('pay.family.confirmNamed', { action: actionWord, name: shownName })}
            onPress={props.onConfirm}
            disabled={props.busy}
          />
          <SmallButton label={t('pay.family.no')} onPress={props.onCancel} />
        </View>
      ) : null}
    </View>
  );
}

/**
 * Two plain ways to add someone: from the payer's own trees by name, or by mobile number with the same country
 * box as everywhere else in the app.
 */
function AddMember({ onDone, onClose }: { onDone: () => void; onClose: () => void }) {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const [way, setWay] = useState<'tree' | 'phone'>('tree');
  const [text, setText] = useState('');
  const [phone, setPhone] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const query = text.trim();
  const fullNumber = toE164(phone);

  const results = useQuery({
    queryKey: ['plan-add-search', query, i18n.language],
    enabled: way === 'tree' && query.length >= 2,
    queryFn: async () => {
      const trees = await api.get<TreeRow[]>('/trees');
      let notJoined = 0;
      const found = await Promise.all(
        trees.map(async (tree) => {
          const [hits, view] = await Promise.all([
            api.get<SearchRow[]>(`/trees/${tree.id}/search?q=${encodeURIComponent(query)}`),
            // The tree itself says who has joined AYWO and what each person is to the payer. Same key as the tree
            // screen, so an open tree is not fetched twice. If it cannot load, the names are still offered.
            queryClient
              .fetchQuery({
                queryKey: ['tree-view', tree.id, 'mine', i18n.language, null],
                queryFn: () => api.post<TreeViewAnswer>('/tree-view', { tree_id: tree.id, mode: 'mine', lang: i18n.language }),
                staleTime: 60_000,
              })
              .catch(() => null),
          ]);
          const people: FoundPerson[] = [];
          for (const hit of hits) {
            // The payer is on the plan already.
            if (view?.viewer_person_id === hit.id) continue;
            const node = view?.nodes.find((n) => n.id === hit.id);
            // Only people with their own AYWO account can be on a plan: the rest are counted and explained, not offered.
            if (node && !node.joined) {
              notJoined += 1;
              continue;
            }
            const relation = relationText(view?.labels[hit.id]);
            people.push({ ...hit, treeName: tree.name, relation: relation.kind === 'word' ? relation.word : null });
          }
          return people;
        }),
      );
      return { people: found.flat(), notJoined };
    },
  });

  const add = useMutation({
    mutationFn: (body: { phone: string } | { person_id: string }) => api.post('/plan/members', body),
    onMutate: () => setProblem(null),
    onSuccess: onDone,
    onError: (e) => setProblem(payErrorText(t, e)),
  });

  return (
    <View style={styles.addPanel}>
      <Pills
        value={way}
        onChange={(next) => {
          setWay(next);
          setProblem(null);
        }}
        options={[
          { value: 'tree', label: t('pay.family.fromTree') },
          { value: 'phone', label: t('pay.family.byNumber') },
        ]}
      />
      {way === 'phone' ? (
        <>
          <PhoneField label={t('pay.family.numberLabel')} value={phone} onChangeText={setPhone} />
          <PrimaryButton
            label={add.isPending ? t('pay.pleaseWait') : t('pay.family.addNumber')}
            disabled={add.isPending}
            missing={fullNumber ? null : t('pay.family.needNumber')}
            onPress={() => (fullNumber ? add.mutate({ phone: fullNumber }) : undefined)}
          />
        </>
      ) : (
        <>
          <Field label={t('pay.family.nameLabel')} value={text} onChangeText={setText} placeholder={t('pay.family.namePlaceholder')} autoCorrect={false} autoFocus />
          {results.isFetching ? <Spinner size={24} label={t('pay.loading')} /> : null}
          {results.isError ? <Text style={styles.problem}>{payErrorText(t, results.error)}</Text> : null}
          {results.data && results.data.people.length === 0 && results.data.notJoined === 0 && !results.isFetching ? (
            <Text style={styles.note}>{t('pay.family.noMatch')}</Text>
          ) : null}
          {results.data?.people.map((row) => (
            <Pressable
              key={`${row.treeName}:${row.id}`}
              accessibilityRole="button"
              accessibilityLabel={t('pay.family.addNamed', { name: row.name })}
              onPress={() => add.mutate({ person_id: row.id })}
              disabled={add.isPending}
              style={styles.result}
            >
              <Avatar personId={row.id} size={36} />
              <View style={styles.resultWords}>
                <Text style={styles.resultName}>{row.name}</Text>
                <Text style={styles.resultAbout}>{row.relation ? `${row.relation} · ${row.treeName}` : row.treeName}</Text>
              </View>
            </Pressable>
          ))}
          {results.data && results.data.notJoined > 0 ? <Text style={styles.note}>{t('pay.family.notJoined', { count: results.data.notJoined })}</Text> : null}
        </>
      )}
      {problem ? <Text style={styles.problem} accessibilityLiveRegion="polite">{problem}</Text> : null}
      <TextButton label={t('pay.family.closeAdd')} onPress={onClose} />
    </View>
  );
}

const styles = StyleSheet.create({
  // Screen gives the side padding; these only space the blocks.
  pad: { gap: 13 },
  scroll: { flexGrow: 1, gap: 13 },

  panel: { gap: 6 },
  kicker: { color: colors.logoYellow, fontFamily: fonts.extrabold, fontSize: 12, letterSpacing: 1 },
  panelTitle: { color: colors.white, fontFamily: fonts.extrabold, fontSize: 22, letterSpacing: -0.4 },
  panelSub: { color: colors.onNeon, fontFamily: fonts.semibold, fontSize: 13 },

  sectionTitle: { color: colors.text, fontFamily: fonts.extrabold, fontSize: 15 },
  member: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 12,
    borderRadius: 20,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.cardBorder,
  },
  memberName: { flex: 1, color: colors.text, fontFamily: fonts.extrabold, fontSize: 15 },
  pays: { borderRadius: 9, paddingHorizontal: 9, paddingVertical: 3 },
  paysText: { color: colors.white, fontFamily: fonts.extrabold, fontSize: 12 },
  confirmInline: { flexDirection: 'row', gap: 6 },

  addRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 12,
    borderRadius: 20,
    backgroundColor: colors.card,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: colors.muted,
  },
  addIcon: { width: minTapSize, height: minTapSize, borderRadius: minTapSize / 2, alignItems: 'center', justifyContent: 'center' },
  addText: { flex: 1, color: colors.text, fontFamily: fonts.extrabold, fontSize: 14 },
  addPanel: { gap: 10, padding: 12, borderRadius: 20, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.cardBorder },
  result: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: minTapSize },
  resultWords: { flex: 1, minWidth: 0 },
  resultName: { color: colors.text, fontFamily: fonts.bold, fontSize: 14 },
  resultAbout: { color: colors.muted, fontFamily: fonts.semibold, fontSize: 12 },

  problem: { color: colors.alert, fontFamily: fonts.semibold, fontSize: 13 },
  note: { color: colors.muted, fontFamily: fonts.semibold, fontSize: 13, lineHeight: 19, textAlign: 'center' },
  // The cancelled plan's end date: the one thing to read on the page, so darker and larger than a note.
  ending: { color: colors.text, fontFamily: fonts.bold, fontSize: 14, lineHeight: 21, textAlign: 'center' },
  footer: { marginTop: 'auto', alignItems: 'center', gap: 2, paddingTop: 12 },
  confirmRow: { alignItems: 'center', gap: 8 },
  confirmButtons: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 8 },
  billed: { color: colors.muted, fontFamily: fonts.semibold, fontSize: 12, textAlign: 'center' },
});
