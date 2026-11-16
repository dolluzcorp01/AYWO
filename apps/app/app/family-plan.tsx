// S-16 Family plan (wireframe F4). The database decides everything here: up to 6 including the payer.
//
// Cancelling a Razorpay plan. Free months end at once, and Razorpay's webhook changes the plan within seconds, so the
// screen keeps asking until it does. A paid plan is cancelled "at the end of the period", and Razorpay sends nothing
// until that day, so the server goes on saying "renews". This device remembers that the cancellation was accepted
// (for this exact period) and shows "Ends on" instead. NEEDS A SERVER CHANGE to be right on other devices too:
// POST /pay/razorpay/cancel should set will_renew = false itself.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Linking, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { PageLoader, Spinner } from '@/components/Loaders';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path } from 'react-native-svg';
import { Avatar } from '@/components/Avatar';
import { BackIcon } from '@/components/ContactIcon';
import { Text, TextInput } from '@/components/Text';
import { NeonPanel, PrimaryButton } from '@/components/ui';
import { api, deviceStore } from '@/lib/api';
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
}
interface SearchRow {
  id: string;
  name: string;
}

export default function FamilyPlan() {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const insets = useSafeAreaInsets();
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

  const header = (
    <View style={styles.header}>
      <Pressable accessibilityRole="button" accessibilityLabel={t('pay.back')} onPress={back} style={styles.round}>
        <BackIcon color={colors.text} />
      </Pressable>
      <Text style={styles.headerTitle} accessibilityRole="header">{t('pay.family.title')}</Text>
    </View>
  );

  const data = plan.data;
  if (plan.isError && !data) {
    return (
      <View style={[styles.page, { paddingTop: insets.top + 12 }]}>
        {header}
        <View style={styles.centre}>
          <Text style={styles.message}>{payErrorText(t, plan.error)}</Text>
          <Pressable accessibilityRole="button" onPress={() => plan.refetch()} style={styles.textButton}>
            <Text style={styles.link}>{t('pay.tryAgain')}</Text>
          </Pressable>
        </View>
      </View>
    );
  }
  if (!data) {
    return (
      <View style={[styles.page, { paddingTop: insets.top + 12 }]}>
        {header}
        <View style={styles.centre}>
          <PageLoader label={t('pay.loading')} />
        </View>
      </View>
    );
  }

  // Nothing yet, or a plan that has ended: the way forward is the plans screen.
  const dateText = (value: string | null) =>
    value ? new Date(value).toLocaleDateString(i18n.language, { day: 'numeric', month: 'short', year: 'numeric' }) : '';

  // Free Plus days with no plan behind them: Plus is on, but there is no family plan to manage.
  if (onBonusOnly(data)) {
    return (
      <View style={[styles.page, styles.pad, { paddingTop: insets.top + 12 }]}>
        {header}
        <NeonPanel style={styles.panel}>
          <Text style={styles.kicker}>{t('pay.kicker')}</Text>
          <Text style={styles.panelTitle}>{t('pay.bonus.title', { date: dateText(data.bonus_until) })}</Text>
          <Text style={styles.panelSub}>{t('pay.bonus.why')}</Text>
        </NeonPanel>
        <Text style={styles.note}>{t('pay.bonus.noFamily', { date: dateText(data.bonus_until) })}</Text>
        {trialCancelSent ? <Text style={styles.note} accessibilityLiveRegion="polite">{t('pay.family.cancelDoneTrial')}</Text> : null}
      </View>
    );
  }

  // Nothing yet, or a plan that has ended: the way forward is the plans screen.
  if (!data.plus) {
    return (
      <View style={[styles.page, styles.pad, { paddingTop: insets.top + 12 }]}>
        {header}
        <NeonPanel style={styles.panel}>
          <Text style={styles.kicker}>{t('pay.kicker')}</Text>
          <Text style={styles.panelTitle}>{data.status ? t('pay.family.ended') : t('pay.family.none')}</Text>
          <Text style={styles.panelSub}>{t('pay.alwaysFree')}</Text>
        </NeonPanel>
        {trialCancelSent ? <Text style={styles.note} accessibilityLiveRegion="polite">{t('pay.family.cancelDoneTrial')}</Text> : null}
        <PrimaryButton label={t('pay.family.seePlans')} onPress={() => router.push('/plus')} />
      </View>
    );
  }

  const willRenew = data.will_renew && !cancelledHere;
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
    <View style={styles.page}>
      <ScrollView contentContainerStyle={[styles.scroll, { paddingTop: insets.top + 12, paddingBottom: insets.bottom + 24 }]}>
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
        {cancelledHere && data.is_payer ? (
          <Text style={styles.note} accessibilityLiveRegion="polite">
            {t('pay.family.cancelDone', { date: dateText(data.renews_at) })}
          </Text>
        ) : null}

        <View style={styles.footer}>
          <Pressable accessibilityRole="link" onPress={() => router.push('/plus')} style={styles.textButton}>
            <Text style={styles.footerLink}>{t('pay.family.seePlans')}</Text>
          </Pressable>
          {data.is_payer && data.store === 'razorpay' && (!willRenew || cancelPending) ? null : data.is_payer && data.store ? (
            data.store === 'razorpay' && cancelAsked ? (
              <View style={styles.confirmRow}>
                <Text style={styles.note}>{data.status === 'trial' ? t('pay.family.cancelTrialConfirm') : t('pay.family.cancelConfirm')}</Text>
                <Pressable accessibilityRole="button" onPress={() => manage.mutate('razorpay')} disabled={manage.isPending} style={styles.textButton}>
                  <Text style={styles.footerLink}>{t('pay.family.cancelYes')}</Text>
                </Pressable>
                <Pressable accessibilityRole="button" onPress={() => setCancelAsked(false)} style={styles.textButton}>
                  <Text style={styles.footerLink}>{t('pay.family.cancelNo')}</Text>
                </Pressable>
              </View>
            ) : (
              <Pressable
                accessibilityRole="button"
                onPress={() => (data.store === 'razorpay' ? setCancelAsked(true) : manage.mutate(data.store))}
                disabled={manage.isPending}
                style={styles.textButton}
              >
                <Text style={styles.footerLink}>
                  {data.store === 'razorpay' ? t('pay.family.cancel') : t('pay.family.manage')}
                </Text>
              </Pressable>
            )
          ) : null}
          {data.store ? <Text style={styles.billed}>{t(`pay.family.billedBy.${data.store}`)}</Text> : null}
        </View>
      </ScrollView>
    </View>
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
      <Avatar personId={member.profile_id} size={44} />
      <Text style={styles.memberName} numberOfLines={2}>{shownName}</Text>
      {member.is_payer ? (
        <LinearGradient colors={gradients.neon} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.pays}>
          <Text style={styles.paysText}>{t('pay.family.pays')}</Text>
        </LinearGradient>
      ) : null}
      {canAct && !props.confirming ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={mine ? actionWord : t('pay.family.removeNamed', { name: shownName })}
          onPress={props.onAsk}
          style={styles.textButton}
        >
          <Text style={styles.removeText}>{actionWord}</Text>
        </Pressable>
      ) : null}
      {canAct && props.confirming ? (
        <View style={styles.confirmInline}>
          <Pressable accessibilityRole="button" accessibilityLabel={t('pay.family.confirmNamed', { action: actionWord, name: shownName })} onPress={props.onConfirm} disabled={props.busy} style={styles.textButton}>
            <Text style={styles.removeConfirm}>{t('pay.family.yes')}</Text>
          </Pressable>
          <Pressable accessibilityRole="button" onPress={props.onCancel} style={styles.textButton}>
            <Text style={styles.removeText}>{t('pay.family.no')}</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

/** One box: a name searches the payer's trees; digits are read as a phone number. */
function AddMember({ onDone, onClose }: { onDone: () => void; onClose: () => void }) {
  const { t } = useTranslation();
  const [text, setText] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const query = text.trim();
  const looksLikePhone = /^\+?[\d\s()-]{5,}$/.test(query);

  const results = useQuery({
    queryKey: ['plan-add-search', query],
    enabled: query.length >= 2 && !looksLikePhone,
    queryFn: async () => {
      const trees = await api.get<TreeRow[]>('/trees');
      const found = await Promise.all(
        trees.map((tree) => api.get<SearchRow[]>(`/trees/${tree.id}/search?q=${encodeURIComponent(query)}`)),
      );
      return found.flat();
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
      <TextInput
        value={text}
        onChangeText={setText}
        placeholder={t('pay.family.addPlaceholder')}
        placeholderTextColor={colors.muted}
        accessibilityLabel={t('pay.family.addPlaceholder')}
        style={styles.input}
        autoCorrect={false}
        autoFocus
      />
      {looksLikePhone ? (
        <PrimaryButton
          label={t('pay.family.addNumber')}
          disabled={add.isPending}
          onPress={() => add.mutate({ phone: query })}
        />
      ) : null}
      {!looksLikePhone && results.isFetching ? <Spinner size={24} label={t('pay.loading')} /> : null}
      {!looksLikePhone && results.isError ? <Text style={styles.problem}>{payErrorText(t, results.error)}</Text> : null}
      {!looksLikePhone && results.data && results.data.length === 0 && !results.isFetching ? (
        <Text style={styles.note}>{t('pay.family.noMatch')}</Text>
      ) : null}
      {!looksLikePhone
        ? results.data?.map((row) => (
            <Pressable
              key={row.id}
              accessibilityRole="button"
              accessibilityLabel={t('pay.family.addNamed', { name: row.name })}
              onPress={() => add.mutate({ person_id: row.id })}
              disabled={add.isPending}
              style={styles.result}
            >
              <Avatar personId={row.id} size={36} />
              <Text style={styles.resultName}>{row.name}</Text>
            </Pressable>
          ))
        : null}
      {problem ? <Text style={styles.problem} accessibilityLiveRegion="polite">{problem}</Text> : null}
      <Pressable accessibilityRole="button" onPress={onClose} style={styles.textButton}>
        <Text style={styles.removeText}>{t('pay.family.closeAdd')}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.background },
  pad: { paddingHorizontal: 18, gap: 13 },
  scroll: { flexGrow: 1, paddingHorizontal: 18, gap: 13 },
  centre: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 12 },
  message: { color: colors.text, fontFamily: fonts.semibold, fontSize: 15, textAlign: 'center' },
  textButton: { minHeight: minTapSize, minWidth: minTapSize, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 },
  link: { color: colors.logoPurple, fontFamily: fonts.bold, fontSize: 14, textDecorationLine: 'underline' },

  header: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  round: {
    width: minTapSize,
    height: minTapSize,
    borderRadius: minTapSize / 2,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: { color: colors.text, fontFamily: fonts.extrabold, fontSize: 24, letterSpacing: -0.5 },

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
  removeText: { color: colors.muted, fontFamily: fonts.bold, fontSize: 13, textDecorationLine: 'underline' },
  removeConfirm: { color: colors.alert, fontFamily: fonts.bold, fontSize: 13, textDecorationLine: 'underline' },
  confirmInline: { flexDirection: 'row', gap: 4 },

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
  input: {
    minHeight: minTapSize,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    paddingHorizontal: 14,
    color: colors.text,
    fontFamily: fonts.semibold,
    fontSize: 15,
  },
  result: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: minTapSize },
  resultName: { flex: 1, color: colors.text, fontFamily: fonts.bold, fontSize: 14 },

  problem: { color: colors.alert, fontFamily: fonts.semibold, fontSize: 13 },
  note: { color: colors.muted, fontFamily: fonts.semibold, fontSize: 13, lineHeight: 19, textAlign: 'center' },
  footer: { marginTop: 'auto', alignItems: 'center', gap: 2, paddingTop: 12 },
  footerLink: { color: colors.logoPurple, fontFamily: fonts.extrabold, fontSize: 14, textDecorationLine: 'underline' },
  confirmRow: { alignItems: 'center' },
  billed: { color: colors.muted, fontFamily: fonts.semibold, fontSize: 12, textAlign: 'center' },
});
