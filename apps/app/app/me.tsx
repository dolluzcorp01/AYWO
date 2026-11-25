// F5 / S-17 Me: the person, their plan, their trees and the app's settings.
import { useQueries, useQuery } from '@tanstack/react-query';
import type { Href } from 'expo-router';
import { useRouter } from '@/lib/router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Avatar } from '@/components/Avatar';
import { ChevronIcon, BagIcon, BellIcon, BlockIcon, BoxIcon, CardIcon, DocIcon, DownloadIcon, GiftIcon, GlobeIcon, HeartIcon, HelpIcon, InviteIcon, LinkedPeopleIcon, PencilIcon, PlusIcon, ShieldIcon } from '@/components/Icons';
import { Bouncy, Rise } from '@/components/Motion';
import { LanguagePicker } from '@/components/LanguagePicker';
import { Screen } from '@/components/Screen';
import { TAB_BAR_SPACE, TabBar } from '@/components/TabBar';
import { Text } from '@/components/Text';
import { showToast } from '@/components/Toast';
import { Card, Checkbox, ConfirmDialog, ErrorText, Loading, LoadFailed, NeonPanel, SecondaryButton, SmallButton } from '@/components/ui';
import { languageLabel } from '@/i18n/languages';
import { HELP_PAGES } from '@/legal/LegalLinks';
import { api } from '@/lib/api';
import { DeleteBanner } from '@/components/DeleteBanner';
import { mainTree, useMe, useTrees, useUpdateMe } from '@/lib/account';
import { TreeSettings } from '@/tree/TreeSettings';
import { useFeature } from '@/ops/appConfig';
import type { MyExtras } from '@/ops/types';
import { useErrorText } from '@/lib/errors';
import { logOut } from '@/lib/logout';
import { showPhone } from '@/lib/phone';
import { setLanguage, setLargeText, setSimpleMode, useLargeText, useSimpleMode } from '@/lib/prefs';
import { FAMILY_PLAN_MAX, hasPlusNow, onBonusOnly, usePlan } from '@/pay/usePlan';
import { SosButton } from '@/social/SosButton';
import { canShare } from '@/tree/roles';
import { treeMembersQuery, useNotificationPrefs } from '@/tree/useEdit';
import { useTreeView } from '@/tree/useTreeView';
import { colors, fonts, minTapSize } from '@/theme/tokens';

export default function MeScreen() {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const errorText = useErrorText();
  const me = useMe();
  const [signingOut, setSigningOut] = useState(false);
  const [leavingNow, setLeavingNow] = useState(false);
  const trees = useTrees();
  const update = useUpdateMe();
  const [treeSettings, setTreeSettings] = useState(false);
  const plan = usePlan();
  const prefs = useNotificationPrefs();
  const large = useLargeText();
  const simple = useSimpleMode();
  const [picking, setPicking] = useState(false);
  const extras = useQuery({ queryKey: ['my-extras'], queryFn: () => api.rpc<MyExtras>('my_extras') });
  const ordersOn = useFeature('orders');
  const referralsOn = useFeature('referrals');
  const offersOn = useFeature('offers');

  const list = trees.data ?? [];
  const created = list.filter((tree) => tree.role === 'creator');
  const primary = mainTree(trees.data);
  // The person's own face comes from their card in their main tree.
  const main = useTreeView(primary?.id ?? '', primary ? 'mine' : 'see_as', i18n.language, null);
  // Export belongs to those who run a tree.
  const exportable = list.find((tree) => canShare(tree.role));
  const own = main.data?.nodes.find((n) => n.id === main.data?.viewer_person_id);
  const successors = useQueries({ queries: created.map((tree) => treeMembersQuery(tree.id)) });

  if (me.isError) {
    return (
      <Screen>
        <LoadFailed message={errorText(me.error)} onRetry={() => me.refetch()} />
        <TabBar active="me" />
      </Screen>
    );
  }
  if (!me.data) {
    return (
      <Screen>
        <Loading label={t('tree.loading')} />
      </Screen>
    );
  }

  // A quiet "Saved", so a changed setting is seen to have been kept.
  const saved = () => showToast('success', t('common.saved'));

  function chooseLanguage(code: string) {
    setPicking(false);
    setLanguage(code);
    update.mutate({ language_code: code }, { onSuccess: saved });
  }

  function toggleLarge(on: boolean) {
    setLargeText(on);
    update.mutate({ large_text: on }, { onSuccess: saved });
  }

  function toggleSimple(on: boolean) {
    void setSimpleMode(on);
    // Elder mode brings large text with it.
    update.mutate(on ? { simple_mode: true, large_text: true } : { simple_mode: false }, { onSuccess: saved });
  }

  const memberCount = plan.data?.members.length;
  // About this phone only: the email switches start on, and would keep saying "All on" after everything was turned off here.
  const allOn = (prefs.data ?? []).every((p) => p.push);
  // Free Plus days (referrals, support) count as Plus too; GET /plan reports them apart from a paid plan.
  const planOn = plan.data ? hasPlusNow(plan.data) : me.data.plus;
  const bonusOnly = !!plan.data && onBonusOnly(plan.data);
  const bonusDate = plan.data?.bonus_until
    ? new Date(plan.data.bonus_until).toLocaleDateString(i18n.language, { day: 'numeric', month: 'short', year: 'numeric' })
    : '';
  // One tree: who it is. Several: how many have someone. Nothing until the answers are in.
  const successorsKnown = successors.length > 0 && successors.every((q) => q.data);
  const successorValue = !successorsKnown
    ? undefined
    : successors.length === 1
      ? (successors[0].data?.successor?.display_name ?? t('me.noSuccessor'))
      : t('me.successorsSet', { count: successors.filter((q) => q.data?.successor).length, total: successors.length });

  return (
    <Screen flush>
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.who}>
          <Avatar personId={own?.id ?? me.data.id} size={62} photoUrl={me.data.photo_url ?? own?.photoUrl} ring />
          <View style={styles.whoText}>
            <Text accessibilityRole="header" style={styles.name}>{me.data.display_name}</Text>
            {me.data.login_phone ? <Text style={styles.sub} selectable>{t('me.signedInWith', { number: showPhone(me.data.login_phone) })}</Text> : null}
            {created.length > 0 ? <Text style={styles.sub}>{t('me.creatorOf', { count: created.length })}</Text> : null}
          </View>
          <SmallButton kind="plain" label={t('me.edit')} onPress={() => router.push({ pathname: '/profile', params: { edit: '1' } })} />
        </View>

        <DeleteBanner />

        <Pressable accessibilityRole="button" onPress={() => router.push(planOn && !bonusOnly ? '/family-plan' : '/plus')}>
          <NeonPanel style={styles.plus}>
            <View style={styles.plusText}>
              <Text style={styles.plusEyebrow}>{t('me.plus')}</Text>
              <Text style={styles.plusTitle}>
                {bonusOnly
                  ? t('pay.bonus.short', { date: bonusDate })
                  : planOn
                  ? memberCount !== undefined
                    ? t('me.familyPlan', { count: memberCount, size: FAMILY_PLAN_MAX })
                    : t('me.plusOn')
                  : t('me.plusOff')}
              </Text>
            </View>
            <ChevronIcon color={colors.white} />
          </NeonPanel>
        </Pressable>

        <SosButton />

        <Text accessibilityRole="header" style={styles.group}>{t('me.myTrees')}</Text>
        <Card style={styles.list}>
          {list.length === 0 ? (
            <Row icon={PlusIcon} tone="purple" title={t('home.anotherTree')} onPress={() => router.push('/start')} last />
          ) : (
            list.map((tree, i) => (
              <Row
                key={tree.id}
                icon={LinkedPeopleIcon}
                tone="purple"
                title={tree.name}
                value={t('home.peopleCount', { count: tree.people })}
                onPress={() => router.push({ pathname: '/tree/[id]', params: { id: tree.id } })}
                last={i === list.length - 1 && created.length === 0}
              />
            ))
          )}
          {created.length > 0 ? <Row icon={PencilIcon} tone="indigo" title={t('me.treeSettings')} onPress={() => setTreeSettings(true)} last /> : null}
        </Card>
        {treeSettings ? <TreeSettings trees={created} onClose={() => setTreeSettings(false)} /> : null}

        {offersOn || ordersOn || referralsOn ? (
          <>
            <Text accessibilityRole="header" style={styles.group}>{t('ops.me.more')}</Text>
            <Card style={styles.list}>
              {offersOn ? <Row icon={GiftIcon} tone="warm" title={t('ops.me.offers')} onPress={() => router.push('/offers')} /> : null}
              {ordersOn ? <Row icon={BagIcon} tone="warm" title={t('ops.me.shop')} onPress={() => router.push('/shop')} /> : null}
              {ordersOn ? <Row icon={BoxIcon} tone="warm" title={t('ops.me.orders')} onPress={() => router.push('/orders')} /> : null}
              {referralsOn ? <Row icon={InviteIcon} tone="warm" title={t('ops.me.invite')} value={t('ops.me.inviteValue')} onPress={() => router.push('/invite-friends')} last /> : null}
            </Card>
          </>
        ) : null}

        <Text accessibilityRole="header" style={styles.group}>{t('me.app')}</Text>
        <Card style={styles.list}>
          <Row icon={GlobeIcon} tone="indigo" title={t('settings.language')} value={languageLabel(i18n.language)} onPress={() => setPicking(true)} />
          <View style={styles.row}>
            <Checkbox label={t('settings.largeText')} on={large} onChange={toggleLarge} />
          </View>
          <View style={styles.row}>
            <Checkbox label={t('settings.simpleMode')} help={t('settings.simpleModeHelp')} on={simple} onChange={toggleSimple} />
          </View>
          <Row
            icon={BellIcon}
            tone="indigo"
            title={t('settings.notifications')}
            value={prefs.data ? (allOn ? t('settings.allOn') : t('settings.someOff')) : undefined}
            onPress={() => router.push('/settings/notifications')}
            last
          />
        </Card>
        {update.isError ? <ErrorText>{errorText(update.error)}</ErrorText> : null}

        <Text accessibilityRole="header" style={styles.group}>{t('me.safeKeeping')}</Text>
        <Card style={styles.list}>
          {created.length > 0 ? <Row icon={HeartIcon} tone="purple" title={t('settings.successor')} value={successorValue} onPress={() => router.push('/settings/successor')} /> : null}
          {exportable ? (
            <Row icon={DownloadIcon} tone="purple" title={t('me.download')} onPress={() => router.push({ pathname: '/export/[treeId]', params: { treeId: exportable.id } })} />
          ) : null}
          <Row
            icon={CardIcon}
            tone="red"
            title={t('ops.me.card')}
            value={extras.data ? (extras.data.has_emergency_card ? t('ops.me.cardSet') : t('ops.me.cardNotSet')) : undefined}
            onPress={() => router.push('/social/sos/card')}
          />
          <Row
            icon={BlockIcon}
            tone="red"
            title={t('ops.me.blocked')}
            value={extras.data?.blocked ? String(extras.data.blocked) : undefined}
            onPress={() => router.push('/settings/blocked')}
          />
          <Row icon={ShieldIcon} tone="purple" title={t('me.privacy')} onPress={() => router.push('/settings/privacy')} last />
        </Card>

        <Text accessibilityRole="header" style={styles.group}>{t('me.help')}</Text>
        <Card style={styles.list}>
          <Row
            icon={HelpIcon}
            tone="indigo"
            title={t('ops.me.helpCentre')}
            value={extras.data?.open_tickets ? t('ops.me.answers', { count: extras.data.open_tickets }) : undefined}
            onPress={() => router.push('/help')}
          />
          {HELP_PAGES.map((page, i) => (
            <Row icon={DocIcon} tone="indigo" key={page.key} title={t(page.label)} onPress={() => router.push(page.href as Href)} last={i === HELP_PAGES.length - 1} />
          ))}
        </Card>

        {/* The admin panel is built for a wide screen and opens only on the web: no row here that leads nowhere. */}
        {me.data?.admin_role && Platform.OS === 'web' ? (
          <Card style={styles.list}>
            <Row icon={ShieldIcon} tone="indigo" title={t('nav.adminPanel')} onPress={() => router.push('/admin')} last />
          </Card>
        ) : null}

        <SecondaryButton label={t('settings.signOut')} onPress={() => setSigningOut(true)} />
        <ConfirmDialog
          visible={signingOut}
          title={t('nav.signOutTitle')}
          message={t('nav.signOutMessage')}
          // Signing out tells the server first, which can take a few seconds on a weak connection. The box stays
          // and says so; it used to close at once and the screen sat there as if nothing had happened.
          confirmLabel={t(leavingNow ? 'settings.signingOut' : 'settings.signOut')}
          busy={leavingNow}
          onConfirm={() => {
            setLeavingNow(true);
            void logOut().finally(() => {
              setLeavingNow(false);
              setSigningOut(false);
            });
          }}
          onCancel={() => (leavingNow ? undefined : setSigningOut(false))}
        />
      </ScrollView>
      <TabBar active="me" />
      <LanguagePicker visible={picking} current={i18n.language} onPick={chooseLanguage} onClose={() => setPicking(false)} />
    </Screen>
  );
}

type RowTone = 'indigo' | 'purple' | 'warm' | 'red';
const ROW_TONES: Record<RowTone, { back: string; ink: string }> = {
  indigo: { back: colors.tint, ink: colors.logoIndigo },
  purple: { back: colors.tint, ink: colors.logoPurple },
  warm: { back: colors.celebrationTint, ink: colors.ask },
  red: { back: colors.alertTint, ink: colors.alert },
};

/** One line of the lists on Me. The small picture at the start lets the eye find a row without reading every line. */
function Row({ title, value, onPress, last, icon: RowIcon, tone = 'indigo' }: { title: string; value?: string; onPress: () => void; last?: boolean; icon?: typeof ChevronIcon; tone?: RowTone }) {
  return (
    <Bouncy accessibilityRole="button" onPress={onPress} to={0.98} style={[styles.row, styles.rowInner, !last && styles.rowLine]}>
      {RowIcon ? (
        <View style={[styles.rowIcon, { backgroundColor: ROW_TONES[tone].back }]}>
          <RowIcon color={ROW_TONES[tone].ink} size={18} width={1.9} />
        </View>
      ) : null}
      <Text style={styles.rowTitle}>{title}</Text>
      <View style={styles.rowEnd}>
        {value ? <Text style={styles.rowValue}>{value}</Text> : null}
        {/* The arrow says "this opens something": a bare line of text does not look tappable. */}
        <ChevronIcon color={colors.idleTab} size={16} />
      </View>
    </Bouncy>
  );
}

const styles = StyleSheet.create({
  scroll: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: TAB_BAR_SPACE, gap: 10 },
  who: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  whoText: { flex: 1, minWidth: 0 },
  name: { color: colors.text, fontFamily: fonts.extrabold, fontSize: 22, letterSpacing: -0.4 },
  sub: { color: colors.muted, fontFamily: fonts.semibold, fontSize: 13 },
  edit: { minHeight: minTapSize, minWidth: minTapSize, alignItems: 'center', justifyContent: 'center' },
  editText: { color: colors.relation, fontFamily: fonts.extrabold, fontSize: 14, textDecorationLine: 'underline' },
  plus: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14 },
  plusText: { flex: 1, minWidth: 0 },
  plusEyebrow: { color: colors.logoYellow, fontFamily: fonts.extrabold, fontSize: 12, letterSpacing: 0.6, textTransform: 'uppercase' },
  plusTitle: { color: colors.white, fontFamily: fonts.extrabold, fontSize: 17 },
  group: { color: colors.muted, fontFamily: fonts.extrabold, fontSize: 12, letterSpacing: 0.6, textTransform: 'uppercase', marginTop: 6 },
  list: { padding: 0, paddingHorizontal: 14 },
  row: { minHeight: 54, justifyContent: 'center' },
  rowIcon: { width: 34, height: 34, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  rowInner: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  rowLine: { borderBottomWidth: 1, borderBottomColor: colors.tint },
  rowTitle: { flex: 1, minWidth: 0, color: colors.text, fontFamily: fonts.bold, fontSize: 15 },
  rowEnd: { flexShrink: 1, flexDirection: 'row', alignItems: 'center', gap: 6 },
  rowValue: { flexShrink: 1, color: colors.muted, fontFamily: fonts.semibold, fontSize: 13 },
});
